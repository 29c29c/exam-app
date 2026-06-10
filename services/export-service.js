const csvEscape = (value = '') => `"${String(value).replace(/"/g, '""')}"`;

const formatQuestionForExport = (question, index) => ({
    index: index + 1,
    type: question.type || 'unknown',
    stem: question.stem || question.content || '',
    options: question.options || [],
    answer: question.answer || '',
    analysis: question.analysis || '',
    source: question.source || '',
    difficulty: question.difficulty || '',
});

const getExportBankName = ({ bank, scope }) => (
    scope === 'bookmarks' ? `${bank.name} · 收藏夹` : bank.name
);

const exportBankAsJson = ({ bank, questions, scope }) => JSON.stringify({
    bank: {
        id: bank.id,
        name: bank.name,
        updated_at: bank.updated_at || null,
    },
    scope: scope === 'bookmarks' ? 'bookmarks' : 'all',
    questions: questions.map(formatQuestionForExport),
}, null, 2);

const exportBankAsMarkdown = ({ bank, questions, scope }) => {
    const lines = [`# ${getExportBankName({ bank, scope })}`, ''];
    questions.forEach((question, index) => {
        const item = formatQuestionForExport(question, index);
        lines.push(`## ${item.index}. ${item.stem}`);
        lines.push('');
        if (item.options.length > 0) {
            item.options.forEach((option) => {
                lines.push(`- ${option.key}. ${option.text}`);
            });
            lines.push('');
        }
        lines.push(`答案：${item.answer || '未提供'}`);
        if (item.analysis) {
            lines.push('');
            lines.push(`解析：${item.analysis}`);
        }
        lines.push('');
    });
    return lines.join('\n');
};

const exportBankAsCsv = ({ questions }) => {
    const rows = [
        ['index', 'type', 'stem', 'options', 'answer', 'analysis', 'source', 'difficulty'],
    ];
    questions.forEach((question, index) => {
        const item = formatQuestionForExport(question, index);
        rows.push([
            item.index,
            item.type,
            item.stem,
            item.options.map((option) => `${option.key}. ${option.text}`).join('\n'),
            item.answer,
            item.analysis,
            item.source,
            item.difficulty,
        ]);
    });
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
};

const buildExportPayload = ({ bank, questions, format, scope }) => {
    if (format === 'markdown') return exportBankAsMarkdown({ bank, questions, scope });
    if (format === 'csv') return exportBankAsCsv({ bank, questions });
    return exportBankAsJson({ bank, questions, scope });
};

const getExportMimeType = (format) => {
    if (format === 'markdown') return 'text/markdown; charset=utf-8';
    if (format === 'csv') return 'text/csv; charset=utf-8';
    return 'application/json; charset=utf-8';
};

module.exports = {
    buildExportPayload,
    getExportMimeType,
};
