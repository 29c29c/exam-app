const {
    cleanupWhitespace,
    createNormalizedHash,
    detectQuestionType,
    normalizeAnswer,
    normalizeImportText,
} = require('./question-normalizer');

const QUESTION_START_RE = /^(?:(?:第\s*\d+\s*题)|(?:题目\s*\d+)|(?:\d+\s*[.)])|(?:[（(]\d+[）)]))\s*/i;
const OPTION_RE = /^(?:[-*]\s*)?(?:\*\*)?([A-H])(?:\*\*)?\s*[\.\):：]\s*(.+)$/i;
const ANSWER_RE = /^(?:\*\*)?(?:答案|参考答案|正确答案|answer)(?:\*\*)?\s*[:：]?\s*(.+)$/i;
const ANALYSIS_RE = /^(?:\*\*)?(?:解析|答案解析|analysis|explanation)(?:\*\*)?\s*[:：]?\s*(.+)$/i;
const DIFFICULTY_RE = /^难度\s*[:：]?\s*(.+)$/i;
const MARKDOWN_HINT_RE = /(^|\n)\s*(#{1,6}\s+|>\s+|[-*]\s+|```|\*\*|__|\|[-:\s|]+\|)/m;
const SEPARATOR_RE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;

const detectSourceType = (content = '', sourceType = 'auto') => {
    if (sourceType === 'markdown' || sourceType === 'text') return sourceType;
    return MARKDOWN_HINT_RE.test(String(content || '')) ? 'markdown' : 'text';
};

const stripMarkdownDecoration = (line = '') => line
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .trim();

const normalizeQuestionLine = (line) => {
    const stripped = stripMarkdownDecoration(line);
    const patterns = [
        [/^(?:#{1,6}\s*)?第\s*(\d+)\s*题[:：.\-]?\s*/i, '$1. '],
        [/^(?:#{1,6}\s*)?题目\s*(\d+)[:：.\-]?\s*/i, '$1. '],
        [/^(?:#{1,6}\s*)?(\d+)\)\s*/, '$1. '],
        [/^(?:#{1,6}\s*)?(\d+)\.\s*/, '$1. '],
        [/^(?:#{1,6}\s*)?[（(]\s*(\d+)\s*[）)]\s*/, '$1. '],
        [/^(?:[-*]\s+)?(\d+)\.\s*/, '$1. '],
    ];

    for (const [pattern, replacement] of patterns) {
        if (pattern.test(stripped)) return stripped.replace(pattern, replacement);
    }

    return stripped;
};

const normalizeOptionLine = (line) => {
    const stripped = stripMarkdownDecoration(line);
    const match = stripped.match(/^(?:[-*]\s*)?([A-H])[\.\):：]\s*(.+)$/i);
    if (!match) return stripped;
    return `${match[1].toUpperCase()}. ${match[2].trim()}`;
};

const normalizeMetaLine = (line) => {
    const stripped = stripMarkdownDecoration(line);
    return stripped
        .replace(/^(?:答案|正确答案|参考答案|ANSWER)\s*[:：]?\s*/i, '答案: ')
        .replace(/^(?:解析|答案解析|ANALYSIS|EXPLANATION)\s*[:：]?\s*/i, '解析: ');
};

const preprocessMarkdownContent = (content = '') => {
    const normalized = String(content || '').replace(/\r\n?/g, '\n');
    const lines = normalized.split('\n');
    const processed = [];
    let inCodeBlock = false;

    lines.forEach((line) => {
        const trimmed = line.trim();

        if (/^```/.test(trimmed)) {
            inCodeBlock = !inCodeBlock;
            return;
        }

        if (SEPARATOR_RE.test(trimmed)) return;
        if (/^\|.*\|$/.test(trimmed)) return;

        let nextLine = line;
        if (!inCodeBlock) {
            nextLine = nextLine.replace(/^\s*>\s?/, '');
            nextLine = nextLine.replace(/^\s*[-*]\s+(?=(?:第\s*\d+\s*题|题目\s*\d+|\d+[.)]|[（(]\d+[）)]|[A-H][\.\):：]))/i, '');
            nextLine = nextLine.replace(/^\s*#{1,6}\s*/, '');
        }

        nextLine = normalizeMetaLine(normalizeOptionLine(normalizeQuestionLine(nextLine)));
        if (!nextLine.trim()) {
            processed.push('');
            return;
        }

        processed.push(nextLine);
    });

    return processed.join('\n');
};

const splitBlocks = (content) => {
    const lines = normalizeImportText(content).split('\n');
    const blocks = [];
    let current = [];

    const flush = () => {
        const block = current.join('\n').trim();
        if (block) blocks.push(block);
        current = [];
    };

    lines.forEach((line) => {
        if (!line) return;

        if (QUESTION_START_RE.test(line) && current.length > 0) {
            flush();
        }

        current.push(line);
    });

    flush();
    return blocks.filter(Boolean);
};

const parseBlock = (blockText) => {
    const lines = blockText.split('\n').map((line) => line.trim()).filter(Boolean);
    const stemLines = [];
    const options = [];
    let answer = '';
    let analysis = '';
    let difficulty = '';
    let currentOption = null;

    lines.forEach((line, index) => {
        const normalizedLine = index === 0 ? line.replace(QUESTION_START_RE, '') : line;
        const optionMatch = normalizedLine.match(OPTION_RE);
        const answerMatch = normalizedLine.match(ANSWER_RE);
        const analysisMatch = normalizedLine.match(ANALYSIS_RE);
        const difficultyMatch = normalizedLine.match(DIFFICULTY_RE);

        if (answerMatch) {
            answer = normalizeAnswer(answerMatch[1]);
            currentOption = null;
            return;
        }

        if (analysisMatch) {
            analysis = cleanupWhitespace(analysisMatch[1]);
            currentOption = null;
            return;
        }

        if (difficultyMatch) {
            difficulty = difficultyMatch[1].trim();
            currentOption = null;
            return;
        }

        if (optionMatch) {
            currentOption = {
                key: optionMatch[1].toUpperCase(),
                text: optionMatch[2].trim(),
            };
            options.push(currentOption);
            return;
        }

        if (currentOption && !ANSWER_RE.test(normalizedLine) && !ANALYSIS_RE.test(normalizedLine)) {
            currentOption.text = `${currentOption.text} ${normalizedLine}`.trim();
            return;
        }

        stemLines.push(normalizedLine);
        currentOption = null;
    });

    const stem = cleanupWhitespace(stemLines.join('\n'));
    const type = detectQuestionType({ blockText, options, answer });
    const normalizedHash = createNormalizedHash({ stem, options, answer });
    const status = getQuestionStatus({ blockText, stem, options, answer, type });

    return {
        type,
        stem,
        options,
        answer,
        analysis,
        difficulty,
        rawText: blockText,
        normalizedHash,
        status,
    };
};

const getQuestionStatus = ({ blockText, stem, options, answer, type }) => {
    const hasQuestionMarker = QUESTION_START_RE.test(String(blockText || '').split('\n')[0] || '');

    if (!stem) return 'failed';
    if (!hasQuestionMarker && type === 'unknown' && options.length === 0 && !answer) return 'suspected';
    if ((type === 'single_choice' || type === 'multiple_choice') && options.length === 0) return 'suspected';
    if ((type === 'single_choice' || type === 'multiple_choice' || type === 'true_false') && !answer) return 'suspected';
    if (type === 'multiple_choice' && !/^[A-Z](?:,[A-Z])+$/i.test(answer)) return 'suspected';
    if (type === 'single_choice' && answer && !/^[A-Z]$/i.test(answer)) return 'suspected';

    return 'ok';
};

const summarizeItems = (items) => items.reduce((summary, item) => {
    summary.total += 1;
    summary[item.status] = (summary[item.status] || 0) + 1;
    return summary;
}, {
    total: 0,
    ok: 0,
    suspected: 0,
    duplicate: 0,
    failed: 0,
});

const parseBlocksToItems = ({ blocks, existingHashes }) => blocks.map(parseBlock).map((item, index) => {
    let status = item.status;
    if (status !== 'failed' && item.normalizedHash && existingHashes.has(item.normalizedHash)) {
        status = 'duplicate';
    }

    return {
        ...item,
        index: index + 1,
        status,
    };
});

const parseImportContent = ({ content, existingHashes = new Set(), sourceType = 'auto' }) => {
    const effectiveSourceType = detectSourceType(content, sourceType);
    const rawContent = String(content || '');
    const processedContent = effectiveSourceType === 'markdown' ? preprocessMarkdownContent(rawContent) : rawContent;

    let blocks = splitBlocks(processedContent);
    let usedFallback = false;

    if (effectiveSourceType === 'markdown' && blocks.length === 0) {
        blocks = splitBlocks(rawContent);
        usedFallback = true;
    }

    const items = parseBlocksToItems({ blocks, existingHashes });

    return {
        items,
        summary: summarizeItems(items),
        sourceType: effectiveSourceType,
        usedFallback,
    };
};

module.exports = {
    detectSourceType,
    parseImportContent,
    preprocessMarkdownContent,
};
