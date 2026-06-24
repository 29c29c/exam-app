const toQueryString = (params = {}) => {
    const search = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') return;
        search.append(key, value);
    });
    const result = search.toString();
    return result ? `?${result}` : '';
};

const apiRequest = async (endpoint, method = 'GET', body = null) => {
    const headers = { 'Content-Type': 'application/json' };

    const response = await fetch(`/api${endpoint}`, {
        method,
        headers,
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : null,
    });

    let data = null;
    try {
        data = await response.json();
    } catch (error) {}

    if (!response.ok) {
        const errorMessage = data && data.error && data.error.message
            ? data.error.message
            : (data && data.error) || '请求失败';
        const error = new Error(errorMessage);
        error.status = response.status;
        throw error;
    }
    return data;
};

const downloadWithAuth = async (endpoint, filenameHint) => {
    const response = await fetch(`/api${endpoint}`, {
        credentials: 'same-origin',
    });
    if (!response.ok) {
        let message = '下载失败';
        try {
            const data = await response.json();
            message = data && data.error && data.error.message
                ? data.error.message
                : (data && data.error) || message;
        } catch (error) {}
        throw new Error(message);
    }
    const blob = await response.blob();
    const disposition = response.headers.get('Content-Disposition') || '';
    const matched = disposition.match(/filename="?([^"]+)"?/);
    const filename = decodeURIComponent((matched && matched[1]) || filenameHint || 'download');
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
};

window.api = {
    request: apiRequest,
    auth: {
        login: (payload) => apiRequest('/login', 'POST', payload),
        register: (payload) => apiRequest('/register', 'POST', payload),
        me: () => apiRequest('/me'),
        logout: () => apiRequest('/logout', 'POST'),
    },
    folders: {
        list: (parentId) => apiRequest(`/folders${parentId ? `?parentId=${parentId}` : ''}`),
        tree: () => apiRequest('/folders/tree'),
        create: (payload) => apiRequest('/folders', 'POST', payload),
        rename: (id, name) => apiRequest(`/folders/${id}`, 'PATCH', { name }),
        move: (id, parentId) => apiRequest(`/folders/${id}/move`, 'PATCH', { parentId }),
        stats: (id) => apiRequest(`/folders/${id}/stats`),
        remove: (id) => apiRequest(`/folders/${id}`, 'DELETE'),
    },
    banks: {
        list: (folderId) => apiRequest(`/banks${toQueryString({ folderId })}`),
        create: (payload) => apiRequest('/banks', 'POST', payload),
        rename: (id, name) => apiRequest(`/banks/${id}`, 'PATCH', { name }),
        move: (id, folderId) => apiRequest(`/banks/${id}/move`, 'PATCH', { folderId }),
        stats: (id) => apiRequest(`/banks/${id}/stats`),
        viewCountRange: (id, params = {}) => apiRequest(`/banks/${id}/view-count-range${toQueryString(params)}`),
        remove: (id) => apiRequest(`/banks/${id}`, 'DELETE'),
        exportUrl: (id, format = 'json', scope = '', collectionId = '') => `/api/banks/${id}/export${toQueryString({ format, scope, collectionId })}`,
        downloadExport: (id, format = 'json', filenameHint = '', scope = '', collectionId = '') => downloadWithAuth(`/banks/${id}/export${toQueryString({ format, scope, collectionId })}`, filenameHint),
        questions: (id, params = {}) => apiRequest(`/banks/${id}/questions${toQueryString(params)}`),
        bookmarks: (id, params = {}) => apiRequest(`/banks/${id}/bookmarks${toQueryString(params)}`),
        getPosition: (id, params = {}) => apiRequest(`/banks/${id}/position${toQueryString(params)}`),
        savePosition: (id, payload) => apiRequest(`/banks/${id}/position`, 'POST', payload),
        bookmarkCollections: (id) => apiRequest(`/banks/${id}/bookmark-collections`),
        createBookmarkCollection: (id, payload) => apiRequest(`/banks/${id}/bookmark-collections`, 'POST', payload),
        setActiveBookmarkCollection: (id, collectionId) => apiRequest(`/banks/${id}/bookmark-collections/active`, 'POST', { collectionId }),
    },
    bookmarkCollections: {
        rename: (id, name) => apiRequest(`/bookmark-collections/${id}`, 'PATCH', { name }),
        remove: (id) => apiRequest(`/bookmark-collections/${id}`, 'DELETE'),
    },
    questions: {
        remove: (id) => apiRequest(`/questions/${id}`, 'DELETE'),
        toggleBookmark: (questionId, collectionId = '') => apiRequest('/bookmarks/toggle', 'POST', { questionId, collectionId }),
        updateProgress: (id, payload) => apiRequest(`/questions/${id}/progress`, 'POST', payload),
    },
    imports: {
        parse: (payload) => apiRequest('/import/parse', 'POST', payload),
        commit: (payload) => apiRequest('/import/commit', 'POST', payload),
    },
    ai: {
        getConfig: () => apiRequest('/ai-config'),
        saveConfig: (payload) => apiRequest('/ai-config', 'POST', payload),
        analyze: (payload) => apiRequest('/ai-analyze', 'POST', payload),
    },
    recycleBin: {
        list: () => apiRequest('/recycle-bin'),
        restore: (type, id) => apiRequest(`/recycle-bin/${type}/${id}/restore`, 'POST'),
        remove: (type, id) => apiRequest(`/recycle-bin/${type}/${id}`, 'DELETE'),
    },
    admin: {
        users: () => apiRequest('/admin/users'),
        banks: (userId) => apiRequest(`/admin/banks${toQueryString({ userId })}`),
        removeBank: (id) => apiRequest(`/admin/banks/${id}`, 'DELETE'),
        inviteCodes: () => apiRequest('/admin/invite-codes'),
        createInviteCode: (payload) => apiRequest('/admin/invite-codes', 'POST', payload),
        updateInviteCode: (code, payload) => apiRequest(`/admin/invite-codes/${encodeURIComponent(code)}`, 'PATCH', payload),
        removeInviteCode: (code) => apiRequest(`/admin/invite-codes/${encodeURIComponent(code)}`, 'DELETE'),
    },
};
