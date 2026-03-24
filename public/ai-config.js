window.aiConfigStore = {
    read: () => ({
        provider: 'gemini',
        key: '',
        hasKey: false,
    }),
    save: (config) => config,
    message: 'AI Key 会按当前账号加密保存在服务器，前端不会长期保存明文。',
};
