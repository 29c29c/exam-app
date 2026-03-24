const test = require('node:test');
const assert = require('node:assert/strict');

const { detectSourceType, parseImportContent, preprocessMarkdownContent } = require('../../services/import-parser');

test('parseImportContent parses single and multiple choice questions in plain text', () => {
    const content = `
1. 单选题
A. 选项一
B. 选项二
答案：B

2. 多选题
A. 条件A
B. 条件B
C. 条件C
答案：A,C
`;

    const result = parseImportContent({ content, existingHashes: new Set(), sourceType: 'text' });
    assert.equal(result.summary.total, 2);
    assert.equal(result.items[0].type, 'single_choice');
    assert.equal(result.items[0].options.length, 2);
    assert.equal(result.items[0].answer, 'B');
    assert.equal(result.items[1].type, 'multiple_choice');
    assert.equal(result.items[1].answer, 'A,C');
});

test('parseImportContent marks duplicates', () => {
    const content = `
1. 单选题
A. 一
B. 二
答案：A
`;
    const parsed = parseImportContent({ content, existingHashes: new Set(), sourceType: 'text' });
    const duplicateHash = parsed.items[0].normalizedHash;
    const duplicate = parseImportContent({ content, existingHashes: new Set([duplicateHash]), sourceType: 'text' });
    assert.equal(duplicate.items[0].status, 'duplicate');
});

test('detectSourceType prefers markdown when markdown wrappers exist', () => {
    const content = `## 第1题\n**答案**：A`;
    assert.equal(detectSourceType(content, 'auto'), 'markdown');
});

test('preprocessMarkdownContent removes common AI markdown wrappers', () => {
    const content = `
## 第1题
> **答案**：A
---
`;
    const result = preprocessMarkdownContent(content);
    assert.match(result, /1\./);
    assert.match(result, /答案: A/);
    assert.doesNotMatch(result, /---/);
});

test('parseImportContent supports chatgpt-style markdown questions', () => {
    const content = `
## 第1题
马克思主义认为？

- A. 选项A
- B. 选项B

**答案**：B
**解析**：因为 B 更符合题意。
`;
    const result = parseImportContent({ content, existingHashes: new Set(), sourceType: 'auto' });
    assert.equal(result.summary.total, 1);
    assert.equal(result.items[0].type, 'single_choice');
    assert.equal(result.items[0].options.length, 2);
    assert.equal(result.items[0].answer, 'B');
    assert.match(result.items[0].analysis, /符合题意/);
});

test('parseImportContent supports code-fenced markdown blocks and compact multiple answers', () => {
    const content = `
\`\`\`markdown
### 1.
关于反映、信息和选择的关系，下列论断正确的是？
A) 论断A
B) 论断B
C) 论断C
正确答案：AC
\`\`\`
`;
    const result = parseImportContent({ content, existingHashes: new Set(), sourceType: 'auto' });
    assert.equal(result.summary.total, 1);
    assert.equal(result.items[0].type, 'multiple_choice');
    assert.equal(result.items[0].answer, 'A,C');
});

test('parseImportContent normalizes true false answers from AI markdown', () => {
    const content = `
题目 1
实践是认识的来源。
Answer: True
`;
    const result = parseImportContent({ content, existingHashes: new Set(), sourceType: 'auto' });
    assert.equal(result.items[0].type, 'true_false');
    assert.equal(result.items[0].answer, '对');
});

test('parseImportContent avoids turning plain notes into many questions', () => {
    const content = `
# 复习说明
- 第一章重点掌握概念
- 第二章重点掌握方法论
总结：这是一份学习提纲
`;
    const result = parseImportContent({ content, existingHashes: new Set(), sourceType: 'auto' });
    assert.equal(result.summary.total, 1);
    assert.equal(result.items[0].status, 'suspected');
});
