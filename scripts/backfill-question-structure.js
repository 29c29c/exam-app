const { execFileSync } = require('child_process');
const path = require('path');

const { parseImportContent } = require('../services/import-parser');
const { formatLegacyContent } = require('../services/question-normalizer');

const dbPath = path.join(__dirname, '..', 'db', 'database.sqlite');

const runSqlite = (args) => execFileSync('sqlite3', args, { encoding: 'utf8' }).trim();
const escapeSql = (value = '') => String(value).replace(/'/g, "''");

const main = () => {
    const raw = runSqlite([dbPath, '-json', `
        SELECT id, content, answer, analysis, raw_text, stem, type, normalized_hash
        FROM questions
        ORDER BY id
    `]);
    const questions = raw ? JSON.parse(raw) : [];
    const statements = ['BEGIN TRANSACTION;'];

    questions.forEach((question) => {
        const sourceText = question.raw_text || question.content || '';
        const parsed = parseImportContent({ content: sourceText, existingHashes: new Set() });
        const item = parsed.items[0];

        if (!item || !item.stem) return;

        const content = formatLegacyContent({ stem: item.stem, options: item.options });
        statements.push(`DELETE FROM question_options WHERE question_id = ${question.id};`);
        statements.push(`
            UPDATE questions
            SET type = '${escapeSql(item.type || 'unknown')}',
                stem = '${escapeSql(item.stem || question.stem || question.content || '')}',
                difficulty = '${escapeSql(item.difficulty || '')}',
                raw_text = '${escapeSql(item.rawText || sourceText)}',
                normalized_hash = '${escapeSql(item.normalizedHash || '')}',
                options = '${escapeSql(JSON.stringify(item.options || []))}',
                content = '${escapeSql(content)}',
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${question.id};
        `);

        item.options.forEach((option, index) => {
            statements.push(`
                INSERT INTO question_options (question_id, option_key, option_text, sort_order)
                VALUES (${question.id}, '${escapeSql(option.key)}', '${escapeSql(option.text)}', ${index});
            `);
        });
    });

    statements.push(`
        UPDATE banks
        SET question_count = (SELECT COUNT(*) FROM questions q WHERE q.bank_id = banks.id),
            updated_at = CURRENT_TIMESTAMP;
    `);
    statements.push('COMMIT;');

    runSqlite([dbPath, statements.join('\n')]);
    console.log(`Backfilled ${questions.length} questions`);
};

main();
