const crypto = require('crypto');

const normalizeNewlines = (value = '') => value.replace(/\r\n?/g, '\n');

const normalizeFullWidth = (value = '') => value
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248))
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/【/g, '[')
    .replace(/】/g, ']')
    .replace(/：/g, ':')
    .replace(/，/g, ',')
    .replace(/；/g, ';')
    .replace(/。/g, '.')
    .replace(/．/g, '.')
    .replace(/、/g, '.');

const cleanupWhitespace = (value = '') => value
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();

const normalizeImportText = (value = '') => cleanupWhitespace(normalizeFullWidth(normalizeNewlines(value)));

const normalizeAnswer = (value = '') => {
    let normalized = normalizeFullWidth(String(value || ''))
        .toUpperCase()
        .replace(/[\/，、\s]+/g, ',')
        .replace(/\.+/g, ',')
        .replace(/,+/g, ',')
        .replace(/^,|,$/g, '');

    if (!normalized) return '';

    if (/^(正确|是)$/.test(normalized)) normalized = 'TRUE';
    if (/^(错误|否)$/.test(normalized)) normalized = 'FALSE';

    if (/^(TRUE|FALSE)$/.test(normalized)) {
        return normalized === 'TRUE' ? '对' : '错';
    }

    if (/^[A-Z]{2,}$/.test(normalized)) {
        normalized = normalized.split('').join(',');
    }

    return normalized;
};

const detectQuestionType = ({ blockText = '', options = [], answer = '' }) => {
    const text = normalizeFullWidth(blockText).toLowerCase();
    const normalizedAnswer = normalizeAnswer(answer);

    if (text.includes('多选题')) return 'multiple_choice';
    if (text.includes('单选题')) return 'single_choice';
    if (text.includes('判断题')) return 'true_false';
    if (text.includes('填空题')) return 'fill_blank';
    if (text.includes('简答题')) return 'short_answer';

    if (/^(对|错)$/.test(normalizedAnswer)) return 'true_false';
    if (/^[A-Z](?:,[A-Z])+$/i.test(normalizedAnswer)) return 'multiple_choice';
    if (/^[A-Z]$/i.test(normalizedAnswer) && options.length > 0) return 'single_choice';
    if (options.length > 0) return 'single_choice';

    return 'unknown';
};

const normalizeStemForHash = (value = '') => normalizeFullWidth(value)
    .replace(/^\d+\s*[.)]\s*/, '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/^(单选题|多选题|判断题|填空题|简答题)\s*/g, '')
    .replace(/\(\d+(?:\.\d+)?分\)/g, '')
    .replace(/难度[:：]?\s*\S+/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();

const createNormalizedHash = ({ stem = '', options = [], answer = '' }) => {
    const optionText = (options || [])
        .map((option) => `${option.key}:${normalizeStemForHash(option.text)}`)
        .join('|');
    const base = `${normalizeStemForHash(stem)}#${optionText}#${normalizeAnswer(answer)}`;

    return crypto.createHash('sha1').update(base).digest('hex');
};

const formatLegacyContent = ({ stem = '', options = [] }) => {
    const parts = [stem.trim()].filter(Boolean);

    (options || []).forEach((option) => {
        parts.push(`${option.key}. ${option.text}`.trim());
    });

    return parts.join('\n').trim();
};

module.exports = {
    cleanupWhitespace,
    createNormalizedHash,
    detectQuestionType,
    formatLegacyContent,
    normalizeAnswer,
    normalizeImportText,
};
