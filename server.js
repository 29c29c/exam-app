const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { loadEnvFile } = require('./services/env-loader');
const logger = require('./services/logger');
const { buildExportPayload, getExportMimeType } = require('./services/export-service');
const { parseImportContent } = require('./services/import-parser');
const { analyzeQuestion } = require('./services/ai-service');
const {
    createNormalizedHash,
    formatLegacyContent,
} = require('./services/question-normalizer');

loadEnvFile(path.join(__dirname, '.env'));

const app = express();
const PORT = Number(process.env.PORT || 3007);
const SECRET_KEY = process.env.JWT_SECRET || 'dev-only-change-me';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'db', 'database.sqlite');
const IMPORT_PREVIEW_TTL_MS = 1000 * 60 * 30;
const AUTH_COOKIE_NAME = 'exam_app_token';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_SECURE = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === 'true'
    : IS_PRODUCTION;
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 1000 * 60 * 15);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 10);
const REGISTER_RATE_LIMIT_WINDOW_MS = Number(process.env.REGISTER_RATE_LIMIT_WINDOW_MS || 1000 * 60 * 30);
const REGISTER_RATE_LIMIT_MAX = Number(process.env.REGISTER_RATE_LIMIT_MAX || 5);
const AI_CONFIG_SECRET = String(process.env.AI_CONFIG_SECRET || process.env.JWT_SECRET || SECRET_KEY);
const AI_ENCRYPTION_KEY = crypto.createHash('sha256').update(AI_CONFIG_SECRET).digest();
const corsOrigins = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

if (corsOrigins.length) {
    app.use(cors({
        origin(origin, callback) {
            if (!origin || corsOrigins.includes(origin)) {
                return callback(null, true);
            }
            return callback(new Error('CORS origin not allowed'));
        },
        credentials: true,
    }));
}

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);
const db = new sqlite3.Database(DB_PATH);
const importPreviews = new Map();
const rateLimitStore = new Map();

const sendError = (res, msg, status = 400, code = 'REQUEST_FAILED') => res.status(status).json({
    success: false,
    error: {
        code,
        message: msg,
    },
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
    });
});

const dbExec = (sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

const getClientIp = (req) => {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return forwarded || req.socket.remoteAddress || 'unknown';
};

const parseCookies = (cookieHeader = '') => cookieHeader.split(';').reduce((result, part) => {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) return result;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) return result;
    result[key] = decodeURIComponent(value);
    return result;
}, {});

const serializeCookie = (name, value, maxAgeSeconds = null) => {
    const segments = [
        `${name}=${encodeURIComponent(value)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
    ];

    if (COOKIE_SECURE) {
        segments.push('Secure');
    }

    if (maxAgeSeconds !== null) {
        segments.push(`Max-Age=${maxAgeSeconds}`);
    }

    return segments.join('; ');
};

const setAuthCookie = (res, token) => {
    res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, token, 60 * 60 * 24 * 30));
};

const clearAuthCookie = (res) => {
    res.setHeader('Set-Cookie', serializeCookie(AUTH_COOKIE_NAME, '', 0));
};

const applyRateLimit = ({ keyPrefix, limit, windowMs, message, code }) => (req, res, next) => {
    const now = Date.now();
    const key = `${keyPrefix}:${getClientIp(req)}`;
    const existing = rateLimitStore.get(key);
    const timestamps = (existing || []).filter((timestamp) => now - timestamp < windowMs);

    if (timestamps.length >= limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - timestamps[0])) / 1000));
        res.setHeader('Retry-After', retryAfterSeconds);
        return sendError(res, message, 429, code);
    }

    timestamps.push(now);
    rateLimitStore.set(key, timestamps);
    return next();
};

const encryptSecret = (plaintext) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', AI_ENCRYPTION_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
    };
};

const decryptSecret = ({ encrypted, iv, tag }) => {
    if (!encrypted || !iv || !tag) return '';
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        AI_ENCRYPTION_KEY,
        Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final(),
    ]);
    return decrypted.toString('utf8');
};

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const cookies = parseCookies(req.headers.cookie || '');
    const token = (authHeader && authHeader.split(' ')[1]) || cookies[AUTH_COOKIE_NAME];
    if (!token) return sendError(res, '需要登录', 401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return sendError(res, '登录已过期，请重新登录', 403);
        req.user = user;
        next();
    });
};

const ensureColumn = async (tableName, columnName, definition) => {
    const columns = await dbAll(`PRAGMA table_info(${tableName})`);
    const exists = columns.some((column) => column.name === columnName);
    if (!exists) {
        await dbRun(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
    }
};

const cleanupExpiredPreviews = () => {
    const now = Date.now();
    for (const [key, value] of importPreviews.entries()) {
        if (now - value.createdAt > IMPORT_PREVIEW_TTL_MS) {
            importPreviews.delete(key);
        }
    }
};

const generatePreviewId = () => crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

const parseLegacyOptions = (rawOptions) => {
    if (!rawOptions) return [];
    try {
        const parsed = JSON.parse(rawOptions);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((option, index) => {
            if (typeof option === 'string') {
                return {
                    key: String.fromCharCode(65 + index),
                    text: option,
                };
            }

            return {
                key: (option.key || String.fromCharCode(65 + index)).toUpperCase(),
                text: option.text || option.value || '',
            };
        }).filter((option) => option.text);
    } catch (error) {
        return [];
    }
};

const getQuestionOptions = async (questionIds, legacyOptionsById = new Map()) => {
    if (!questionIds.length) return new Map();

    const placeholders = questionIds.map(() => '?').join(',');
    const rows = await dbAll(
        `SELECT question_id, option_key, option_text
         FROM question_options
         WHERE question_id IN (${placeholders})
         ORDER BY question_id, sort_order, id`,
        questionIds,
    );

    const optionMap = new Map();
    rows.forEach((row) => {
        if (!optionMap.has(row.question_id)) optionMap.set(row.question_id, []);
        optionMap.get(row.question_id).push({
            key: row.option_key,
            text: row.option_text,
        });
    });

    questionIds.forEach((questionId) => {
        if (!optionMap.has(questionId)) {
            optionMap.set(questionId, legacyOptionsById.get(questionId) || []);
        }
    });

    return optionMap;
};

const mapQuestionRow = (row, optionMap) => {
    const options = optionMap.get(row.id) || [];
    const stem = row.stem || row.content || '';
    return {
        id: row.id,
        bank_id: row.bank_id,
        type: row.type || 'unknown',
        stem,
        content: row.content || formatLegacyContent({ stem, options }),
        options,
        answer: row.answer || '',
        analysis: row.analysis || '',
        difficulty: row.difficulty || '',
        source: row.source || '',
        raw_text: row.raw_text || row.content || '',
        normalized_hash: row.normalized_hash || '',
        import_batch_id: row.import_batch_id || null,
        is_bookmarked: row.is_bookmarked ? 1 : 0,
        mastery_status: row.mastery_status || 'unseen',
        last_viewed_at: row.last_viewed_at || null,
        view_count: row.view_count || 0,
    };
};

const buildQuestionFilterQuery = ({ bookmarkedOnly = false, filters = {} }) => {
    const where = ['q.bank_id = ?'];
    const params = [];

    if (bookmarkedOnly || filters.bookmarked) {
        where.push('bm.user_id IS NOT NULL');
    }

    if (filters.keyword) {
        where.push('(COALESCE(q.stem, q.content, \'\') LIKE ? OR COALESCE(q.answer, \'\') LIKE ? OR COALESCE(q.source, \'\') LIKE ?)');
        params.push(`%${filters.keyword}%`, `%${filters.keyword}%`, `%${filters.keyword}%`);
    }

    if (filters.type) {
        where.push('q.type = ?');
        params.push(filters.type);
    }

    if (filters.hasAnalysis === 'true') {
        where.push(`COALESCE(q.analysis, '') != ''`);
    } else if (filters.hasAnalysis === 'false') {
        where.push(`COALESCE(q.analysis, '') = ''`);
    }

    if (filters.masteryStatus) {
        where.push(`COALESCE(qp.mastery_status, 'unseen') = ?`);
        params.push(filters.masteryStatus);
    }

    return { where, params };
};

const getQuestionsForBank = async (userId, bankId, bookmarkedOnly = false, filters = {}) => {
    const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, userId]);
    if (!bank) {
        const error = new Error('题库不存在');
        error.status = 404;
        throw error;
    }

    const { where, params } = buildQuestionFilterQuery({ bookmarkedOnly, filters });
    const sql = `SELECT q.*,
                        CASE WHEN bm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_bookmarked,
                        COALESCE(qp.mastery_status, 'unseen') AS mastery_status,
                        qp.last_viewed_at,
                        COALESCE(qp.view_count, 0) AS view_count
                 FROM questions q
                 LEFT JOIN bookmarks bm ON q.id = bm.question_id AND bm.user_id = ?
                 LEFT JOIN question_progress qp ON q.id = qp.question_id AND qp.user_id = ?
                 WHERE q.deleted_at IS NULL AND ${where.join(' AND ')}
                 ORDER BY q.id`;

    const rows = await dbAll(sql, [userId, userId, bankId, ...params]);
    const legacyOptionsById = new Map(rows.map((row) => [row.id, parseLegacyOptions(row.options)]));
    const optionMap = await getQuestionOptions(rows.map((row) => row.id), legacyOptionsById);

    return rows.map((row) => mapQuestionRow(row, optionMap));
};

const ensureFolderOwnership = async (userId, folderId) => {
    if (!folderId) return;
    const folder = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folderId, userId]);
    if (!folder) {
        const error = new Error('目标文件夹不存在');
        error.status = 404;
        throw error;
    }
};

const getExistingHashesForUser = async (userId) => {
    const rows = await dbAll(
        `SELECT q.normalized_hash
         FROM questions q
         JOIN banks b ON b.id = q.bank_id
         WHERE b.user_id = ? AND b.deleted_at IS NULL AND q.deleted_at IS NULL AND q.normalized_hash IS NOT NULL AND q.normalized_hash != ''`,
        [userId],
    );

    return new Set(rows.map((row) => row.normalized_hash));
};

const refreshBankQuestionCount = async (bankId) => {
    const row = await dbGet('SELECT COUNT(*) AS count FROM questions WHERE bank_id = ? AND deleted_at IS NULL', [bankId]);
    await dbRun('UPDATE banks SET question_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [row.count, bankId]);
};

const softDeleteQuestion = async (questionId) => {
    await dbRun('UPDATE questions SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deleted_at IS NULL', [questionId]);
};

const permanentDeleteQuestion = async (questionId) => {
    await dbRun('DELETE FROM bookmarks WHERE question_id = ?', [questionId]);
    await dbRun('DELETE FROM question_options WHERE question_id = ?', [questionId]);
    await dbRun('DELETE FROM question_progress WHERE question_id = ?', [questionId]);
    await dbRun('DELETE FROM questions WHERE id = ?', [questionId]);
};

const softDeleteBank = async (bankId, userId) => {
    const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, userId]);
    if (!bank) {
        const error = new Error('题库不存在');
        error.status = 404;
        throw error;
    }

    await dbExec('BEGIN TRANSACTION');
    try {
        await dbRun('UPDATE questions SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE bank_id = ? AND deleted_at IS NULL', [bankId]);
        await dbRun('UPDATE banks SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [bankId, userId]);
        await refreshBankQuestionCount(bankId);
        await dbExec('COMMIT');
    } catch (error) {
        await dbExec('ROLLBACK');
        throw error;
    }
};

const permanentDeleteBank = async (bankId, userId) => {
    const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ?', [bankId, userId]);
    if (!bank) {
        const error = new Error('题库不存在');
        error.status = 404;
        throw error;
    }

    const questionIds = await dbAll('SELECT id FROM questions WHERE bank_id = ?', [bankId]);

    await dbExec('BEGIN TRANSACTION');
    try {
        for (const question of questionIds) {
            await permanentDeleteQuestion(question.id);
        }
        await dbRun('DELETE FROM import_batches WHERE bank_id = ?', [bankId]);
        await dbRun('DELETE FROM banks WHERE id = ? AND user_id = ?', [bankId, userId]);
        await dbExec('COMMIT');
    } catch (error) {
        await dbExec('ROLLBACK');
        throw error;
    }
};

const getDescendantFolderIds = async (userId, rootFolderId, includeDeleted = false) => {
    const allFolders = await dbAll(
        `SELECT id, parent_id FROM folders WHERE user_id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
        [userId],
    );
    const childrenMap = new Map();
    allFolders.forEach((folder) => {
        const parentKey = folder.parent_id || 'root';
        if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
        childrenMap.get(parentKey).push(folder.id);
    });

    const result = [];
    const stack = [Number(rootFolderId)];
    while (stack.length > 0) {
        const current = stack.pop();
        result.push(current);
        const children = childrenMap.get(current) || [];
        children.forEach((childId) => stack.push(childId));
    }

    return result;
};

const buildFolderTree = (folders, parentId = null) => folders
    .filter((folder) => (folder.parent_id || null) === parentId)
    .map((folder) => ({
        ...folder,
        children: buildFolderTree(folders, folder.id),
    }));

const getFolderImpactStats = async (userId, folderId) => {
    const folderIds = await getDescendantFolderIds(userId, folderId);
    const placeholders = folderIds.map(() => '?').join(',');
    const params = [userId, ...folderIds];
    const bankCountRow = await dbGet(
        `SELECT COUNT(*) AS count FROM banks WHERE user_id = ? AND deleted_at IS NULL AND folder_id IN (${placeholders})`,
        params,
    );
    const questionCountRow = await dbGet(
        `SELECT COUNT(*) AS count
         FROM questions q
         JOIN banks b ON b.id = q.bank_id
         WHERE b.user_id = ? AND b.deleted_at IS NULL AND q.deleted_at IS NULL AND b.folder_id IN (${placeholders})`,
        params,
    );

    return {
        folder_count: folderIds.length,
        bank_count: bankCountRow.count,
        question_count: questionCountRow.count,
    };
};

const getBankStats = async (bankId, userId) => {
    const bank = await dbGet('SELECT id, name, updated_at FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, userId]);
    if (!bank) {
        const error = new Error('题库不存在');
        error.status = 404;
        throw error;
    }

    const row = await dbGet(
        `SELECT
            COUNT(*) AS question_count,
            SUM(CASE WHEN COALESCE(q.analysis, '') != '' THEN 1 ELSE 0 END) AS analysis_count,
            SUM(CASE WHEN bm.user_id IS NOT NULL THEN 1 ELSE 0 END) AS bookmark_count
         FROM questions q
         LEFT JOIN bookmarks bm ON bm.question_id = q.id AND bm.user_id = ?
         WHERE q.bank_id = ? AND q.deleted_at IS NULL`,
        [userId, bankId],
    );

    return {
        ...bank,
        question_count: row.question_count || 0,
        analysis_count: row.analysis_count || 0,
        bookmark_count: row.bookmark_count || 0,
    };
};

const getRecycleBinItems = async (userId) => {
    const [folders, banks, questions] = await Promise.all([
        dbAll('SELECT id, name, parent_id, deleted_at FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC', [userId]),
        dbAll('SELECT id, name, folder_id, deleted_at, updated_at FROM banks WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC', [userId]),
        dbAll(
            `SELECT q.id, COALESCE(q.stem, q.content) AS name, q.bank_id, q.deleted_at
             FROM questions q
             JOIN banks b ON b.id = q.bank_id
             WHERE b.user_id = ? AND q.deleted_at IS NOT NULL
             ORDER BY q.deleted_at DESC`,
            [userId],
        ),
    ]);

    return {
        folders: folders.map((item) => ({ ...item, type: 'folder' })),
        banks: banks.map((item) => ({ ...item, type: 'bank' })),
        questions: questions.map((item) => ({ ...item, type: 'question' })),
    };
};

const restoreBank = async (bankId, userId) => {
    const bank = await dbGet('SELECT id, folder_id, name FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL', [bankId, userId]);
    if (!bank) throw Object.assign(new Error('题库不存在于回收站'), { status: 404 });
    if (bank.folder_id) {
        const folder = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bank.folder_id, userId]);
        if (!folder) throw Object.assign(new Error('原文件夹不存在，无法恢复题库'), { status: 400 });
    }
    await dbRun('UPDATE banks SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [bankId, userId]);
    await dbRun('UPDATE questions SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE bank_id = ?', [bankId]);
    await refreshBankQuestionCount(bankId);
};

const restoreFolder = async (folderId, userId) => {
    const folder = await dbGet('SELECT id, parent_id, name FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL', [folderId, userId]);
    if (!folder) throw Object.assign(new Error('文件夹不存在于回收站'), { status: 404 });
    if (folder.parent_id) {
        const parent = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folder.parent_id, userId]);
        if (!parent) throw Object.assign(new Error('原父文件夹不存在，无法恢复'), { status: 400 });
    }
    const folderIds = await getDescendantFolderIds(userId, folderId, true);
    const placeholders = folderIds.map(() => '?').join(',');
    const banks = await dbAll(`SELECT id FROM banks WHERE user_id = ? AND folder_id IN (${placeholders})`, [userId, ...folderIds]);
    await dbRun(`UPDATE folders SET deleted_at = NULL WHERE user_id = ? AND id IN (${placeholders})`, [userId, ...folderIds]);
    await dbRun(`UPDATE banks SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND folder_id IN (${placeholders})`, [userId, ...folderIds]);
    for (const bank of banks) {
        await dbRun('UPDATE questions SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE bank_id = ?', [bank.id]);
        await refreshBankQuestionCount(bank.id);
    }
};

const restoreQuestion = async (questionId, userId) => {
    const question = await dbGet(
        `SELECT q.id, q.bank_id
         FROM questions q
         JOIN banks b ON b.id = q.bank_id
         WHERE q.id = ? AND b.user_id = ? AND q.deleted_at IS NOT NULL`,
        [questionId, userId],
    );
    if (!question) throw Object.assign(new Error('题目不存在于回收站'), { status: 404 });

    const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [question.bank_id, userId]);
    if (!bank) throw Object.assign(new Error('原题库不存在，无法恢复题目'), { status: 400 });

    await dbRun('UPDATE questions SET deleted_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [questionId]);
    await refreshBankQuestionCount(question.bank_id);
};

const initDatabase = async () => {
    await dbExec(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT
        );

        CREATE TABLE IF NOT EXISTS invite_codes (
            code TEXT PRIMARY KEY,
            is_used INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            parent_id INTEGER,
            user_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS banks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            folder_id INTEGER,
            user_id INTEGER
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bank_id INTEGER,
            content TEXT,
            options TEXT,
            answer TEXT,
            analysis TEXT
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            user_id INTEGER,
            question_id INTEGER,
            PRIMARY KEY (user_id, question_id)
        );

        CREATE TABLE IF NOT EXISTS question_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            question_id INTEGER NOT NULL,
            option_key TEXT NOT NULL,
            option_text TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
            UNIQUE (question_id, option_key)
        );

        CREATE TABLE IF NOT EXISTS import_batches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bank_id INTEGER,
            source_type TEXT,
            original_name TEXT,
            raw_content TEXT,
            status TEXT DEFAULT 'completed',
            total_count INTEGER DEFAULT 0,
            success_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            duplicate_count INTEGER DEFAULT 0,
            error_summary TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (bank_id) REFERENCES banks(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS question_progress (
            user_id INTEGER NOT NULL,
            question_id INTEGER NOT NULL,
            mastery_status TEXT DEFAULT 'unseen',
            last_viewed_at TEXT,
            view_count INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, question_id)
        );

        CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);
        CREATE INDEX IF NOT EXISTS idx_banks_user_folder ON banks(user_id, folder_id);
        CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(bank_id);
        CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);
        CREATE INDEX IF NOT EXISTS idx_import_batches_user ON import_batches(user_id);
        CREATE INDEX IF NOT EXISTS idx_question_progress_user ON question_progress(user_id);
    `);

    await ensureColumn('banks', 'question_count', 'INTEGER DEFAULT 0');
    await ensureColumn('users', 'ai_provider', 'TEXT');
    await ensureColumn('users', 'ai_api_key_encrypted', 'TEXT');
    await ensureColumn('users', 'ai_api_key_iv', 'TEXT');
    await ensureColumn('users', 'ai_api_key_tag', 'TEXT');
    await ensureColumn('banks', 'created_at', 'TEXT');
    await ensureColumn('banks', 'updated_at', 'TEXT');
    await ensureColumn('banks', 'deleted_at', 'TEXT');
    await ensureColumn('folders', 'deleted_at', 'TEXT');
    await ensureColumn('questions', 'deleted_at', 'TEXT');

    await ensureColumn('questions', 'type', 'TEXT');
    await ensureColumn('questions', 'stem', 'TEXT');
    await ensureColumn('questions', 'difficulty', 'TEXT');
    await ensureColumn('questions', 'source', 'TEXT');
    await ensureColumn('questions', 'raw_text', 'TEXT');
    await ensureColumn('questions', 'normalized_hash', 'TEXT');
    await ensureColumn('questions', 'import_batch_id', 'INTEGER');
    await ensureColumn('questions', 'created_at', 'TEXT');
    await ensureColumn('questions', 'updated_at', 'TEXT');

    await dbExec(`
        CREATE INDEX IF NOT EXISTS idx_questions_hash ON questions(normalized_hash);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
    `);

    await dbRun(`UPDATE banks SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)`);
    await dbRun(`UPDATE questions SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP), updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)`);
    await dbRun(`UPDATE questions SET stem = COALESCE(NULLIF(stem, ''), content) WHERE content IS NOT NULL`);
    await dbRun(`UPDATE questions SET raw_text = COALESCE(NULLIF(raw_text, ''), content) WHERE content IS NOT NULL`);
    await dbRun(`UPDATE questions SET type = COALESCE(NULLIF(type, ''), 'unknown')`);

    const existingQuestions = await dbAll('SELECT id, stem, content, answer, options, normalized_hash FROM questions');
    for (const question of existingQuestions) {
        if (!question.normalized_hash) {
            const hash = createNormalizedHash({
                stem: question.stem || question.content || '',
                options: parseLegacyOptions(question.options),
                answer: question.answer || '',
            });
            await dbRun('UPDATE questions SET normalized_hash = ? WHERE id = ?', [hash, question.id]);
        }
    }

    const banks = await dbAll('SELECT id FROM banks');
    for (const bank of banks) {
        await refreshBankQuestionCount(bank.id);
    }

    const inviteStats = await dbGet('SELECT COUNT(*) AS count FROM invite_codes');
    if (inviteStats.count === 0) {
        const code = 'VIP888';
        await dbRun('INSERT INTO invite_codes (code) VALUES (?)', [code]);
        console.log(`[System] 初始化完成。默认邀请码: ${code}`);
    }
};

app.post('/api/register', applyRateLimit({
    keyPrefix: 'register',
    limit: REGISTER_RATE_LIMIT_MAX,
    windowMs: REGISTER_RATE_LIMIT_WINDOW_MS,
    message: '注册请求过于频繁，请稍后再试',
    code: 'REGISTER_RATE_LIMITED',
}), async (req, res) => {
    try {
        const { username, password, inviteCode } = req.body;
        if (!username || !password || !inviteCode) return sendError(res, '请填写完整信息');

        const code = await dbGet('SELECT * FROM invite_codes WHERE code = ? AND is_used = 0', [inviteCode]);
        if (!code) return sendError(res, '无效或已被使用的邀请码');

        const hash = bcrypt.hashSync(password, 10);
        await dbRun('INSERT INTO users (username, password) VALUES (?, ?)', [username.trim(), hash]);
        await dbRun('UPDATE invite_codes SET is_used = 1 WHERE code = ?', [inviteCode]);

        res.json({ success: true });
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
            return sendError(res, '用户名已存在');
        }
        return sendError(res, error.message || '注册失败', 500);
    }
});

app.post('/api/login', applyRateLimit({
    keyPrefix: 'login',
    limit: LOGIN_RATE_LIMIT_MAX,
    windowMs: LOGIN_RATE_LIMIT_WINDOW_MS,
    message: '登录尝试过于频繁，请稍后再试',
    code: 'LOGIN_RATE_LIMITED',
}), async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || !bcrypt.compareSync(password, user.password)) {
            logger.warn('Login failed', { username });
            return sendError(res, '用户名或密码错误', 400, 'LOGIN_FAILED');
        }

        const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '30d' });
        setAuthCookie(res, token);
        res.json({ username: user.username });
    } catch (error) {
        return sendError(res, error.message || '登录失败', 500);
    }
});

app.get('/api/me', authenticateToken, async (req, res) => {
    const user = await dbGet(
        'SELECT id, username, ai_provider, ai_api_key_encrypted FROM users WHERE id = ?',
        [req.user.id],
    );
    res.json({
        id: user.id,
        username: user.username,
        aiProvider: user.ai_provider || 'gemini',
        aiConfigured: Boolean(user.ai_api_key_encrypted),
    });
});

app.post('/api/logout', async (req, res) => {
    clearAuthCookie(res);
    res.json({ success: true });
});

app.get('/api/ai-config', authenticateToken, async (req, res) => {
    const user = await dbGet(
        'SELECT ai_provider, ai_api_key_encrypted FROM users WHERE id = ?',
        [req.user.id],
    );
    res.json({
        provider: user?.ai_provider || 'gemini',
        hasKey: Boolean(user?.ai_api_key_encrypted),
    });
});

app.post('/api/ai-config', authenticateToken, async (req, res) => {
    try {
        const provider = String(req.body.provider || 'gemini').trim();
        const key = typeof req.body.key === 'string' ? req.body.key.trim() : '';
        const clearKey = req.body.clearKey === true;
        const supportedProviders = ['gemini', 'deepseek'];

        if (!supportedProviders.includes(provider)) {
            return sendError(res, '不支持的 AI Provider');
        }

        const existing = await dbGet(
            'SELECT ai_api_key_encrypted FROM users WHERE id = ?',
            [req.user.id],
        );

        let encrypted = null;
        let iv = null;
        let tag = null;

        if (!clearKey && key) {
            const payload = encryptSecret(key);
            encrypted = payload.encrypted;
            iv = payload.iv;
            tag = payload.tag;
        } else if (!clearKey && existing?.ai_api_key_encrypted) {
            const current = await dbGet(
                'SELECT ai_api_key_encrypted, ai_api_key_iv, ai_api_key_tag FROM users WHERE id = ?',
                [req.user.id],
            );
            encrypted = current.ai_api_key_encrypted;
            iv = current.ai_api_key_iv;
            tag = current.ai_api_key_tag;
        }

        await dbRun(
            `UPDATE users
             SET ai_provider = ?, ai_api_key_encrypted = ?, ai_api_key_iv = ?, ai_api_key_tag = ?
             WHERE id = ?`,
            [provider, encrypted, iv, tag, req.user.id],
        );

        res.json({
            success: true,
            provider,
            hasKey: Boolean(encrypted),
        });
    } catch (error) {
        return sendError(res, error.message || '保存 AI 配置失败', 500, 'AI_CONFIG_SAVE_FAILED');
    }
});

app.get('/api/folders', authenticateToken, async (req, res) => {
    try {
        const parentId = req.query.parentId || null;
        const sql = parentId
            ? 'SELECT * FROM folders WHERE user_id = ? AND deleted_at IS NULL AND parent_id = ? ORDER BY id'
            : 'SELECT * FROM folders WHERE user_id = ? AND deleted_at IS NULL AND parent_id IS NULL ORDER BY id';
        const params = parentId ? [req.user.id, parentId] : [req.user.id];
        const rows = await dbAll(sql, params);
        res.json(rows);
    } catch (error) {
        return sendError(res, error.message || '获取文件夹失败', 500);
    }
});

app.get('/api/folders/tree', authenticateToken, async (req, res) => {
    try {
        const folders = await dbAll(
            'SELECT id, name, parent_id, user_id FROM folders WHERE user_id = ? AND deleted_at IS NULL ORDER BY id',
            [req.user.id],
        );
        res.json({
            flat: folders,
            tree: buildFolderTree(folders),
        });
    } catch (error) {
        return sendError(res, error.message || '获取目录树失败', 500);
    }
});

app.post('/api/folders', authenticateToken, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const parentId = req.body.parentId || null;
        if (!name) return sendError(res, '名称不能为空');
        await ensureFolderOwnership(req.user.id, parentId);
        const result = await dbRun('INSERT INTO folders (name, parent_id, user_id) VALUES (?, ?, ?)', [name, parentId, req.user.id]);
        res.json({ id: result.lastID, name, parentId });
    } catch (error) {
        return sendError(res, error.message || '创建文件夹失败', error.status || 500);
    }
});

app.patch('/api/folders/:id', authenticateToken, async (req, res) => {
    try {
        const folderId = Number(req.params.id);
        const name = String(req.body.name || '').trim();
        if (!name) return sendError(res, '名称不能为空');

        const folder = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folderId, req.user.id]);
        if (!folder) return sendError(res, '文件夹不存在', 404);

        await dbRun('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?', [name, folderId, req.user.id]);
        res.json({ success: true, id: folderId, name });
    } catch (error) {
        return sendError(res, error.message || '重命名文件夹失败', error.status || 500);
    }
});

app.patch('/api/folders/:id/move', authenticateToken, async (req, res) => {
    try {
        const folderId = Number(req.params.id);
        const nextParentId = req.body.parentId || null;
        const folder = await dbGet('SELECT id, parent_id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folderId, req.user.id]);
        if (!folder) return sendError(res, '文件夹不存在', 404);

        if (nextParentId && Number(nextParentId) === folderId) {
            return sendError(res, '不能将文件夹移动到自身');
        }

        if (nextParentId) {
            const parent = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [nextParentId, req.user.id]);
            if (!parent) return sendError(res, '目标父文件夹不存在', 404);

            const descendants = await getDescendantFolderIds(req.user.id, folderId);
            if (descendants.includes(Number(nextParentId))) {
                return sendError(res, '不能移动到自己的子目录下');
            }
        }

        await dbRun('UPDATE folders SET parent_id = ? WHERE id = ? AND user_id = ?', [nextParentId, folderId, req.user.id]);
        res.json({ success: true, id: folderId, parentId: nextParentId });
    } catch (error) {
        return sendError(res, error.message || '移动文件夹失败', error.status || 500);
    }
});

app.get('/api/folders/:id/stats', authenticateToken, async (req, res) => {
    try {
        const folderId = Number(req.params.id);
        const folder = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folderId, req.user.id]);
        if (!folder) return sendError(res, '文件夹不存在', 404);

        const stats = await getFolderImpactStats(req.user.id, folderId);
        res.json(stats);
    } catch (error) {
        return sendError(res, error.message || '获取文件夹统计失败', error.status || 500);
    }
});

app.delete('/api/folders/:id', authenticateToken, async (req, res) => {
    try {
        const folderId = Number(req.params.id);
        const folder = await dbGet('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [folderId, req.user.id]);
        if (!folder) return sendError(res, '文件夹不存在', 404);

        const folderIds = await getDescendantFolderIds(req.user.id, folderId);
        const placeholders = folderIds.map(() => '?').join(',');
        const banks = await dbAll(`SELECT id FROM banks WHERE user_id = ? AND deleted_at IS NULL AND folder_id IN (${placeholders})`, [req.user.id, ...folderIds]);

        for (const bank of banks) {
            await softDeleteBank(bank.id, req.user.id);
        }

        await dbRun(`UPDATE folders SET deleted_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id IN (${placeholders})`, [req.user.id, ...folderIds]);
        res.json({ success: true });
    } catch (error) {
        return sendError(res, error.message || '删除文件夹失败', error.status || 500);
    }
});

app.get('/api/banks', authenticateToken, async (req, res) => {
    try {
        const folderId = req.query.folderId || null;
        const sql = folderId
            ? `SELECT b.*,
                      COALESCE(b.question_count, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.deleted_at IS NULL)) AS question_count,
                      COALESCE((SELECT COUNT(*) FROM bookmarks bm JOIN questions q ON q.id = bm.question_id WHERE q.bank_id = b.id AND q.deleted_at IS NULL AND bm.user_id = ?), 0) AS bookmark_count,
                      COALESCE((SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.deleted_at IS NULL AND COALESCE(q.analysis, '') != ''), 0) AS analysis_count
               FROM banks b
               WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.folder_id = ?
               ORDER BY b.id`
            : `SELECT b.*,
                      COALESCE(b.question_count, (SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.deleted_at IS NULL)) AS question_count,
                      COALESCE((SELECT COUNT(*) FROM bookmarks bm JOIN questions q ON q.id = bm.question_id WHERE q.bank_id = b.id AND q.deleted_at IS NULL AND bm.user_id = ?), 0) AS bookmark_count,
                      COALESCE((SELECT COUNT(*) FROM questions q WHERE q.bank_id = b.id AND q.deleted_at IS NULL AND COALESCE(q.analysis, '') != ''), 0) AS analysis_count
               FROM banks b
               WHERE b.user_id = ? AND b.deleted_at IS NULL AND b.folder_id IS NULL
               ORDER BY b.id`;
        const params = folderId ? [req.user.id, req.user.id, folderId] : [req.user.id, req.user.id];
        const rows = await dbAll(sql, params);
        res.json(rows);
    } catch (error) {
        return sendError(res, error.message || '获取题库失败', 500);
    }
});

app.post('/api/banks', authenticateToken, async (req, res) => {
    try {
        const name = String(req.body.name || '').trim();
        const folderId = req.body.folderId || null;
        if (!name) return sendError(res, '题库名称不能为空');
        await ensureFolderOwnership(req.user.id, folderId);

        const result = await dbRun(
            `INSERT INTO banks (name, folder_id, user_id, question_count, created_at, updated_at)
             VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            [name, folderId, req.user.id],
        );
        res.json({ id: result.lastID, name, folderId });
    } catch (error) {
        return sendError(res, error.message || '创建题库失败', error.status || 500);
    }
});

app.patch('/api/banks/:id', authenticateToken, async (req, res) => {
    try {
        const bankId = Number(req.params.id);
        const name = String(req.body.name || '').trim();
        if (!name) return sendError(res, '题库名称不能为空');

        const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, req.user.id]);
        if (!bank) return sendError(res, '题库不存在', 404);

        await dbRun('UPDATE banks SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?', [name, bankId, req.user.id]);
        res.json({ success: true, id: bankId, name });
    } catch (error) {
        return sendError(res, error.message || '重命名题库失败', error.status || 500);
    }
});

app.patch('/api/banks/:id/move', authenticateToken, async (req, res) => {
    try {
        const bankId = Number(req.params.id);
        const nextFolderId = req.body.folderId || null;
        const bank = await dbGet('SELECT id FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, req.user.id]);
        if (!bank) return sendError(res, '题库不存在', 404);

        await ensureFolderOwnership(req.user.id, nextFolderId);
        await dbRun(
            'UPDATE banks SET folder_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
            [nextFolderId, bankId, req.user.id],
        );
        res.json({ success: true, id: bankId, folderId: nextFolderId });
    } catch (error) {
        return sendError(res, error.message || '移动题库失败', error.status || 500);
    }
});

app.get('/api/banks/:id/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await getBankStats(Number(req.params.id), req.user.id);
        res.json(stats);
    } catch (error) {
        return sendError(res, error.message || '获取题库统计失败', error.status || 500);
    }
});

app.get('/api/banks/:id/export', authenticateToken, async (req, res) => {
    try {
        const bankId = Number(req.params.id);
        const format = ['json', 'markdown', 'csv'].includes(req.query.format) ? req.query.format : 'json';
        const scope = req.query.scope === 'bookmarks' ? 'bookmarks' : 'all';
        const bank = await dbGet('SELECT id, name, updated_at FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, req.user.id]);
        if (!bank) return sendError(res, '题库不存在', 404, 'BANK_NOT_FOUND');

        const questions = await getQuestionsForBank(req.user.id, bankId, scope === 'bookmarks', {});
        const payload = buildExportPayload({ bank, questions, format, scope });
        const extension = format === 'markdown' ? 'md' : format;
        const filename = `${bank.name}${scope === 'bookmarks' ? '-收藏夹' : ''}.${extension}`;
        res.setHeader('Content-Type', getExportMimeType(format));
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.send(payload);
    } catch (error) {
        return sendError(res, error.message || '导出题库失败', error.status || 500, 'BANK_EXPORT_FAILED');
    }
});

app.get('/api/recycle-bin', authenticateToken, async (req, res) => {
    try {
        const items = await getRecycleBinItems(req.user.id);
        res.json(items);
    } catch (error) {
        return sendError(res, error.message || '获取回收站失败', error.status || 500, 'RECYCLE_BIN_FAILED');
    }
});

app.post('/api/recycle-bin/:type/:id/restore', authenticateToken, async (req, res) => {
    try {
        const itemType = req.params.type;
        const itemId = Number(req.params.id);

        if (itemType === 'folder') await restoreFolder(itemId, req.user.id);
        else if (itemType === 'bank') await restoreBank(itemId, req.user.id);
        else if (itemType === 'question') await restoreQuestion(itemId, req.user.id);
        else return sendError(res, '不支持的回收站类型', 400, 'RECYCLE_BIN_TYPE_INVALID');

        logger.info('Recycle item restored', { userId: req.user.id, itemType, itemId });
        res.json({ success: true });
    } catch (error) {
        return sendError(res, error.message || '恢复失败', error.status || 500, 'RECYCLE_BIN_RESTORE_FAILED');
    }
});

app.delete('/api/recycle-bin/:type/:id', authenticateToken, async (req, res) => {
    try {
        const itemType = req.params.type;
        const itemId = Number(req.params.id);

        if (itemType === 'folder') {
            const folderIds = await getDescendantFolderIds(req.user.id, itemId, true);
            const placeholders = folderIds.map(() => '?').join(',');
            const banks = await dbAll(`SELECT id FROM banks WHERE user_id = ? AND folder_id IN (${placeholders})`, [req.user.id, ...folderIds]);
            for (const bank of banks) {
                await permanentDeleteBank(bank.id, req.user.id);
            }
            await dbRun(`DELETE FROM folders WHERE user_id = ? AND id IN (${placeholders})`, [req.user.id, ...folderIds]);
        } else if (itemType === 'bank') {
            await permanentDeleteBank(itemId, req.user.id);
        } else if (itemType === 'question') {
            const question = await dbGet(
                `SELECT q.id, q.bank_id
                 FROM questions q
                 JOIN banks b ON b.id = q.bank_id
                 WHERE q.id = ? AND b.user_id = ?`,
                [itemId, req.user.id],
            );
            if (!question) return sendError(res, '题目不存在', 404, 'QUESTION_NOT_FOUND');
            await permanentDeleteQuestion(itemId);
            await refreshBankQuestionCount(question.bank_id);
        } else {
            return sendError(res, '不支持的回收站类型', 400, 'RECYCLE_BIN_TYPE_INVALID');
        }

        logger.warn('Recycle item permanently deleted', { userId: req.user.id, itemType, itemId });
        res.json({ success: true });
    } catch (error) {
        return sendError(res, error.message || '永久删除失败', error.status || 500, 'RECYCLE_BIN_DELETE_FAILED');
    }
});

app.delete('/api/banks/:id', authenticateToken, async (req, res) => {
    try {
        await softDeleteBank(Number(req.params.id), req.user.id);
        res.json({ success: true });
    } catch (error) {
        return sendError(res, error.message || '删除题库失败', error.status || 500);
    }
});

app.post('/api/import/parse', authenticateToken, async (req, res) => {
    try {
        cleanupExpiredPreviews();
        const bankName = String(req.body.bankName || '').trim();
        const folderId = req.body.folderId || null;
        const sourceType = req.body.sourceType || 'auto';
        const content = String(req.body.content || '');

        if (!bankName) return sendError(res, '题库名称不能为空');
        if (!content.trim()) return sendError(res, '请提供要导入的题目内容');

        await ensureFolderOwnership(req.user.id, folderId);

        const existingHashes = await getExistingHashesForUser(req.user.id);
        const parsed = parseImportContent({ content, existingHashes, sourceType });
        if (parsed.summary.total === 0) return sendError(res, '未能识别题目，请检查格式');

        const previewId = generatePreviewId();
        importPreviews.set(previewId, {
            userId: req.user.id,
            bankName,
            folderId,
            sourceType,
            rawContent: content,
            items: parsed.items,
            createdAt: Date.now(),
        });

        logger.info('Import parsed', { userId: req.user.id, bankName, total: parsed.summary.total });

        res.json({
            previewId,
            summary: parsed.summary,
            items: parsed.items,
        });
    } catch (error) {
        return sendError(res, error.message || '解析题库失败', error.status || 500);
    }
});

app.post('/api/import/commit', authenticateToken, async (req, res) => {
    try {
        cleanupExpiredPreviews();
        const previewId = req.body.previewId;
        const skipDuplicates = req.body.skipDuplicates !== false;
        const preview = importPreviews.get(previewId);

        if (!preview || preview.userId !== req.user.id) {
            return sendError(res, '导入预览已失效，请重新解析');
        }

        await ensureFolderOwnership(req.user.id, preview.folderId);

        const importableItems = preview.items.filter((item) => {
            if (item.status === 'failed') return false;
            if (item.status === 'duplicate' && skipDuplicates) return false;
            return true;
        });

        if (importableItems.length === 0) {
            return sendError(res, '没有可导入的题目，请调整后重试');
        }

        await dbExec('BEGIN TRANSACTION');
        let bankId = null;
        try {
            const bankResult = await dbRun(
                `INSERT INTO banks (name, folder_id, user_id, question_count, created_at, updated_at)
                 VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                [preview.bankName, preview.folderId, req.user.id],
            );
            bankId = bankResult.lastID;

            const batchResult = await dbRun(
                `INSERT INTO import_batches (
                    user_id, bank_id, source_type, original_name, raw_content, status,
                    total_count, success_count, failed_count, duplicate_count, error_summary
                 ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    bankId,
                    preview.sourceType,
                    preview.bankName,
                    preview.rawContent,
                    preview.items.length,
                    importableItems.length,
                    preview.items.filter((item) => item.status === 'failed').length,
                    preview.items.filter((item) => item.status === 'duplicate').length,
                    preview.items
                        .filter((item) => item.status === 'suspected')
                        .map((item) => `第 ${item.index} 题需要人工复核`)
                        .join('；'),
                ],
            );

            for (const item of importableItems) {
                const legacyContent = formatLegacyContent({ stem: item.stem, options: item.options });
                const questionResult = await dbRun(
                    `INSERT INTO questions (
                        bank_id, content, options, answer, analysis, type, stem, difficulty, source,
                        raw_text, normalized_hash, import_batch_id, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [
                        bankId,
                        legacyContent,
                        JSON.stringify(item.options || []),
                        item.answer || '',
                        item.analysis || '',
                        item.type || 'unknown',
                        item.stem || '',
                        item.difficulty || '',
                        preview.sourceType,
                        item.rawText || legacyContent,
                        item.normalizedHash || '',
                        batchResult.lastID,
                    ],
                );

                for (let index = 0; index < item.options.length; index += 1) {
                    const option = item.options[index];
                    await dbRun(
                        `INSERT INTO question_options (question_id, option_key, option_text, sort_order)
                         VALUES (?, ?, ?, ?)`,
                        [questionResult.lastID, option.key, option.text, index],
                    );
                }
            }

            await refreshBankQuestionCount(bankId);
            await dbExec('COMMIT');
        } catch (error) {
            await dbExec('ROLLBACK');
            throw error;
        }

        importPreviews.delete(previewId);
        logger.info('Import committed', { userId: req.user.id, bankId, importedCount: importableItems.length });
        res.json({
            success: true,
            bankId,
            bankName: preview.bankName,
            importedCount: importableItems.length,
            skippedDuplicateCount: preview.items.filter((item) => item.status === 'duplicate').length,
            suspectedCount: preview.items.filter((item) => item.status === 'suspected').length,
        });
    } catch (error) {
        return sendError(res, error.message || '导入题库失败', error.status || 500);
    }
});

app.post('/api/banks/:id/import', authenticateToken, async (req, res) => {
    try {
        const bankId = Number(req.params.id);
        const bank = await dbGet('SELECT * FROM banks WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [bankId, req.user.id]);
        if (!bank) return sendError(res, '题库不存在', 404);

        const text = String(req.body.text || '');
        if (!text.trim()) return sendError(res, '请提供要导入的题目内容');

        const existingHashes = await getExistingHashesForUser(req.user.id);
        const parsed = parseImportContent({ content: text, existingHashes, sourceType: 'text' });
        const importableItems = parsed.items.filter((item) => item.status !== 'failed' && item.status !== 'duplicate');
        if (!importableItems.length) return sendError(res, '没有可导入的题目');

        await dbExec('BEGIN TRANSACTION');
        try {
            const batchResult = await dbRun(
                `INSERT INTO import_batches (
                    user_id, bank_id, source_type, original_name, raw_content, status,
                    total_count, success_count, failed_count, duplicate_count, error_summary
                 ) VALUES (?, ?, 'legacy-import', ?, ?, 'completed', ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    bankId,
                    bank.name,
                    text,
                    parsed.items.length,
                    importableItems.length,
                    parsed.items.filter((item) => item.status === 'failed').length,
                    parsed.items.filter((item) => item.status === 'duplicate').length,
                    '',
                ],
            );

            for (const item of importableItems) {
                const legacyContent = formatLegacyContent({ stem: item.stem, options: item.options });
                const questionResult = await dbRun(
                    `INSERT INTO questions (
                        bank_id, content, options, answer, analysis, type, stem, difficulty, source,
                        raw_text, normalized_hash, import_batch_id, created_at, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
                    [
                        bankId,
                        legacyContent,
                        JSON.stringify(item.options || []),
                        item.answer || '',
                        item.analysis || '',
                        item.type || 'unknown',
                        item.stem || '',
                        item.difficulty || '',
                        'legacy-import',
                        item.rawText || legacyContent,
                        item.normalizedHash || '',
                        batchResult.lastID,
                    ],
                );

                for (let index = 0; index < item.options.length; index += 1) {
                    const option = item.options[index];
                    await dbRun(
                        'INSERT INTO question_options (question_id, option_key, option_text, sort_order) VALUES (?, ?, ?, ?)',
                        [questionResult.lastID, option.key, option.text, index],
                    );
                }
            }

            await refreshBankQuestionCount(bankId);
            await dbExec('COMMIT');
        } catch (error) {
            await dbExec('ROLLBACK');
            throw error;
        }

        res.json({ count: importableItems.length });
    } catch (error) {
        return sendError(res, error.message || '导入失败', error.status || 500);
    }
});

app.delete('/api/questions/:id', authenticateToken, async (req, res) => {
    try {
        const questionId = Number(req.params.id);
        const question = await dbGet(
            `SELECT q.id, q.bank_id
             FROM questions q
             JOIN banks b ON q.bank_id = b.id
             WHERE q.id = ? AND q.deleted_at IS NULL AND b.user_id = ? AND b.deleted_at IS NULL`,
            [questionId, req.user.id],
        );
        if (!question) return sendError(res, '题目不存在', 404);

        await dbExec('BEGIN TRANSACTION');
        try {
            await softDeleteQuestion(questionId);
            await refreshBankQuestionCount(question.bank_id);
            await dbExec('COMMIT');
        } catch (error) {
            await dbExec('ROLLBACK');
            throw error;
        }

        res.json({ success: true });
    } catch (error) {
        return sendError(res, error.message || '删除题目失败', error.status || 500);
    }
});

app.get('/api/banks/:id/questions', authenticateToken, async (req, res) => {
    try {
        const rows = await getQuestionsForBank(req.user.id, Number(req.params.id), false, req.query);
        res.json(rows);
    } catch (error) {
        return sendError(res, error.message || '获取题目失败', error.status || 500);
    }
});

app.post('/api/questions/:id/progress', authenticateToken, async (req, res) => {
    try {
        const questionId = Number(req.params.id);
        const { masteryStatus, viewed } = req.body || {};
        const validStatuses = ['unseen', 'learning', 'mastered', 'review'];
        if (masteryStatus && !validStatuses.includes(masteryStatus)) {
            return sendError(res, '无效的学习状态');
        }

        const question = await dbGet(
            `SELECT q.id
             FROM questions q
             JOIN banks b ON b.id = q.bank_id
             WHERE q.id = ? AND q.deleted_at IS NULL AND b.user_id = ? AND b.deleted_at IS NULL`,
            [questionId, req.user.id],
        );
        if (!question) return sendError(res, '题目不存在', 404);

        await dbRun(
            `INSERT INTO question_progress (user_id, question_id, mastery_status, last_viewed_at, view_count, updated_at)
             VALUES (?, ?, CASE WHEN ? IS NULL THEN 'unseen' ELSE ? END, CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END, CASE WHEN ? THEN 1 ELSE 0 END, CURRENT_TIMESTAMP)
             ON CONFLICT(user_id, question_id) DO UPDATE SET
                mastery_status = CASE WHEN ? IS NULL THEN question_progress.mastery_status ELSE ? END,
                last_viewed_at = CASE WHEN excluded.last_viewed_at IS NOT NULL THEN CURRENT_TIMESTAMP ELSE question_progress.last_viewed_at END,
                view_count = question_progress.view_count + CASE WHEN ? THEN 1 ELSE 0 END,
                updated_at = CURRENT_TIMESTAMP`,
            [
                req.user.id,
                questionId,
                masteryStatus || null,
                masteryStatus || null,
                viewed ? 1 : 0,
                viewed ? 1 : 0,
                masteryStatus || null,
                masteryStatus || null,
                viewed ? 1 : 0,
            ],
        );

        const progress = await dbGet(
            'SELECT mastery_status, last_viewed_at, view_count FROM question_progress WHERE user_id = ? AND question_id = ?',
            [req.user.id, questionId],
        );
        res.json(progress);
    } catch (error) {
        return sendError(res, error.message || '更新学习状态失败', error.status || 500);
    }
});

app.post('/api/bookmarks/toggle', authenticateToken, async (req, res) => {
    try {
        const questionId = Number(req.body.questionId);
        const question = await dbGet(
            `SELECT q.id
             FROM questions q
             JOIN banks b ON q.bank_id = b.id
             WHERE q.id = ? AND b.user_id = ?`,
            [questionId, req.user.id],
        );
        if (!question) return sendError(res, '题目不存在', 404);

        const row = await dbGet('SELECT * FROM bookmarks WHERE user_id = ? AND question_id = ?', [req.user.id, questionId]);
        if (row) {
            await dbRun('DELETE FROM bookmarks WHERE user_id = ? AND question_id = ?', [req.user.id, questionId]);
            return res.json({ is_bookmarked: 0 });
        }

        await dbRun('INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?)', [req.user.id, questionId]);
        return res.json({ is_bookmarked: 1 });
    } catch (error) {
        return sendError(res, error.message || '收藏操作失败', error.status || 500);
    }
});

app.get('/api/banks/:id/bookmarks', authenticateToken, async (req, res) => {
    try {
        const rows = await getQuestionsForBank(req.user.id, Number(req.params.id), true, req.query);
        res.json(rows);
    } catch (error) {
        return sendError(res, error.message || '获取收藏失败', error.status || 500);
    }
});

app.post('/api/ai-analyze', authenticateToken, async (req, res) => {
    try {
        const { questionId, question, answer } = req.body;
        const userConfig = await dbGet(
            `SELECT ai_provider, ai_api_key_encrypted, ai_api_key_iv, ai_api_key_tag
             FROM users
             WHERE id = ?`,
            [req.user.id],
        );
        const activeProvider = userConfig?.ai_provider || 'gemini';
        const activeApiKey = decryptSecret({
            encrypted: userConfig?.ai_api_key_encrypted,
            iv: userConfig?.ai_api_key_iv,
            tag: userConfig?.ai_api_key_tag,
        });

        if (!activeApiKey) {
            return sendError(res, '请先在 AI 设置中配置当前账号的 API Key', 400, 'AI_KEY_NOT_CONFIGURED');
        }

        if (questionId) {
            const ownedQuestion = await dbGet(
                `SELECT q.id
                 FROM questions q
                 JOIN banks b ON q.bank_id = b.id
                 WHERE q.id = ? AND q.deleted_at IS NULL AND b.user_id = ? AND b.deleted_at IS NULL`,
                [questionId, req.user.id],
            );
            if (!ownedQuestion) return sendError(res, '题目不存在', 404);
        }

        const analysisText = await analyzeQuestion({
            provider: activeProvider,
            apiKey: activeApiKey,
            question,
            answer,
        });

        if (questionId) {
            await dbRun('UPDATE questions SET analysis = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [analysisText, questionId]);
        }

        res.json({ analysis: analysisText });
    } catch (error) {
        logger.error('AI analyze failed', { message: error.message });
        return sendError(res, 'AI请求失败: ' + (error.response?.data?.error?.message || error.message));
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDatabase()
    .then(() => {
        if (process.env.JWT_SECRET) {
            logger.info('JWT secret loaded from environment');
        } else {
            logger.warn('Using fallback JWT secret. Configure JWT_SECRET in .env or environment variables.');
        }
        app.listen(PORT, () => {
            logger.info(`Server running on http://localhost:${PORT}`);
        });
    })
    .catch((error) => {
        logger.error('Database init failed', { message: error.message });
        process.exit(1);
    });
