const test = require('node:test');
const assert = require('node:assert/strict');

const { buildExportPayload } = require('../../services/export-service');

const sample = {
    bank: { id: 1, name: '测试题库', updated_at: '2026-03-24 12:00:00' },
    questions: [
        {
            id: 10,
            type: 'single_choice',
            stem: '题干',
            options: [{ key: 'A', text: '选项A' }, { key: 'B', text: '选项B' }],
            answer: 'A',
            analysis: '因为 A 正确',
            source: 'import',
            difficulty: 'easy',
        },
    ],
};

test('buildExportPayload returns JSON export', () => {
    const payload = buildExportPayload({ ...sample, format: 'json' });
    const parsed = JSON.parse(payload);
    assert.equal(parsed.bank.name, '测试题库');
    assert.equal(parsed.questions[0].answer, 'A');
});

test('buildExportPayload returns markdown export', () => {
    const payload = buildExportPayload({ ...sample, format: 'markdown' });
    assert.match(payload, /# 测试题库/);
    assert.match(payload, /答案：A/);
});

test('buildExportPayload returns csv export', () => {
    const payload = buildExportPayload({ ...sample, format: 'csv' });
    assert.match(payload, /"index","type","stem"/);
    assert.match(payload, /"A"/);
});
