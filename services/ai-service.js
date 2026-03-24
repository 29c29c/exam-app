const axios = require('axios');

const buildAnalyzePrompt = ({ question, answer }) => `请解析这道题。
题目：${question}
参考答案：${answer}

要求：
1. 解释为什么选这个答案。
2. 如果有选项，简要分析其他选项。
3. 直接输出解析内容，不要重复题目。`;

const analyzeWithDeepseek = async ({ apiKey, prompt }) => {
    const response = await axios.post(
        'https://api.deepseek.com/chat/completions',
        {
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: prompt }],
        },
        { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    return response.data.choices[0].message.content;
};

const analyzeWithGemini = async ({ apiKey, prompt }) => {
    const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        { contents: [{ parts: [{ text: prompt }] }] },
    );
    return response.data.candidates[0].content.parts[0].text;
};

const analyzeQuestion = async ({ provider, apiKey, question, answer }) => {
    if (!provider || !apiKey) {
        throw new Error('请先配置 AI Provider 和 API Key');
    }

    const prompt = buildAnalyzePrompt({ question, answer });

    if (provider === 'deepseek') {
        return analyzeWithDeepseek({ apiKey, prompt });
    }

    if (provider === 'gemini') {
        return analyzeWithGemini({ apiKey, prompt });
    }

    throw new Error('暂不支持该 AI Provider');
};

module.exports = {
    analyzeQuestion,
    buildAnalyzePrompt,
};
