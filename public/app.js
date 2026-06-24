const { useEffect, useMemo, useRef, useState } = React;
const api = window.api;
const aiConfigStore = window.aiConfigStore;

const formatDateTime = (value) => {
    if (!value) return '刚刚';
    const date = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const sqlDateTimeToInputValue = (value) => {
    if (!value) return '';
    const date = new Date(`${value.replace(' ', 'T')}Z`);
    if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace(' ', 'T');
    const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return localDate.toISOString().slice(0, 16);
};

const buildFolderPath = (folderId, flatFolders) => {
    if (!folderId) return [];
    const byId = new Map(flatFolders.map((folder) => [folder.id, folder]));
    const path = [];
    let currentId = folderId;

    while (currentId) {
        const current = byId.get(currentId);
        if (!current) break;
        path.unshift(current);
        currentId = current.parent_id;
    }

    return path;
};

const shuffleArray = (items) => {
    const nextItems = [...items];
    for (let index = nextItems.length - 1; index > 0; index -= 1) {
        const randomIndex = Math.floor(Math.random() * (index + 1));
        [nextItems[index], nextItems[randomIndex]] = [nextItems[randomIndex], nextItems[index]];
    }
    return nextItems;
};

const OPTION_SHUFFLE_STORAGE_KEY = 'examApp.shuffleOptions';
const optionKeyFromIndex = (index) => String.fromCharCode(65 + index);

const parseChoiceAnswerKeys = (answer = '') => {
    const normalized = String(answer || '')
        .trim()
        .toUpperCase()
        .replace(/[，、/\s]+/g, ',')
        .replace(/\.+/g, ',')
        .replace(/,+/g, ',')
        .replace(/^,|,$/g, '');

    if (!normalized) return [];
    if (/^[A-Z]{2,}$/.test(normalized)) return normalized.split('');
    if (/^[A-Z](?:,[A-Z])*$/.test(normalized)) return normalized.split(',');
    return [];
};

const buildShuffledQuestionDisplay = (question, shouldShuffleOptions) => {
    const baseQuestion = { ...question };
    delete baseQuestion.display_options;
    delete baseQuestion.display_answer;
    delete baseQuestion.options_shuffled;

    if (!shouldShuffleOptions) {
        return {
            ...baseQuestion,
            display_options: baseQuestion.options || [],
            display_answer: baseQuestion.answer || '',
            options_shuffled: false,
        };
    }

    const options = Array.isArray(baseQuestion.options) ? baseQuestion.options : [];
    const answerKeys = parseChoiceAnswerKeys(baseQuestion.answer);
    if (options.length < 2 || answerKeys.length === 0 || options.length > 26) {
        return {
            ...baseQuestion,
            display_options: options,
            display_answer: baseQuestion.answer || '',
            options_shuffled: false,
        };
    }

    const optionKeys = new Set(options.map((option) => String(option.key || '').toUpperCase()));
    const hasValidAnswer = answerKeys.every((key) => optionKeys.has(key));
    if (!hasValidAnswer) {
        return {
            ...baseQuestion,
            display_options: options,
            display_answer: baseQuestion.answer || '',
            options_shuffled: false,
        };
    }

    const shuffledOptions = shuffleArray(options);
    const keyMap = new Map();
    const displayOptions = shuffledOptions.map((option, index) => {
        const nextKey = optionKeyFromIndex(index);
        keyMap.set(String(option.key || '').toUpperCase(), nextKey);
        return {
            ...option,
            key: nextKey,
        };
    });
    const displayAnswer = answerKeys
        .map((key) => keyMap.get(key))
        .sort()
        .join(',');

    return {
        ...baseQuestion,
        display_options: displayOptions,
        display_answer: displayAnswer,
        options_shuffled: true,
    };
};

const buildQuestionDisplays = (questions, shouldShuffleOptions) => (
    questions.map((question) => buildShuffledQuestionDisplay(question, shouldShuffleOptions))
);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasItems = (items) => Array.isArray(items) && items.length > 0;
const valueOrEmpty = (value) => (value === undefined || value === null ? '' : value);
const writeClipboard = (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
    }
};

const SHORTCUT_STORAGE_KEY = 'examApp.quizShortcuts';
const SHORTCUT_STORAGE_VERSION = 2;
const DEFAULT_SHORTCUTS = {
    previous: 'a',
    next: 'd',
    answer: 's',
    bookmark: ' ',
};

const normalizeShortcutKey = (value) => {
    const rawValue = String(value || '');
    if (rawValue === ' ' || rawValue === 'Space' || rawValue === 'Spacebar') return ' ';

    const chars = Array.from(rawValue.trim());
    return chars.length === 1 ? chars[0].toLowerCase() : '';
};

const formatShortcutKey = (value) => {
    const key = normalizeShortcutKey(value);
    if (key === ' ') return '空格';
    return key ? key.toUpperCase() : '';
};

const shortcutsStore = {
    read: () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(SHORTCUT_STORAGE_KEY) || '{}');
            const bookmark = parsed._version ? parsed.bookmark : (parsed.bookmark === 'v' ? DEFAULT_SHORTCUTS.bookmark : parsed.bookmark);
            return {
                previous: normalizeShortcutKey(parsed.previous) || DEFAULT_SHORTCUTS.previous,
                next: normalizeShortcutKey(parsed.next) || DEFAULT_SHORTCUTS.next,
                answer: normalizeShortcutKey(parsed.answer) || DEFAULT_SHORTCUTS.answer,
                bookmark: normalizeShortcutKey(bookmark) || DEFAULT_SHORTCUTS.bookmark,
            };
        } catch (error) {
            return { ...DEFAULT_SHORTCUTS };
        }
    },
    save: (shortcuts) => {
        const nextShortcuts = {
            previous: normalizeShortcutKey(shortcuts.previous) || DEFAULT_SHORTCUTS.previous,
            next: normalizeShortcutKey(shortcuts.next) || DEFAULT_SHORTCUTS.next,
            answer: normalizeShortcutKey(shortcuts.answer) || DEFAULT_SHORTCUTS.answer,
            bookmark: normalizeShortcutKey(shortcuts.bookmark) || DEFAULT_SHORTCUTS.bookmark,
            _version: SHORTCUT_STORAGE_VERSION,
        };
        localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(nextShortcuts));
        return nextShortcuts;
    },
};

const shouldIgnoreKeyboardShortcut = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return true;
    if (document.querySelector('[data-settings-modal="true"]')) return true;

    const target = event.target;
    if (!target) return false;
    const tagName = target.tagName ? target.tagName.toLowerCase() : '';
    return target.isContentEditable || ['input', 'textarea', 'select'].includes(tagName);
};

const Auth = ({ onLogin }) => {
    const [isLogin, setIsLogin] = useState(true);
    const [form, setForm] = useState({ username: '', password: '', inviteCode: '' });
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLoading(true);
        try {
            if (isLogin) {
                const result = await api.auth.login(form);
                onLogin({ name: result.username, isAdmin: Boolean(result.isAdmin) });
            } else {
                await api.auth.register(form);
                alert('注册成功，请登录');
                setIsLogin(true);
            }
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    return (
        <div className="h-full w-full flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
            <div className="bg-white/90 backdrop-blur rounded-3xl shadow-float p-8 w-full max-w-sm">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-primary rounded-2xl mx-auto flex items-center justify-center text-white text-2xl mb-4 shadow-lg shadow-blue-500/30">
                        <i className="fas fa-graduation-cap"></i>
                    </div>
                    <h2 className="text-2xl font-bold">{isLogin ? '欢迎回来' : '创建账号'}</h2>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <input className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-primary/50" placeholder="用户名" value={form.username} onChange={(e)=>setForm({...form, username: e.target.value})} required />
                    <input className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-primary/50" type="password" placeholder="密码" value={form.password} onChange={(e)=>setForm({...form, password: e.target.value})} required />
                    {!isLogin && <input className="w-full p-3 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-primary/50" placeholder="邀请码" value={form.inviteCode} onChange={(e)=>setForm({...form, inviteCode: e.target.value})} required />}
                    <button disabled={loading} className="w-full bg-primary text-white py-3.5 rounded-xl font-bold shadow-lg shadow-blue-500/30 active:scale-95 transition disabled:opacity-70">
                        {loading ? '处理中...' : (isLogin ? '登录' : '注册')}
                    </button>
                </form>
                <button onClick={() => setIsLogin(!isLogin)} className="w-full mt-4 text-sm text-gray-500">{isLogin ? '没有账号？去注册' : '返回登录'}</button>
            </div>
        </div>
    );
};

const FolderTreeSheet = ({ show, folders, currentFolderId, onClose, onSelect }) => {
    const renderNodes = (nodes, depth = 0) => nodes.map((node) => (
        <div key={node.id}>
            <button
                onClick={() => { onSelect(node.id); onClose(); }}
                className={`w-full text-left rounded-2xl px-4 py-3 mb-2 ${currentFolderId === node.id ? 'bg-primary text-white' : 'bg-gray-50 text-gray-700'}`}
                style={{ paddingLeft: `${16 + depth * 18}px` }}
            >
                <i className="fas fa-folder mr-2"></i>{node.name}
            </button>
            {hasItems(node.children) && renderNodes(node.children, depth + 1)}
        </div>
    ));

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-safe max-h-[75vh] overflow-y-auto animate-slide-up" onClick={(e)=>e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg">目录树</h3>
                    <button onClick={onClose}><i className="fas fa-times"></i></button>
                </div>
                <button onClick={() => { onSelect(null); onClose(); }} className={`w-full text-left rounded-2xl px-4 py-3 mb-3 ${currentFolderId ? 'bg-gray-50 text-gray-700' : 'bg-primary text-white'}`}>
                    <i className="fas fa-house mr-2"></i>根目录
                </button>
                {folders.length > 0 ? renderNodes(folders) : <div className="text-sm text-gray-400 py-8 text-center">还没有目录，先创建一个吧</div>}
            </div>
        </div>
    );
};

const NameModal = ({ show, title, value, onChange, onClose, onSubmit, loading }) => {
    if (!show) return null;
    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={(e)=>e.stopPropagation()}>
                <h3 className="font-bold text-lg mb-4">{title}</h3>
                <input autoFocus className="w-full p-3 bg-gray-50 rounded-xl outline-none mb-4" value={value} onChange={(e)=>onChange(e.target.value)} />
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} className="py-3 rounded-xl bg-gray-100 text-gray-600 font-bold">取消</button>
                    <button onClick={onSubmit} disabled={loading} className="py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-60">{loading ? '处理中...' : '保存'}</button>
                </div>
            </div>
        </div>
    );
};

const MoveModal = ({ show, title, folders, selectedFolderId, currentFolderId, onClose, onSubmit, loading }) => {
    const renderOptions = (nodes, depth = 0) => nodes.flatMap((node) => [
        <option key={node.id} value={node.id}>{`${'　'.repeat(depth)}${node.name}`}</option>,
        ...renderOptions(node.children || [], depth + 1),
    ]);

    const [targetFolderId, setTargetFolderId] = useState(valueOrEmpty(selectedFolderId));

    useEffect(() => {
        setTargetFolderId(valueOrEmpty(selectedFolderId));
    }, [selectedFolderId, show]);

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm" onClick={(e)=>e.stopPropagation()}>
                <h3 className="font-bold text-lg mb-4">{title}</h3>
                <select value={targetFolderId} onChange={(e)=>setTargetFolderId(e.target.value)} className="w-full p-3 bg-gray-50 rounded-xl outline-none mb-4">
                    <option value="">根目录</option>
                    {renderOptions(folders)}
                </select>
                {currentFolderId !== undefined && <div className="text-xs text-gray-400 mb-4">当前目录：{currentFolderId || '根目录'}</div>}
                <div className="grid grid-cols-2 gap-3">
                    <button onClick={onClose} className="py-3 rounded-xl bg-gray-100 text-gray-600 font-bold">取消</button>
                    <button onClick={() => onSubmit(targetFolderId ? Number(targetFolderId) : null)} disabled={loading} className="py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-60">{loading ? '处理中...' : '确认移动'}</button>
                </div>
            </div>
        </div>
    );
};

const ImportModal = ({ show, parentId, onClose, onImported }) => {
    const [importText, setImportText] = useState('');
    const [importBankName, setImportBankName] = useState('');
    const [importPreview, setImportPreview] = useState(null);
    const [skipDuplicates, setSkipDuplicates] = useState(true);
    const [isParsingImport, setIsParsingImport] = useState(false);
    const [isCommittingImport, setIsCommittingImport] = useState(false);

    const reset = () => {
        setImportText('');
        setImportBankName('');
        setImportPreview(null);
        setSkipDuplicates(true);
        setIsParsingImport(false);
        setIsCommittingImport(false);
        onClose();
    };

    const handleParse = async () => {
        if (!importBankName || !importText) return alert('请填写完整');
        setIsParsingImport(true);
        try {
            const preview = await api.imports.parse({
                bankName: importBankName,
                folderId: parentId,
                sourceType: 'auto',
                content: importText,
            });
            setImportPreview(preview);
        } catch (error) {
            alert(error.message);
        }
        setIsParsingImport(false);
    };

    const handleCommit = async () => {
        if (!importPreview || !importPreview.previewId) return;
        setIsCommittingImport(true);
        try {
            const result = await api.imports.commit({ previewId: importPreview.previewId, skipDuplicates });
            alert(`成功导入 ${result.importedCount} 道题`);
            reset();
            onImported();
        } catch (error) {
            alert(error.message);
        }
        setIsCommittingImport(false);
    };

    if (!show) return null;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={reset}></div>
            <div className="bg-white w-full max-w-2xl rounded-3xl p-6 z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between gap-4 mb-4">
                    <h3 className="font-bold text-lg text-success"><i className="fas fa-file-import mr-2"></i>{importPreview ? '确认导入题库' : '智能导入'}</h3>
                    <button onClick={reset} className="w-8 h-8 rounded-full bg-gray-100 text-gray-400"><i className="fas fa-times"></i></button>
                </div>

                {!importPreview ? (
                    <div className="space-y-4">
                        <input className="w-full p-3 bg-gray-50 rounded-xl outline-none" placeholder="题库名称" value={importBankName} onChange={(e)=>setImportBankName(e.target.value)} />
                        <div className="text-xs text-gray-400">支持粘贴 AI 生成的 Markdown / 文本题库，系统会自动识别。</div>
                        <textarea className="w-full h-72 p-3 bg-gray-50 rounded-xl outline-none font-mono text-sm" placeholder={'格式示例：\n## 第1题\nA. 选项A\nB. 选项B\n**答案**：B\n\n### 2.\nA) 选项一\nB) 选项二\n正确答案：A'} value={importText} onChange={(e)=>setImportText(e.target.value)}></textarea>
                        <button onClick={handleParse} disabled={isParsingImport} className="w-full bg-success text-white py-3 rounded-xl font-bold disabled:opacity-60">{isParsingImport ? '正在预解析...' : '预解析并预览'}</button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="bg-gray-50 rounded-2xl p-4"><div className="text-xs text-gray-400">总题数</div><div className="text-2xl font-bold mt-1">{importPreview.summary.total}</div></div>
                            <div className="bg-green-50 rounded-2xl p-4"><div className="text-xs text-green-600">正常</div><div className="text-2xl font-bold mt-1 text-green-700">{importPreview.summary.ok}</div></div>
                            <div className="bg-yellow-50 rounded-2xl p-4"><div className="text-xs text-yellow-600">待复核</div><div className="text-2xl font-bold mt-1 text-yellow-700">{importPreview.summary.suspected}</div></div>
                            <div className="bg-red-50 rounded-2xl p-4"><div className="text-xs text-red-600">重复/失败</div><div className="text-2xl font-bold mt-1 text-red-700">{(importPreview.summary.duplicate || 0) + (importPreview.summary.failed || 0)}</div></div>
                        </div>

                        <label className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
                            <input type="checkbox" checked={skipDuplicates} onChange={(e)=>setSkipDuplicates(e.target.checked)} />
                            <span className="text-sm text-gray-600">确认导入时自动跳过重复题</span>
                        </label>

                        <div className="max-h-[42vh] overflow-y-auto space-y-3 pr-1">
                            {importPreview.items.map((item) => {
                                const statusStyles = {
                                    ok: 'bg-green-50 border-green-200 text-green-700',
                                    suspected: 'bg-yellow-50 border-yellow-200 text-yellow-700',
                                    duplicate: 'bg-red-50 border-red-200 text-red-700',
                                    failed: 'bg-gray-100 border-gray-200 text-gray-500',
                                };
                                const statusLabel = {
                                    ok: '正常',
                                    suspected: '待复核',
                                    duplicate: '重复',
                                    failed: '失败',
                                };
                                return (
                                    <div key={item.index} className={`border rounded-2xl p-4 ${statusStyles[item.status] || 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                                        <div className="flex items-center justify-between gap-3 mb-2">
                                            <div className="font-bold text-sm">第 {item.index} 题</div>
                                            <div className="flex gap-2 text-xs">
                                                <span className="px-2 py-1 rounded-full bg-white/80">{item.type || 'unknown'}</span>
                                                <span className="px-2 py-1 rounded-full bg-white/80">{statusLabel[item.status]}</span>
                                            </div>
                                        </div>
                                        <div className="text-sm leading-6 whitespace-pre-wrap">{item.stem || '未识别到题干'}</div>
                                        {hasItems(item.options) && <div className="mt-3 space-y-1 text-xs">{item.options.map((option) => <div key={`${item.index}-${option.key}`}>{option.key}. {option.text}</div>)}</div>}
                                        <div className="mt-3 text-xs"><span className="font-bold">答案：</span>{item.answer || '未识别'}</div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <button onClick={() => setImportPreview(null)} className="py-3 rounded-xl bg-gray-100 text-gray-600 font-bold">返回编辑</button>
                            <button onClick={handleCommit} disabled={isCommittingImport} className="py-3 rounded-xl bg-success text-white font-bold disabled:opacity-60">{isCommittingImport ? '正在导入...' : '确认导入'}</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const RecycleBinModal = ({ show, onClose, onChanged }) => {
    const [items, setItems] = useState({ folders: [], banks: [], questions: [] });
    const [loading, setLoading] = useState(false);

    const loadItems = async () => {
        setLoading(true);
        try {
            const result = await api.recycleBin.list();
            setItems(result);
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (show) loadItems();
    }, [show]);

    const handleRestore = async (type, id) => {
        try {
            await api.recycleBin.restore(type, id);
            await loadItems();
            await onChanged();
        } catch (error) {
            alert(error.message);
        }
    };

    const handleDelete = async (type, id) => {
        if (!confirm('确定永久删除吗？此操作不可恢复。')) return;
        try {
            await api.recycleBin.remove(type, id);
            await loadItems();
            await onChanged();
        } catch (error) {
            alert(error.message);
        }
    };

    if (!show) return null;

    const groups = [
        { key: 'folders', title: '文件夹', icon: 'folder' },
        { key: 'banks', title: '题库', icon: 'book' },
        { key: 'questions', title: '题目', icon: 'file-lines' },
    ];

    return (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-white rounded-3xl p-6 w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={(e)=>e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg">回收站</h3>
                    <button onClick={onClose}><i className="fas fa-times"></i></button>
                </div>
                {loading ? <div className="py-10 text-center text-gray-400">加载中...</div> : (
                    <div className="space-y-6">
                        {groups.map((group) => (
                            <div key={group.key}>
                                <div className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-3">{group.title}</div>
                                {hasItems(items[group.key]) ? items[group.key].map((item) => (
                                    <div key={`${group.key}-${item.id}`} className="bg-gray-50 rounded-2xl p-4 mb-3 flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-white text-gray-500 flex items-center justify-center">
                                            <i className={`fas fa-${group.icon}`}></i>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-bold truncate">{item.name}</div>
                                            <div className="text-xs text-gray-400 mt-1">删除于 {formatDateTime(item.deleted_at)}</div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleRestore(item.type, item.id)} className="px-3 py-2 rounded-xl bg-primary text-white text-sm font-bold">恢复</button>
                                            <button onClick={() => handleDelete(item.type, item.id)} className="px-3 py-2 rounded-xl bg-red-50 text-red-500 text-sm font-bold">永久删除</button>
                                        </div>
                                    </div>
                                )) : <div className="text-sm text-gray-400 py-3">暂无{group.title}。</div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

const Dashboard = ({
    currentFolderId,
    currentFolderPath,
    treeData,
    onNavigateFolder,
    onOpenBank,
    onManageBookmarks,
    onStructureChange,
    onOpenSettings,
}) => {
    const [folders, setFolders] = useState([]);
    const [banks, setBanks] = useState([]);
    const [showCreate, setShowCreate] = useState(false);
    const [createType, setCreateType] = useState('folder');
    const [newName, setNewName] = useState('');
    const [showImport, setShowImport] = useState(false);
    const [renameState, setRenameState] = useState({ show: false, type: 'folder', item: null, value: '' });
    const [moveState, setMoveState] = useState({ show: false, type: 'folder', item: null });
    const [loadingAction, setLoadingAction] = useState(false);
    const [batchStatus, setBatchStatus] = useState({ show: false, total: 0, current: 0, success: 0, failed: 0, bankName: '' });
    const [aiConfig, setAiConfig] = useState(() => aiConfigStore.read());
    const [bookmarkCollectionsByBank, setBookmarkCollectionsByBank] = useState({});
    const [selectedCollectionByBank, setSelectedCollectionByBank] = useState({});
    const stopBatchRef = useRef(false);

    const loadData = async () => {
        const [nextFolders, nextBanks] = await Promise.all([
            api.folders.list(currentFolderId),
            api.banks.list(currentFolderId),
        ]);
        setFolders(nextFolders);
        setBanks(nextBanks);
        const collectionEntries = await Promise.all(nextBanks.map(async (bank) => {
            const result = await api.banks.bookmarkCollections(bank.id);
            return [bank.id, result];
        }));
        const nextCollections = {};
        const nextSelections = {};
        collectionEntries.forEach(([bankId, result]) => {
            nextCollections[bankId] = result.collections || [];
            nextSelections[bankId] = result.activeCollectionId || '';
        });
        setBookmarkCollectionsByBank(nextCollections);
        setSelectedCollectionByBank(nextSelections);
    };

    const loadAiConfig = async () => {
        try {
            const config = await api.ai.getConfig();
            setAiConfig({
                provider: config.provider || 'gemini',
                key: '',
                hasKey: Boolean(config.hasKey),
            });
        } catch (error) {}
    };

    useEffect(() => {
        loadData().catch((error) => alert(error.message));
    }, [currentFolderId]);

    useEffect(() => {
        loadAiConfig();
    }, []);

    useEffect(() => {
        const handleAiConfigUpdate = (event) => {
            const detail = event.detail || {};
            setAiConfig((prev) => ({
                ...prev,
                provider: detail.provider || prev.provider,
                key: '',
                hasKey: Boolean(detail.hasKey),
            }));
        };
        window.addEventListener('ai-config-updated', handleAiConfigUpdate);
        return () => window.removeEventListener('ai-config-updated', handleAiConfigUpdate);
    }, []);

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setLoadingAction(true);
        try {
            if (createType === 'folder') {
                await api.folders.create({ name: newName.trim(), parentId: currentFolderId });
            } else {
                await api.banks.create({ name: newName.trim(), folderId: currentFolderId });
            }
            await onStructureChange();
            setNewName('');
            setShowCreate(false);
            await loadData();
        } catch (error) {
            alert(error.message);
        }
        setLoadingAction(false);
    };

    const handleDelete = async (event, item, type) => {
        event.stopPropagation();
        try {
            let message = '';
            if (type === 'folder') {
                const stats = await api.folders.stats(item.id);
                message = `确定删除文件夹“${item.name}”吗？\n将影响 ${stats.folder_count} 个文件夹、${stats.bank_count} 个题库、${stats.question_count} 道题。`;
            } else {
                const stats = await api.banks.stats(item.id);
                message = `确定删除题库“${item.name}”吗？\n将删除 ${stats.question_count} 道题、${stats.bookmark_count} 条收藏记录。`;
            }

            if (!confirm(message)) return;

            if (type === 'folder') await api.folders.remove(item.id);
            else await api.banks.remove(item.id);

            await onStructureChange();
            await loadData();
        } catch (error) {
            alert(error.message);
        }
    };

    const handleRename = async () => {
        if (!renameState.value.trim() || !renameState.item) return;
        setLoadingAction(true);
        try {
            if (renameState.type === 'folder') await api.folders.rename(renameState.item.id, renameState.value.trim());
            else await api.banks.rename(renameState.item.id, renameState.value.trim());
            await onStructureChange();
            setRenameState({ show: false, type: 'folder', item: null, value: '' });
            await loadData();
        } catch (error) {
            alert(error.message);
        }
        setLoadingAction(false);
    };

    const handleMove = async (nextFolderId) => {
        if (!moveState.item) return;
        setLoadingAction(true);
        try {
            if (moveState.type === 'folder') await api.folders.move(moveState.item.id, nextFolderId);
            else await api.banks.move(moveState.item.id, nextFolderId);
            await onStructureChange();
            setMoveState({ show: false, type: 'folder', item: null });
            await loadData();
        } catch (error) {
            alert(error.message);
        }
        setLoadingAction(false);
    };

    const handleBatchAnalyze = async (bank) => {
        try {
            if (!aiConfig.hasKey) {
                alert('请先在个人设置中为当前账号配置 API Key。');
                onOpenSettings('api');
                return;
            }

            const targets = await api.banks.bookmarks(bank.id, { hasAnalysis: 'false' });
            if (!targets.length) {
                alert('该题库收藏夹中没有待解析的题目。');
                return;
            }

            if (!confirm(`即将为收藏夹中的 ${targets.length} 道题生成 AI 解析，继续吗？`)) return;

            stopBatchRef.current = false;
            let success = 0;
            let failed = 0;
            setBatchStatus({ show: true, total: targets.length, current: 0, success: 0, failed: 0, bankName: bank.name });

            for (let index = 0; index < targets.length; index += 1) {
                if (stopBatchRef.current) break;

                const target = targets[index];
                let done = false;
                for (let attempt = 0; attempt < 2 && !done; attempt += 1) {
                    try {
                        await api.ai.analyze({
                            questionId: target.id,
                            question: target.content,
                            answer: target.answer,
                        });
                        success += 1;
                        done = true;
                    } catch (error) {
                        if (attempt === 1) {
                            failed += 1;
                        } else {
                            await wait(800);
                        }
                    }
                }

                setBatchStatus((prev) => ({
                    ...prev,
                    current: index + 1,
                    success,
                    failed,
                }));
            }

            setBatchStatus((prev) => ({ ...prev, show: false }));
            if (!stopBatchRef.current) {
                alert(`批量解析完成：成功 ${success}，失败 ${failed}`);
            }
        } catch (error) {
            setBatchStatus((prev) => ({ ...prev, show: false }));
            alert(error.message);
        }
    };

    const handleConfirmCollection = async (bank) => {
        const collectionId = selectedCollectionByBank[bank.id] || bank.active_collection_id;
        if (!collectionId) return alert('请先选择收藏夹');
        setLoadingAction(true);
        try {
            const result = await api.banks.setActiveBookmarkCollection(bank.id, collectionId);
            setBanks((prev) => prev.map((item) => item.id === bank.id ? {
                ...item,
                active_collection_id: result.activeCollectionId,
                active_collection_name: result.activeCollectionName,
            } : item));
            setBookmarkCollectionsByBank((prev) => ({
                ...prev,
                [bank.id]: (prev[bank.id] || []).map((item) => ({
                    ...item,
                    is_active: Number(item.id) === Number(result.activeCollectionId) ? 1 : 0,
                })),
            }));
            alert(`当前收藏夹已切换为“${result.activeCollectionName}”`);
        } catch (error) {
            alert(error.message);
        }
        setLoadingAction(false);
    };

    return (
        <div className="space-y-4 pb-20">
            <div className="bg-white rounded-3xl shadow-ios p-5">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-2">Resource Library</div>
                        <h2 className="text-2xl font-bold">{currentFolderPath.length ? currentFolderPath[currentFolderPath.length - 1].name : '我的资源库'}</h2>
                        <div className="flex flex-wrap items-center gap-2 mt-3 text-sm text-gray-500">
                            <button onClick={() => onNavigateFolder(null)} className={`${currentFolderId ? 'text-gray-500' : 'text-primary font-bold'}`}>根目录</button>
                            {currentFolderPath.map((folder) => (
                                <React.Fragment key={folder.id}>
                                    <i className="fas fa-chevron-right text-[10px] text-gray-300"></i>
                                    <button onClick={() => onNavigateFolder(folder.id)} className={`${currentFolderId === folder.id ? 'text-primary font-bold' : 'text-gray-500'}`}>{folder.name}</button>
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                    <div className="text-right text-sm text-gray-400">
                        <div>{folders.length} 个文件夹</div>
                        <div>{banks.length} 个题库</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
                <button onClick={() => { setCreateType('folder'); setShowCreate(true); }} className="bg-white p-4 rounded-2xl shadow-ios flex flex-col items-center justify-center gap-2 card-press text-primary">
                    <i className="fas fa-folder-plus text-xl"></i><span className="text-xs font-bold">新建文件夹</span>
                </button>
                <button onClick={() => { setCreateType('bank'); setShowCreate(true); }} className="bg-white p-4 rounded-2xl shadow-ios flex flex-col items-center justify-center gap-2 card-press text-indigo-500">
                    <i className="fas fa-book-medical text-xl"></i><span className="text-xs font-bold">新建题库</span>
                </button>
                <button onClick={() => setShowImport(true)} className="bg-white p-4 rounded-2xl shadow-ios flex flex-col items-center justify-center gap-2 card-press text-success">
                    <i className="fas fa-file-import text-xl"></i><span className="text-xs font-bold">导入题库</span>
                </button>
            </div>

            {folders.length > 0 && (
                <div className="space-y-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-gray-400 px-1">Folders</div>
                    {folders.map((folder) => (
                        <div key={folder.id} className="bg-white p-4 rounded-2xl shadow-ios flex items-center gap-4">
                            <button onClick={() => onNavigateFolder(folder.id)} className="flex-1 flex items-center gap-4 text-left">
                                <div className="w-12 h-12 bg-yellow-100 rounded-xl flex items-center justify-center text-yellow-500 text-xl"><i className="fas fa-folder"></i></div>
                                <div className="min-w-0">
                                    <div className="font-bold truncate">{folder.name}</div>
                                    <div className="text-xs text-gray-400 mt-1">点击进入目录</div>
                                </div>
                            </button>
                            <div className="flex gap-2">
                                <button onClick={() => setRenameState({ show: true, type: 'folder', item: folder, value: folder.name })} className="w-10 h-10 rounded-full bg-gray-50 text-gray-500"><i className="fas fa-pen"></i></button>
                                <button onClick={() => setMoveState({ show: true, type: 'folder', item: folder })} className="w-10 h-10 rounded-full bg-gray-50 text-indigo-500"><i className="fas fa-arrow-right-arrow-left"></i></button>
                                <button onClick={(e) => handleDelete(e, folder, 'folder')} className="w-10 h-10 rounded-full bg-red-50 text-red-500"><i className="fas fa-trash-alt"></i></button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {banks.length > 0 && (
                <div className="space-y-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-gray-400 px-1">Banks</div>
                    {banks.map((bank) => {
                        const collections = bookmarkCollectionsByBank[bank.id] || [];
                        const selectedCollectionId = selectedCollectionByBank[bank.id] || bank.active_collection_id || '';
                        const activeCollection = collections.find((item) => Number(item.id) === Number(bank.active_collection_id))
                            || collections.find((item) => Number(item.id) === Number(selectedCollectionId))
                            || collections[0];
                        return (
                        <div key={bank.id} className="bg-white p-4 rounded-2xl shadow-ios space-y-4">
                            <div className="flex items-center gap-4">
                                <button onClick={() => onOpenBank(bank, false, activeCollection)} className="flex-1 flex items-center gap-4 text-left">
                                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-primary text-xl"><i className="fas fa-book"></i></div>
                                    <div className="min-w-0">
                                        <div className="font-bold truncate">{bank.name}</div>
                                        <div className="text-xs text-gray-400 mt-1">更新于 {formatDateTime(bank.updated_at)}</div>
                                    </div>
                                </button>
                                <div className="flex gap-2">
                                    <button onClick={() => setRenameState({ show: true, type: 'bank', item: bank, value: bank.name })} className="w-10 h-10 rounded-full bg-gray-50 text-gray-500"><i className="fas fa-pen"></i></button>
                                    <button onClick={() => setMoveState({ show: true, type: 'bank', item: bank })} className="w-10 h-10 rounded-full bg-gray-50 text-indigo-500"><i className="fas fa-arrow-right-arrow-left"></i></button>
                                    <button onClick={(e) => handleDelete(e, bank, 'bank')} className="w-10 h-10 rounded-full bg-red-50 text-red-500"><i className="fas fa-trash-alt"></i></button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3 text-center">
                                <div className="bg-gray-50 rounded-2xl py-3">
                                    <div className="text-lg font-bold">{bank.question_count || 0}</div>
                                    <div className="text-xs text-gray-400">题目</div>
                                </div>
                                <div className="bg-yellow-50 rounded-2xl py-3">
                                    <div className="text-lg font-bold text-yellow-600">{bank.bookmark_count || 0}</div>
                                    <div className="text-xs text-yellow-500">收藏</div>
                                </div>
                                <div className="bg-indigo-50 rounded-2xl py-3">
                                    <div className="text-lg font-bold text-indigo-600">{bank.analysis_count || 0}</div>
                                    <div className="text-xs text-indigo-500">已解析</div>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                <button onClick={() => onOpenBank(bank, false, activeCollection)} className="py-3 rounded-xl bg-primary/10 text-primary font-bold text-sm">做题</button>
                                <button onClick={() => onOpenBank(bank, true, activeCollection)} className="py-3 rounded-xl bg-yellow-50 text-yellow-600 font-bold text-sm">收藏夹</button>
                                <button onClick={() => handleBatchAnalyze(bank)} className="py-3 rounded-xl bg-indigo-50 text-indigo-600 font-bold text-sm">批量 AI</button>
                            </div>
                            <div className="grid grid-cols-3 gap-3 items-stretch">
                                <label className="rounded-xl bg-yellow-50 text-yellow-800 px-3 py-2 flex flex-col justify-center gap-1 min-w-0">
                                    <span className="text-[11px] font-bold text-yellow-600">当前收藏夹</span>
                                    <select
                                        value={selectedCollectionId}
                                        onChange={(event) => setSelectedCollectionByBank((prev) => ({ ...prev, [bank.id]: Number(event.target.value) }))}
                                        className="w-full bg-transparent outline-none text-sm font-bold truncate"
                                    >
                                        {collections.map((collection) => (
                                            <option key={collection.id} value={collection.id}>{collection.name}</option>
                                        ))}
                                    </select>
                                </label>
                                <button onClick={() => handleConfirmCollection(bank)} disabled={loadingAction || !selectedCollectionId} className="py-3 rounded-xl bg-yellow-100 text-yellow-700 font-bold text-sm disabled:opacity-50">确认当前收藏夹</button>
                                <button onClick={() => onManageBookmarks(bank)} className="py-3 rounded-xl bg-yellow-50 text-yellow-700 font-bold text-sm">管理收藏夹</button>
                            </div>
                        </div>
                    )})}
                </div>
            )}

            {folders.length === 0 && banks.length === 0 && (
                <div className="bg-white rounded-3xl shadow-ios p-10 text-center">
                    <div className="w-16 h-16 rounded-3xl bg-gray-100 text-gray-400 flex items-center justify-center mx-auto mb-4 text-2xl">
                        <i className="fas fa-box-open"></i>
                    </div>
                    <div className="font-bold text-lg mb-2">这里还是空的</div>
                    <div className="text-sm text-gray-400 mb-6">先创建文件夹，或者直接导入一个题库开始使用。</div>
                    <div className="flex justify-center gap-3">
                        <button onClick={() => { setCreateType('folder'); setShowCreate(true); }} className="px-5 py-3 rounded-xl bg-primary text-white font-bold">新建文件夹</button>
                        <button onClick={() => setShowImport(true)} className="px-5 py-3 rounded-xl bg-success text-white font-bold">导入题库</button>
                    </div>
                </div>
            )}

            <NameModal
                show={showCreate}
                title={`新建${createType === 'folder' ? '文件夹' : '题库'}`}
                value={newName}
                onChange={setNewName}
                onClose={() => { setShowCreate(false); setNewName(''); }}
                onSubmit={handleCreate}
                loading={loadingAction}
            />

            <NameModal
                show={renameState.show}
                title={`重命名${renameState.type === 'folder' ? '文件夹' : '题库'}`}
                value={renameState.value}
                onChange={(value) => setRenameState((prev) => ({ ...prev, value }))}
                onClose={() => setRenameState({ show: false, type: 'folder', item: null, value: '' })}
                onSubmit={handleRename}
                loading={loadingAction}
            />

            <MoveModal
                show={moveState.show}
                title={`移动${moveState.type === 'folder' ? '文件夹' : '题库'}`}
                folders={treeData}
                selectedFolderId={moveState.type === 'folder'
                    ? (moveState.item ? moveState.item.parent_id : null)
                    : (moveState.item ? moveState.item.folder_id : null)}
                currentFolderId={moveState.type === 'folder'
                    ? (moveState.item ? moveState.item.parent_id : null)
                    : (moveState.item ? moveState.item.folder_id : null)}
                onClose={() => setMoveState({ show: false, type: 'folder', item: null })}
                onSubmit={handleMove}
                loading={loadingAction}
            />

            <ImportModal show={showImport} parentId={currentFolderId} onClose={() => setShowImport(false)} onImported={async () => { await onStructureChange(); await loadData(); }} />

            {batchStatus.show && (
                <div className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl animate-slide-up">
                        <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 text-2xl animate-pulse">
                            <i className="fas fa-magic"></i>
                        </div>
                        <h3 className="font-bold text-xl mb-2">正在批量生成 AI 解析</h3>
                        <p className="text-gray-500 mb-4 text-sm">{batchStatus.bankName}</p>
                        <div className="w-full bg-gray-200 rounded-full h-3 mb-4 overflow-hidden">
                            <div className="bg-indigo-500 h-full transition-all duration-300" style={{ width: `${(batchStatus.current / batchStatus.total) * 100}%` }}></div>
                        </div>
                        <div className="text-sm text-gray-600 mb-5">进度 {batchStatus.current}/{batchStatus.total} · 成功 {batchStatus.success} · 失败 {batchStatus.failed}</div>
                        <button onClick={() => { stopBatchRef.current = true; setBatchStatus((state) => ({ ...state, show: false })); }} className="text-red-500 font-bold px-6 py-2 rounded-xl bg-red-50">
                            停止
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const Quiz = ({ bank, isBookmarkMode, collectionId, collectionName, onOpenSettings }) => {
    const [questions, setQuestions] = useState([]);
    const [index, setIndex] = useState(0);
    const [showAns, setShowAns] = useState(false);
    const [showSheet, setShowSheet] = useState(false);
    const [loading, setLoading] = useState(true);
    const [aiLoading, setAiLoading] = useState(false);
    const [filters, setFilters] = useState({
        keyword: '',
        type: '',
        hasAnalysis: '',
        masteryStatus: '',
        viewCount: '',
        sortBy: '',
        sortOrder: '',
        random: false,
    });
    const [viewCountRange, setViewCountRange] = useState({ min: null, max: null });
    const [queryInput, setQueryInput] = useState('');
    const [aiConfig, setAiConfig] = useState(() => aiConfigStore.read());
    const [shortcuts, setShortcuts] = useState(() => shortcutsStore.read());
    const [shuffleOptions, setShuffleOptions] = useState(() => localStorage.getItem(OPTION_SHUFFLE_STORAGE_KEY) === 'true');
    const lastViewRef = useRef(null);

    const loadAiConfig = async () => {
        try {
            const config = await api.ai.getConfig();
            setAiConfig((prev) => ({
                ...prev,
                provider: config.provider || 'gemini',
                key: '',
                hasKey: Boolean(config.hasKey),
            }));
        } catch (error) {}
    };

    const loadQuestions = async (activeFilters) => {
        setLoading(true);
        try {
            const params = {
                keyword: activeFilters.keyword,
                type: activeFilters.type,
                hasAnalysis: activeFilters.hasAnalysis,
                masteryStatus: activeFilters.masteryStatus,
                viewCount: activeFilters.viewCount,
                sortBy: activeFilters.sortBy,
                sortOrder: activeFilters.sortOrder,
                collectionId,
            };
            const response = isBookmarkMode
                ? await api.banks.bookmarks(bank.id, params)
                : await api.banks.questions(bank.id, params);
            const orderedQuestions = activeFilters.random ? shuffleArray(response) : response;
            const data = buildQuestionDisplays(orderedQuestions, shuffleOptions);
            setQuestions(data);
            setIndex(0);
            setShowAns(false);
            lastViewRef.current = null;
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    const loadViewCountRange = async () => {
        try {
            const range = await api.banks.viewCountRange(bank.id, {
                bookmarkedOnly: isBookmarkMode ? 'true' : '',
                collectionId,
            });
            setViewCountRange({
                min: range.min === null || range.min === undefined ? null : Number(range.min),
                max: range.max === null || range.max === undefined ? null : Number(range.max),
            });
        } catch (error) {
            setViewCountRange({ min: null, max: null });
        }
    };

    useEffect(() => {
        loadViewCountRange();
        loadQuestions(filters);
    }, [bank.id, isBookmarkMode, collectionId]);

    useEffect(() => {
        loadAiConfig();
    }, []);

    const currentQ = questions[index];

    const goPrevious = () => {
        if (index === 0) return;
        setIndex((value) => value - 1);
        setShowAns(false);
        lastViewRef.current = null;
    };

    const goNext = () => {
        if (index >= questions.length - 1) return;
        setIndex((value) => value + 1);
        setShowAns(false);
        lastViewRef.current = null;
    };

    useEffect(() => {
        if (!showAns || !currentQ || lastViewRef.current === currentQ.id) return;
        lastViewRef.current = currentQ.id;
        api.questions.updateProgress(currentQ.id, { viewed: true }).then((progress) => {
            setQuestions((prev) => prev.map((item) => item.id === currentQ.id ? { ...item, ...progress } : item));
        }).catch(() => {});
    }, [showAns, currentQ ? currentQ.id : null]);

    useEffect(() => {
        const handleShortcutsUpdate = (event) => {
            setShortcuts(event.detail || shortcutsStore.read());
        };
        window.addEventListener('quiz-shortcuts-updated', handleShortcutsUpdate);
        return () => window.removeEventListener('quiz-shortcuts-updated', handleShortcutsUpdate);
    }, []);

    useEffect(() => {
        const handleAiConfigUpdate = (event) => {
            const detail = event.detail || {};
            setAiConfig((prev) => ({
                ...prev,
                provider: detail.provider || prev.provider,
                key: '',
                hasKey: Boolean(detail.hasKey),
            }));
        };
        window.addEventListener('ai-config-updated', handleAiConfigUpdate);
        return () => window.removeEventListener('ai-config-updated', handleAiConfigUpdate);
    }, []);

    useEffect(() => {
        if (loading || questions.length === 0 || showSheet) return undefined;

        const handleKeyDown = (event) => {
            if (shouldIgnoreKeyboardShortcut(event)) return;
            const key = normalizeShortcutKey(event.key);
            if (!key) return;

            if (key === shortcuts.previous) {
                event.preventDefault();
                goPrevious();
            } else if (key === shortcuts.next) {
                event.preventDefault();
                goNext();
            } else if (key === shortcuts.answer) {
                event.preventDefault();
                setShowAns(true);
            } else if (key === shortcuts.bookmark) {
                event.preventDefault();
                toggleFav();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [loading, questions.length, index, showSheet, shortcuts.previous, shortcuts.next, shortcuts.answer, shortcuts.bookmark]);

    const applyFilters = async () => {
        const nextFilters = { ...filters, keyword: queryInput.trim() };
        setFilters(nextFilters);
        await loadQuestions(nextFilters);
    };

    const handleRandomToggle = async () => {
        const nextFilters = filters.random
            ? { ...filters, random: false }
            : { ...filters, random: true, sortBy: '', sortOrder: '' };
        setFilters(nextFilters);
        await loadQuestions(nextFilters);
    };

    const handleShuffleOptionsToggle = () => {
        const nextValue = !shuffleOptions;
        setShuffleOptions(nextValue);
        localStorage.setItem(OPTION_SHUFFLE_STORAGE_KEY, nextValue ? 'true' : 'false');
        setQuestions((prev) => buildQuestionDisplays(prev, nextValue));
    };

    const handleQuickFilter = async (key, value) => {
        const nextFilters = { ...filters, [key]: filters[key] === value ? '' : value };
        setFilters(nextFilters);
        await loadQuestions(nextFilters);
    };

    const handleViewCountSort = async () => {
        const nextSortOrder = filters.sortBy !== 'viewCount'
            ? 'desc'
            : (filters.sortOrder === 'desc' ? 'asc' : '');
        const nextFilters = {
            ...filters,
            sortBy: nextSortOrder ? 'viewCount' : '',
            sortOrder: nextSortOrder,
            random: false,
        };
        setFilters(nextFilters);
        await loadQuestions(nextFilters);
    };

    const handleViewCountFilter = async (value) => {
        const nextFilters = { ...filters, viewCount: value };
        setFilters(nextFilters);
        await loadQuestions(nextFilters);
    };

    const toggleFav = async () => {
        try {
            await api.questions.toggleBookmark(currentQ.id, collectionId);
            setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, is_bookmarked: item.is_bookmarked ? 0 : 1 } : item));
        } catch (error) {
            alert(error.message);
        }
    };

    const updateMasteryStatus = async (masteryStatus) => {
        try {
            const progress = await api.questions.updateProgress(currentQ.id, { masteryStatus });
            setQuestions((prev) => prev.map((item) => item.id === currentQ.id ? { ...item, ...progress } : item));
        } catch (error) {
            alert(error.message);
        }
    };

    const handleDeleteQuestion = async () => {
        if (!confirm('确定要删除这道题吗？')) return;
        try {
            await api.questions.remove(currentQ.id);
            const nextQuestions = questions.filter((_, itemIndex) => itemIndex !== index);
            setQuestions(nextQuestions);
            if (index >= nextQuestions.length && index > 0) setIndex(index - 1);
        } catch (error) {
            alert(error.message);
        }
    };

    const fetchAI = async (forceRefresh = false) => {
        if (!aiConfig.hasKey) {
            onOpenSettings('api');
            return;
        }

        setAiLoading(true);
        try {
            const response = await api.ai.analyze({
                questionId: currentQ.id,
                question: currentQ.content,
                answer: currentQ.answer,
                forceRefresh,
            });
            setQuestions((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, analysis: response.analysis } : item));
        } catch (error) {
            alert(error.message);
        }
        setAiLoading(false);
    };

    if (loading) return <div className="p-10 text-center text-gray-400">加载中...</div>;
    if (questions.length === 0) {
        return (
            <div className="space-y-4">
                <div className="bg-white rounded-3xl shadow-ios p-5">
                    <div className="text-sm text-gray-500 mb-3">筛选题目</div>
                    <div className="flex gap-2">
                        <input className="flex-1 p-3 bg-gray-50 rounded-xl outline-none" placeholder="搜索题干、答案、来源" value={queryInput} onChange={(e)=>setQueryInput(e.target.value)} />
                        <button onClick={applyFilters} className="px-5 rounded-xl bg-primary text-white font-bold">搜索</button>
                    </div>
                </div>
                <div className="p-10 text-center text-gray-400">当前筛选条件下暂无题目</div>
            </div>
        );
    }

    const progress = ((index + 1) / questions.length) * 100;
    const masteryLabelMap = {
        unseen: '未学习',
        learning: '学习中',
        mastered: '已掌握',
        review: '待复习',
    };
    const viewCountOptions = viewCountRange.min === null || viewCountRange.max === null
        ? []
        : Array.from(
            { length: Math.max(0, viewCountRange.max - viewCountRange.min + 1) },
            (_, optionIndex) => viewCountRange.min + optionIndex,
        );
    const currentOptions = currentQ.display_options || currentQ.options || [];
    const currentAnswer = currentQ.display_answer || currentQ.answer || '';

    return (
        <div className="flex flex-col h-full relative gap-4">
            <div className="bg-white rounded-3xl shadow-ios p-5 space-y-4">
                <div className="flex flex-col md:flex-row gap-3">
                    <input className="flex-1 p-3 bg-gray-50 rounded-xl outline-none" placeholder="搜索题干、答案、来源" value={queryInput} onChange={(e)=>setQueryInput(e.target.value)} />
                    <div className="flex flex-wrap gap-2">
                        <button onClick={applyFilters} className="px-5 rounded-xl bg-primary text-white font-bold whitespace-nowrap">搜索</button>
                        <button onClick={handleRandomToggle} className={`px-5 rounded-xl font-bold whitespace-nowrap ${filters.random ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600'}`}>随机</button>
                        <button onClick={handleShuffleOptionsToggle} className={`px-5 rounded-xl font-bold whitespace-nowrap ${shuffleOptions ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600'}`}>选项打乱</button>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button onClick={() => handleQuickFilter('type', 'single_choice')} className={`px-3 py-2 rounded-full text-sm ${filters.type === 'single_choice' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>单选</button>
                    <button onClick={() => handleQuickFilter('type', 'multiple_choice')} className={`px-3 py-2 rounded-full text-sm ${filters.type === 'multiple_choice' ? 'bg-primary text-white' : 'bg-gray-100 text-gray-600'}`}>多选</button>
                    <button onClick={() => handleQuickFilter('hasAnalysis', 'false')} className={`px-3 py-2 rounded-full text-sm ${filters.hasAnalysis === 'false' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600'}`}>未解析</button>
                    <button onClick={() => handleQuickFilter('hasAnalysis', 'true')} className={`px-3 py-2 rounded-full text-sm ${filters.hasAnalysis === 'true' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-600'}`}>已解析</button>
                    <button onClick={() => handleQuickFilter('masteryStatus', 'mastered')} className={`px-3 py-2 rounded-full text-sm ${filters.masteryStatus === 'mastered' ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600'}`}>已掌握</button>
                    <button onClick={() => handleQuickFilter('masteryStatus', 'review')} className={`px-3 py-2 rounded-full text-sm ${filters.masteryStatus === 'review' ? 'bg-yellow-500 text-white' : 'bg-gray-100 text-gray-600'}`}>待复习</button>
                    <button onClick={handleViewCountSort} className={`px-3 py-2 rounded-full text-sm ${filters.sortBy === 'viewCount' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                        查看次数{filters.sortBy === 'viewCount' ? (filters.sortOrder === 'asc' ? ' ↑' : ' ↓') : ''}
                    </button>
                    <select
                        value={filters.viewCount}
                        onChange={(event) => handleViewCountFilter(event.target.value)}
                        disabled={viewCountOptions.length === 0}
                        className={`px-3 py-2 rounded-full text-sm outline-none ${filters.viewCount !== '' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-600'} disabled:opacity-50`}
                    >
                        <option value="">全部次数</option>
                        {viewCountOptions.map((count) => (
                            <option key={count} value={String(count)}>{count} 次</option>
                        ))}
                    </select>
                </div>
                <div className="flex justify-between items-center text-xs text-gray-400">
                    <div>当前共 {questions.length} 题</div>
                    <div>{isBookmarkMode ? `收藏夹：${collectionName || '当前收藏夹'}` : `题库模式 · ${collectionName || '当前收藏夹'}`}</div>
                </div>
            </div>

            <div className="sticky top-0 bg-background z-10 py-2">
                <div className="flex justify-between items-center px-1 mb-1">
                    <div className="text-xs text-gray-400">进度: {index + 1}/{questions.length}</div>
                    <button onClick={handleDeleteQuestion} className="text-gray-400 hover:text-red-500 px-2"><i className="fas fa-trash-alt"></i></button>
                </div>
                <div className="h-1 bg-gray-200 rounded-full overflow-hidden"><div className="h-full bg-success transition-all duration-300" style={{ width: `${progress}%` }}></div></div>
            </div>

            <div className="flex-1 pb-36">
                <div className="bg-white rounded-3xl shadow-ios p-6 min-h-[50vh] flex flex-col">
                    <div className="flex flex-wrap gap-2 mb-4">
                        <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">{currentQ.type || 'unknown'}</span>
                        <span className="px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-xs">{masteryLabelMap[currentQ.mastery_status] || '未学习'}</span>
                        <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">查看 {currentQ.view_count || 0} 次</span>
                        {currentQ.last_viewed_at && <span className="px-3 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">最近 {formatDateTime(currentQ.last_viewed_at)}</span>}
                    </div>

                    <div className="text-lg font-medium leading-relaxed text-gray-800 whitespace-pre-wrap flex-1">{currentQ.stem || currentQ.content}</div>
                    {hasItems(currentOptions) && (
                        <div className="mt-6 space-y-3">
                            {currentOptions.map((option) => (
                                <div key={option.key} className="rounded-2xl bg-gray-50 p-4 text-sm">
                                    <span className="font-bold mr-2">{option.key}.</span>{option.text}
                                </div>
                            ))}
                        </div>
                    )}

                    {showAns && (
                        <div className="mt-8 pt-6 border-t border-gray-100 animate-slide-up">
                            <div className="font-bold text-success mb-2"><i className="fas fa-check-circle mr-2"></i>答案：{currentAnswer || '未提供'}</div>
                            <div className="flex flex-wrap gap-2 mb-4">
                                <button onClick={() => updateMasteryStatus('learning')} className={`px-3 py-2 rounded-full text-sm ${currentQ.mastery_status === 'learning' ? 'bg-blue-500 text-white' : 'bg-blue-50 text-blue-600'}`}>学习中</button>
                                <button onClick={() => updateMasteryStatus('mastered')} className={`px-3 py-2 rounded-full text-sm ${currentQ.mastery_status === 'mastered' ? 'bg-green-500 text-white' : 'bg-green-50 text-green-600'}`}>已掌握</button>
                                <button onClick={() => updateMasteryStatus('review')} className={`px-3 py-2 rounded-full text-sm ${currentQ.mastery_status === 'review' ? 'bg-yellow-500 text-white' : 'bg-yellow-50 text-yellow-600'}`}>待复习</button>
                            </div>
                            {currentQ.analysis ? (
                                <div className="bg-indigo-50 p-4 rounded-xl text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap border border-indigo-100 mt-3">
                                    <div className="font-bold mb-2 flex items-center justify-between gap-3">
                                        <span className="flex items-center gap-2"><i className="fas fa-robot"></i>AI 解析</span>
                                        <div className="flex gap-2 text-xs">
                                            <button onClick={() => writeClipboard(currentQ.analysis)} className="px-2 py-1 rounded-full bg-white/80 text-indigo-600">复制</button>
                                            <button onClick={() => fetchAI(true)} className="px-2 py-1 rounded-full bg-white/80 text-indigo-600">重新生成</button>
                                        </div>
                                    </div>
                                    {currentQ.analysis}
                                </div>
                            ) : (
                                <button onClick={() => fetchAI(false)} disabled={aiLoading} className="mt-2 text-sm text-primary font-bold flex items-center gap-2">
                                    {aiLoading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-magic"></i>} 点击生成 AI 解析
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="glass fixed bottom-0 left-0 right-0 pb-safe pt-2 px-4 z-40">
                <div className="max-w-4xl mx-auto h-16 flex items-center justify-between gap-4">
                    <button disabled={index === 0} onClick={goPrevious} className="w-12 h-12 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center disabled:opacity-30"><i className="fas fa-chevron-left"></i></button>
                    <div className="flex gap-3">
                        <button onClick={() => setShowAns(!showAns)} className={`h-12 px-6 rounded-full font-bold shadow-lg transition active:scale-95 ${showAns ? 'bg-gray-800 text-white' : 'bg-warning text-white'}`}>{showAns ? '隐藏' : '看答案'}</button>
                        <button onClick={toggleFav} className={`w-12 h-12 rounded-full border flex items-center justify-center shadow-lg active:scale-95 ${currentQ.is_bookmarked ? 'bg-yellow-50 border-yellow-400 text-yellow-500' : 'bg-white border-gray-100 text-gray-300'}`}><i className="fas fa-star"></i></button>
                        <button onClick={() => setShowSheet(true)} className="w-12 h-12 rounded-full bg-white border border-gray-100 text-primary flex items-center justify-center shadow-lg active:scale-95"><i className="fas fa-th-large"></i></button>
                    </div>
                    <button disabled={index === questions.length - 1} onClick={goNext} className="w-12 h-12 rounded-full bg-primary text-white shadow-lg shadow-blue-500/30 flex items-center justify-center disabled:opacity-30"><i className="fas fa-chevron-right"></i></button>
                </div>
            </div>

            {showSheet && (
                <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowSheet(false)}>
                    <div className="bg-white w-full max-w-md rounded-t-3xl p-6 pb-safe max-h-[70vh] overflow-y-auto animate-slide-up" onClick={(e)=>e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4"><h3 className="font-bold text-lg">答题卡</h3><button onClick={() => setShowSheet(false)}><i className="fas fa-times"></i></button></div>
                        <div className="grid grid-cols-6 gap-3">
                            {questions.map((question, questionIndex) => (
                                <button
                                    key={question.id}
                                    onClick={() => { setIndex(questionIndex); setShowAns(false); setShowSheet(false); lastViewRef.current = null; }}
                                    className={`aspect-square rounded-xl font-bold text-sm ${
                                        questionIndex === index
                                            ? 'bg-primary text-white'
                                            : question.mastery_status === 'mastered'
                                                ? 'bg-green-100 text-green-700'
                                                : question.is_bookmarked
                                                    ? 'bg-yellow-100 text-yellow-600'
                                                    : question.view_count > 0
                                                        ? 'bg-blue-100 text-blue-600'
                                                        : 'bg-gray-100 text-gray-500'
                                    }`}
                                >
                                    {questionIndex + 1}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

const BookmarkManager = ({ bank }) => {
    const [collections, setCollections] = useState([]);
    const [activeCollectionId, setActiveCollectionId] = useState('');
    const [newName, setNewName] = useState('');
    const [renameState, setRenameState] = useState({ show: false, item: null, value: '' });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const loadCollections = async () => {
        setLoading(true);
        try {
            const result = await api.banks.bookmarkCollections(bank.id);
            setCollections(result.collections || []);
            setActiveCollectionId(result.activeCollectionId || '');
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    useEffect(() => {
        loadCollections();
    }, [bank.id]);

    const handleCreate = async () => {
        const name = newName.trim();
        if (!name) return alert('请输入收藏夹名称');
        setSaving(true);
        try {
            await api.banks.createBookmarkCollection(bank.id, { name });
            setNewName('');
            await loadCollections();
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleRename = async () => {
        if (!renameState.item) return;
        const name = renameState.value.trim();
        if (!name) return alert('请输入收藏夹名称');
        setSaving(true);
        try {
            await api.bookmarkCollections.rename(renameState.item.id, name);
            setRenameState({ show: false, item: null, value: '' });
            await loadCollections();
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleDelete = async (collection) => {
        if (collection.is_default) return alert('默认收藏夹不能删除');
        if (!confirm(`删除收藏夹“${collection.name}”？\n只会删除收藏索引，不会删除题目。`)) return;
        setSaving(true);
        try {
            const result = await api.bookmarkCollections.remove(collection.id);
            await loadCollections();
            if (result.activeCollectionId) setActiveCollectionId(result.activeCollectionId);
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleExportMarkdown = async (collection) => {
        try {
            await api.banks.downloadExport(
                bank.id,
                'markdown',
                `${bank.name}-${collection.name}.md`,
                'bookmarks',
                collection.id,
            );
        } catch (error) {
            alert(error.message);
        }
    };

    return (
        <div className="space-y-4 pb-20">
            <div className="bg-white rounded-3xl shadow-ios p-5">
                <div className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-2">Bookmark Collections</div>
                <h2 className="text-2xl font-bold">{bank.name}</h2>
                <div className="text-sm text-gray-400 mt-2">管理当前题库的收藏夹。</div>
            </div>

            <div className="bg-white rounded-3xl shadow-ios p-5 space-y-3">
                <div className="font-bold">添加收藏夹</div>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                    <input className="p-3 bg-gray-50 rounded-xl outline-none" placeholder="收藏夹名称" value={newName} onChange={(e)=>setNewName(e.target.value)} />
                    <button onClick={handleCreate} disabled={saving} className="px-5 py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">添加</button>
                </div>
            </div>

            <div className="space-y-3">
                {loading ? (
                    <div className="p-10 text-center text-gray-400">加载中...</div>
                ) : collections.length ? collections.map((collection) => (
                    <div key={collection.id} className="bg-white rounded-2xl shadow-ios p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <div className="font-bold truncate">{collection.name}</div>
                                {collection.is_default ? <span className="px-2 py-1 rounded-full bg-yellow-50 text-yellow-600 text-xs">默认</span> : null}
                                {Number(collection.id) === Number(activeCollectionId) ? <span className="px-2 py-1 rounded-full bg-primary/10 text-primary text-xs">当前</span> : null}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">{collection.question_count || 0} 道题 · 更新于 {formatDateTime(collection.updated_at)}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 md:flex md:justify-end">
                            <button onClick={() => setRenameState({ show: true, item: collection, value: collection.name })} disabled={saving} className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold disabled:opacity-50">改名</button>
                            <button onClick={() => handleExportMarkdown(collection)} className="px-3 py-2 rounded-xl bg-yellow-50 text-yellow-700 text-sm font-bold">导出 MD</button>
                            <button onClick={() => handleDelete(collection)} disabled={saving || collection.is_default} className="px-3 py-2 rounded-xl bg-red-50 text-red-500 text-sm font-bold disabled:opacity-40">删除</button>
                        </div>
                    </div>
                )) : (
                    <div className="bg-white rounded-3xl shadow-ios p-10 text-center text-gray-400">暂无收藏夹。</div>
                )}
            </div>

            <NameModal
                show={renameState.show}
                title="重命名收藏夹"
                value={renameState.value}
                onChange={(value) => setRenameState((prev) => ({ ...prev, value }))}
                onClose={() => setRenameState({ show: false, item: null, value: '' })}
                onSubmit={handleRename}
                loading={saving}
            />
        </div>
    );
};

const AdminPanelModal = ({ show, onClose }) => {
    const [users, setUsers] = useState([]);
    const [banks, setBanks] = useState([]);
    const [inviteCodes, setInviteCodes] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState('');
    const [inviteForm, setInviteForm] = useState({ code: '', expiresAt: '' });
    const [inviteDrafts, setInviteDrafts] = useState({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const syncInviteDrafts = (items) => {
        const drafts = {};
        items.forEach((item) => {
            drafts[item.code] = sqlDateTimeToInputValue(item.expiresAt);
        });
        setInviteDrafts(drafts);
    };

    const loadUsers = async () => {
        const data = await api.admin.users();
        setUsers(data);
    };

    const loadBanks = async (userId = selectedUserId) => {
        const data = await api.admin.banks(userId || '');
        setBanks(data);
    };

    const loadInvites = async () => {
        const data = await api.admin.inviteCodes();
        setInviteCodes(data);
        syncInviteDrafts(data);
    };

    const loadAll = async () => {
        setLoading(true);
        try {
            await Promise.all([loadUsers(), loadBanks(), loadInvites()]);
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    useEffect(() => {
        if (show) loadAll();
    }, [show]);

    const handleUserChange = async (event) => {
        const nextUserId = event.target.value;
        setSelectedUserId(nextUserId);
        setLoading(true);
        try {
            await loadBanks(nextUserId);
        } catch (error) {
            alert(error.message);
        }
        setLoading(false);
    };

    const handleDeleteBank = async (bank) => {
        const message = `永久删除题库“${bank.name}”？\n所属用户：${bank.username}\n将直接从服务器删除 ${bank.questionCount || 0} 道题及相关记录，不能从回收站恢复。`;
        if (!confirm(message)) return;
        setSaving(true);
        try {
            await api.admin.removeBank(bank.id);
            await Promise.all([loadUsers(), loadBanks()]);
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleCreateInvite = async () => {
        setSaving(true);
        try {
            const created = await api.admin.createInviteCode({
                code: inviteForm.code.trim(),
                expiresAt: inviteForm.expiresAt,
            });
            setInviteForm({ code: '', expiresAt: '' });
            await loadInvites();
            writeClipboard(created.code);
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleUpdateInvite = async (code) => {
        setSaving(true);
        try {
            await api.admin.updateInviteCode(code, {
                expiresAt: inviteDrafts[code] || '',
                clearExpiresAt: !inviteDrafts[code],
            });
            await loadInvites();
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    const handleDeleteInvite = async (code) => {
        if (!confirm(`删除邀请码“${code}”？已注册用户不会受到影响。`)) return;
        setSaving(true);
        try {
            await api.admin.removeInviteCode(code);
            await loadInvites();
        } catch (error) {
            alert(error.message);
        }
        setSaving(false);
    };

    if (!show) return null;

    const selectedUser = users.find((user) => String(user.id) === String(selectedUserId));
    const visibleUserCount = selectedUser ? 1 : users.length;
    const totalActiveBanks = users.reduce((sum, user) => sum + (user.activeBankCount || 0), 0);
    const totalActiveQuestions = users.reduce((sum, user) => sum + (user.activeQuestionCount || 0), 0);

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-5xl rounded-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="font-bold text-xl">管理员后台</h3>
                        <div className="text-xs text-gray-400 mt-1">当前 {visibleUserCount} 个用户视图，活跃题库 {selectedUser ? selectedUser.activeBankCount : totalActiveBanks} 个，活跃题目 {selectedUser ? selectedUser.activeQuestionCount : totalActiveQuestions} 道</div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 text-gray-500"><i className="fas fa-times"></i></button>
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-6 bg-background/70">
                    <div className="bg-white rounded-2xl shadow-ios p-4 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                            <div>
                                <div className="font-bold">账户题库</div>
                                <div className="text-xs text-gray-400 mt-1">永久删除会清理题目、选项、收藏、进度和导入批次。</div>
                            </div>
                            <select value={selectedUserId} onChange={handleUserChange} className="p-3 bg-gray-50 rounded-xl outline-none text-sm">
                                <option value="">全部用户</option>
                                {users.map((user) => (
                                    <option key={user.id} value={user.id}>{user.username}{user.isAdmin ? '（管理员）' : ''}</option>
                                ))}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {(selectedUser ? [selectedUser] : users).map((user) => (
                                <div key={user.id} className="bg-gray-50 rounded-2xl p-4">
                                    <div className="font-bold truncate">{user.username}</div>
                                    <div className="text-xs text-gray-400 mt-2">题库 {user.activeBankCount}/{user.bankCount}</div>
                                    <div className="text-xs text-gray-400">题目 {user.activeQuestionCount}/{user.questionCount}</div>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3">
                            {loading ? (
                                <div className="text-center text-gray-400 py-8">加载中...</div>
                            ) : banks.length ? banks.map((bank) => (
                                <div key={bank.id} className="border border-gray-100 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <div className="font-bold truncate">{bank.name}</div>
                                            {bank.isDeleted && <span className="px-2 py-1 rounded-full bg-red-50 text-red-500 text-xs">回收站</span>}
                                        </div>
                                        <div className="text-xs text-gray-400 mt-1">用户：{bank.username} · 题目 {bank.activeQuestionCount}/{bank.questionCount} · 收藏 {bank.bookmarkCount}</div>
                                        <div className="text-xs text-gray-400 mt-1">更新于 {formatDateTime(bank.updatedAt)}</div>
                                    </div>
                                    <button disabled={saving} onClick={() => handleDeleteBank(bank)} className="px-4 py-3 rounded-xl bg-red-50 text-red-500 font-bold text-sm disabled:opacity-50">
                                        永久删除
                                    </button>
                                </div>
                            )) : (
                                <div className="text-center text-gray-400 py-8">暂无题库。</div>
                            )}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl shadow-ios p-4 space-y-4">
                        <div>
                            <div className="font-bold">邀请码</div>
                            <div className="text-xs text-gray-400 mt-1">空的邀请码会自动生成，空的有效期表示长期有效。</div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
                            <input className="p-3 bg-gray-50 rounded-xl outline-none" placeholder="自定义邀请码（可空）" value={inviteForm.code} onChange={(e)=>setInviteForm({ ...inviteForm, code: e.target.value })} />
                            <input className="p-3 bg-gray-50 rounded-xl outline-none" type="datetime-local" value={inviteForm.expiresAt} onChange={(e)=>setInviteForm({ ...inviteForm, expiresAt: e.target.value })} />
                            <button disabled={saving} onClick={handleCreateInvite} className="px-5 py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-50">生成</button>
                        </div>

                        <div className="space-y-3">
                            {inviteCodes.length ? inviteCodes.map((invite) => (
                                <div key={invite.code} className="border border-gray-100 rounded-2xl p-4 space-y-3">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                        <div>
                                            <div className="font-mono font-bold text-lg">{invite.code}</div>
                                            <div className="text-xs text-gray-400 mt-1">
                                                {invite.isUsed ? `已使用：${invite.usedByUsername || '未知用户'}` : invite.isExpired ? '已过期' : '可使用'}
                                                {invite.expiresAt ? ` · 有效期至 ${formatDateTime(invite.expiresAt)}` : ' · 长期有效'}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => writeClipboard(invite.code)} className="px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold">复制</button>
                                            <button disabled={saving} onClick={() => handleDeleteInvite(invite.code)} className="px-3 py-2 rounded-xl bg-red-50 text-red-500 text-sm font-bold disabled:opacity-50">删除</button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
                                        <input className="p-3 bg-gray-50 rounded-xl outline-none text-sm" type="datetime-local" value={inviteDrafts[invite.code] || ''} onChange={(e)=>setInviteDrafts({ ...inviteDrafts, [invite.code]: e.target.value })} />
                                        <button disabled={saving} onClick={() => handleUpdateInvite(invite.code)} className="px-4 py-3 rounded-xl bg-indigo-50 text-indigo-600 font-bold text-sm disabled:opacity-50">保存有效期</button>
                                    </div>
                                </div>
                            )) : (
                                <div className="text-center text-gray-400 py-8">暂无邀请码。</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const PersonalSettingsModal = ({ show, user, currentFolderId, initialSection, onClose, onLogout }) => {
    const [activeTab, setActiveTab] = useState('profile');
    const [aiConfig, setAiConfig] = useState(() => aiConfigStore.read());
    const [shortcutsDraft, setShortcutsDraft] = useState(() => shortcutsStore.read());
    const [banks, setBanks] = useState([]);
    const [loadingBanks, setLoadingBanks] = useState(false);
    const [savingAi, setSavingAi] = useState(false);
    const [savingShortcuts, setSavingShortcuts] = useState(false);
    const [exportingKey, setExportingKey] = useState('');

    const loadAiConfig = async () => {
        try {
            const config = await api.ai.getConfig();
            setAiConfig({
                provider: config.provider || 'gemini',
                key: '',
                hasKey: Boolean(config.hasKey),
            });
        } catch (error) {
            alert(error.message);
        }
    };

    const loadBanks = async () => {
        setLoadingBanks(true);
        try {
            const data = await api.banks.list(currentFolderId);
            setBanks(data);
        } catch (error) {
            alert(error.message);
        }
        setLoadingBanks(false);
    };

    useEffect(() => {
        if (!show) return;
        setActiveTab(initialSection || 'profile');
        setShortcutsDraft(shortcutsStore.read());
        loadAiConfig();
        loadBanks();
    }, [show, initialSection, currentFolderId]);

    const saveAiSettings = async () => {
        if (!aiConfig.hasKey && !aiConfig.key.trim()) {
            alert('请先输入当前账号的 API Key');
            return;
        }

        setSavingAi(true);
        try {
            const result = await api.ai.saveConfig({
                provider: aiConfig.provider,
                key: aiConfig.key,
            });
            aiConfigStore.save(aiConfig);
            const nextConfig = {
                provider: result.provider,
                key: '',
                hasKey: Boolean(result.hasKey),
            };
            setAiConfig(nextConfig);
            window.dispatchEvent(new CustomEvent('ai-config-updated', { detail: nextConfig }));
            alert('AI 配置已保存到当前账号');
        } catch (error) {
            alert(error.message);
        }
        setSavingAi(false);
    };

    const updateShortcut = (name, value) => {
        setShortcutsDraft((prev) => ({
            ...prev,
            [name]: normalizeShortcutKey(value),
        }));
    };

    const captureShortcut = (event, name) => {
        event.preventDefault();
        if (event.key === 'Backspace' || event.key === 'Delete') {
            updateShortcut(name, '');
            return;
        }
        updateShortcut(name, event.key);
    };

    const saveShortcuts = () => {
        const nextDraft = {
            previous: normalizeShortcutKey(shortcutsDraft.previous),
            next: normalizeShortcutKey(shortcutsDraft.next),
            answer: normalizeShortcutKey(shortcutsDraft.answer),
            bookmark: normalizeShortcutKey(shortcutsDraft.bookmark),
        };
        const values = Object.values(nextDraft);
        if (values.some((value) => !value)) {
            alert('请为每个快捷键填写一个按键');
            return;
        }
        if (new Set(values).size !== values.length) {
            alert('快捷键不能重复');
            return;
        }

        setSavingShortcuts(true);
        const nextShortcuts = shortcutsStore.save(nextDraft);
        setShortcutsDraft(nextShortcuts);
        window.dispatchEvent(new CustomEvent('quiz-shortcuts-updated', { detail: nextShortcuts }));
        setSavingShortcuts(false);
        alert('快捷键已保存');
    };

    const resetShortcuts = () => {
        const nextShortcuts = shortcutsStore.save(DEFAULT_SHORTCUTS);
        setShortcutsDraft(nextShortcuts);
        window.dispatchEvent(new CustomEvent('quiz-shortcuts-updated', { detail: nextShortcuts }));
    };

    const handleExport = async (bank, format) => {
        const extension = format === 'markdown' ? 'md' : format;
        const key = `${bank.id}-${format}`;
        setExportingKey(key);
        try {
            await api.banks.downloadExport(bank.id, format, `${bank.name}.${extension}`);
        } catch (error) {
            alert(error.message);
        }
        setExportingKey('');
    };

    if (!show) return null;

    const tabs = [
        { id: 'profile', label: '个人', icon: 'fa-user' },
        { id: 'api', label: 'API', icon: 'fa-key' },
        { id: 'shortcuts', label: '快捷键', icon: 'fa-keyboard' },
        { id: 'export', label: '导出', icon: 'fa-file-export' },
    ];

    const renderShortcutInput = (name, label, hint) => (
        <label className="grid grid-cols-[1fr_5rem] gap-3 items-center rounded-2xl bg-gray-50 p-4">
            <span>
                <span className="block font-bold text-sm text-gray-700">{label}</span>
                <span className="block text-xs text-gray-400 mt-1">{hint}</span>
            </span>
            <input
                className="h-12 rounded-xl border border-gray-200 bg-white text-center text-lg font-bold outline-none focus:ring-2 focus:ring-primary/30"
                readOnly
                value={formatShortcutKey(shortcutsDraft[name])}
                placeholder="按键"
                onKeyDown={(event) => captureShortcut(event, name)}
                onPaste={(event) => event.preventDefault()}
            />
        </label>
    );

    return (
        <div data-settings-modal="true" className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl max-h-[92vh] overflow-hidden flex flex-col">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-4">
                    <div>
                        <h3 className="font-bold text-xl">个人设置</h3>
                        <div className="text-xs text-gray-400 mt-1">{user.name}</div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-gray-100 text-gray-500"><i className="fas fa-times"></i></button>
                </div>

                <div className="p-4 border-b border-gray-100 grid grid-cols-4 gap-2">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`py-3 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 ${activeTab === tab.id ? 'bg-primary text-white' : 'bg-gray-50 text-gray-500'}`}
                        >
                            <i className={`fas ${tab.icon}`}></i>
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto p-5 bg-background/70">
                    {activeTab === 'profile' && (
                        <div className="bg-white rounded-2xl shadow-ios p-5 space-y-5">
                            <div>
                                <div className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-2">Account</div>
                                <div className="font-bold text-lg">{user.name}</div>
                                <div className="text-sm text-gray-400 mt-1">{user.isAdmin ? '管理员账号' : '普通账号'}</div>
                            </div>
                            <button onClick={onLogout} className="w-full py-3 rounded-xl bg-red-50 text-red-500 font-bold">
                                <i className="fas fa-right-from-bracket mr-2"></i>退出登录
                            </button>
                        </div>
                    )}

                    {activeTab === 'api' && (
                        <div className="bg-white rounded-2xl shadow-ios p-5 space-y-4">
                            <div>
                                <div className="font-bold">AI API 配置</div>
                                <div className="text-xs text-gray-400 mt-1">{aiConfigStore.message}</div>
                            </div>
                            <div className="flex bg-gray-100 p-1 rounded-xl">
                                {['gemini', 'deepseek'].map((provider) => (
                                    <button key={provider} onClick={() => setAiConfig({ ...aiConfig, provider })} className={`flex-1 py-2 rounded-lg text-sm font-bold capitalize ${aiConfig.provider === provider ? 'bg-white shadow text-primary' : 'text-gray-400'}`}>{provider}</button>
                                ))}
                            </div>
                            <input
                                className="w-full p-3 border rounded-xl outline-none"
                                type="password"
                                value={aiConfig.key}
                                onChange={(event) => setAiConfig({ ...aiConfig, key: event.target.value })}
                                placeholder={aiConfig.hasKey ? '留空则保留当前 Key' : '输入当前账号的 API Key'}
                            />
                            <div className="text-xs text-gray-400">
                                {aiConfig.hasKey ? '当前账号已保存密钥，留空保存只会更新 Provider。' : '当前账号尚未配置 AI Key。'}
                            </div>
                            <button onClick={saveAiSettings} disabled={savingAi} className="w-full bg-primary text-white py-3 rounded-xl font-bold disabled:opacity-60">
                                {savingAi ? '保存中...' : '保存 API 设置'}
                            </button>
                        </div>
                    )}

                    {activeTab === 'shortcuts' && (
                        <div className="bg-white rounded-2xl shadow-ios p-5 space-y-4">
                            <div>
                                <div className="font-bold">PC 浏览器快捷键</div>
                                <div className="text-xs text-gray-400 mt-1">默认：A 上一个，D 下一个，S 显示答案，空格收藏。</div>
                            </div>
                            {renderShortcutInput('previous', '上一个', '做题页切到上一题')}
                            {renderShortcutInput('next', '下一个', '做题页切到下一题')}
                            {renderShortcutInput('answer', '显示答案', '显示当前题答案')}
                            {renderShortcutInput('bookmark', '收藏', '收藏或取消收藏当前题')}
                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={resetShortcuts} className="py-3 rounded-xl bg-gray-100 text-gray-600 font-bold">恢复默认</button>
                                <button onClick={saveShortcuts} disabled={savingShortcuts} className="py-3 rounded-xl bg-primary text-white font-bold disabled:opacity-60">保存快捷键</button>
                            </div>
                        </div>
                    )}

                    {activeTab === 'export' && (
                        <div className="bg-white rounded-2xl shadow-ios p-5 space-y-4">
                            <div>
                                <div className="font-bold">导出当前目录题库</div>
                                <div className="text-xs text-gray-400 mt-1">选择题库后导出 JSON、Markdown 或 CSV。</div>
                            </div>
                            {loadingBanks ? (
                                <div className="p-8 text-center text-gray-400">加载题库中...</div>
                            ) : banks.length ? banks.map((bank) => (
                                <div key={bank.id} className="rounded-2xl border border-gray-100 p-4 space-y-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="font-bold truncate">{bank.name}</div>
                                            <div className="text-xs text-gray-400 mt-1">{bank.question_count || 0} 道题 · 更新于 {formatDateTime(bank.updated_at)}</div>
                                        </div>
                                        <i className="fas fa-book text-primary"></i>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <button onClick={() => handleExport(bank, 'json')} disabled={Boolean(exportingKey)} className="py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm disabled:opacity-50">{exportingKey === `${bank.id}-json` ? '导出中' : 'JSON'}</button>
                                        <button onClick={() => handleExport(bank, 'markdown')} disabled={Boolean(exportingKey)} className="py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm disabled:opacity-50">{exportingKey === `${bank.id}-markdown` ? '导出中' : 'MD'}</button>
                                        <button onClick={() => handleExport(bank, 'csv')} disabled={Boolean(exportingKey)} className="py-2 rounded-xl bg-gray-100 text-gray-700 font-bold text-sm disabled:opacity-50">{exportingKey === `${bank.id}-csv` ? '导出中' : 'CSV'}</button>
                                    </div>
                                </div>
                            )) : (
                                <div className="p-8 text-center text-gray-400">当前目录暂无题库。</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const App = () => {
    const [user, setUser] = useState(null);
    const [view, setView] = useState('dashboard');
    const [currentFolderId, setCurrentFolderId] = useState(null);
    const [currentBank, setCurrentBank] = useState(null);
    const [currentBookmarkCollection, setCurrentBookmarkCollection] = useState(null);
    const [isBookmarkMode, setIsBookmarkMode] = useState(false);
    const [folderTree, setFolderTree] = useState([]);
    const [folderFlat, setFolderFlat] = useState([]);
    const [showTree, setShowTree] = useState(false);
    const [showRecycleBin, setShowRecycleBin] = useState(false);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [settingsState, setSettingsState] = useState({ show: false, section: 'profile' });

    const loadFolderTree = async () => {
        try {
            const data = await api.folders.tree();
            setFolderFlat(data.flat || []);
            setFolderTree(data.tree || []);
        } catch (error) {
            alert(error.message);
        }
    };

    useEffect(() => {
        api.auth.me()
            .then((session) => setUser({ name: session.username, isAdmin: Boolean(session.isAdmin) }))
            .catch(() => setUser(null));
    }, []);

    useEffect(() => {
        if (user) loadFolderTree();
    }, [user]);

    const currentFolderPath = useMemo(() => buildFolderPath(currentFolderId, folderFlat), [currentFolderId, folderFlat]);
    const currentFolder = currentFolderPath[currentFolderPath.length - 1] || null;

    if (!user) return <Auth onLogin={setUser} />;

    const handleBack = () => {
        if (view === 'quiz' || view === 'bookmarkManager') {
            setView('dashboard');
            setIsBookmarkMode(false);
            setCurrentBookmarkCollection(null);
            return;
        }

        if (currentFolder) {
            setCurrentFolderId(currentFolder.parent_id || null);
        }
    };

    const openSettings = (section = 'profile') => {
        setSettingsState({ show: true, section });
    };

    const handleLogout = async () => {
        if (!confirm('退出登录？')) return;
        try {
            await api.auth.logout();
        } catch (error) {}
        setSettingsState({ show: false, section: 'profile' });
        setUser(null);
    };

    const activeBookmarkCollectionId = currentBookmarkCollection ? currentBookmarkCollection.id : (currentBank ? currentBank.active_collection_id : '');
    const activeBookmarkCollectionName = currentBookmarkCollection ? currentBookmarkCollection.name : (currentBank ? currentBank.active_collection_name : '');

    const title = view === 'quiz'
        ? (isBookmarkMode ? `${currentBank.name} · ${activeBookmarkCollectionName || '收藏夹'}` : currentBank.name)
        : (view === 'bookmarkManager' && currentBank
            ? `${currentBank.name} · 管理收藏夹`
            : (currentFolder ? currentFolder.name : '我的资源库'));

    return (
        <div className="flex flex-col h-full bg-background">
            <div className="glass sticky top-0 z-50 pt-safe">
                <div className="h-14 px-4 flex items-center justify-between">
                    <div className="flex items-center gap-2 overflow-hidden flex-1">
                        {(currentFolder || view === 'quiz' || view === 'bookmarkManager') && <button onClick={handleBack} className="text-primary px-2 -ml-2"><i className="fas fa-chevron-left text-lg"></i></button>}
                        <h1 className="font-bold text-lg truncate">{title}</h1>
                    </div>
                    <div className="flex items-center gap-2">
                        {view === 'dashboard' && <button onClick={() => setShowRecycleBin(true)} className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center"><i className="fas fa-trash-can"></i></button>}
                        {view === 'dashboard' && <button onClick={() => setShowTree(true)} className="w-9 h-9 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center"><i className="fas fa-sitemap"></i></button>}
                        {user.isAdmin && <button onClick={() => setShowAdminPanel(true)} className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center"><i className="fas fa-shield-halved"></i></button>}
                        <button onClick={() => openSettings('profile')} className="w-9 h-9 bg-gray-200 rounded-full text-gray-500 flex items-center justify-center" title="个人设置"><i className="fas fa-user-gear"></i></button>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 pb-safe hide-scrollbar max-w-4xl mx-auto w-full">
                {view === 'dashboard' && (
                    <Dashboard
                        currentFolderId={currentFolderId}
                        currentFolderPath={currentFolderPath}
                        treeData={folderTree}
                        onStructureChange={loadFolderTree}
                        onOpenSettings={openSettings}
                        onNavigateFolder={(folderId) => setCurrentFolderId(folderId)}
                        onOpenBank={(bank, bookmarkMode, collection) => {
                            setCurrentBank(bank);
                            setCurrentBookmarkCollection(collection || {
                                id: bank.active_collection_id,
                                name: bank.active_collection_name || '当前收藏夹',
                            });
                            setIsBookmarkMode(bookmarkMode);
                            setView('quiz');
                        }}
                        onManageBookmarks={(bank) => {
                            setCurrentBank(bank);
                            setView('bookmarkManager');
                        }}
                    />
                )}
                {view === 'quiz' && currentBank && <Quiz
                    bank={currentBank}
                    isBookmarkMode={isBookmarkMode}
                    collectionId={activeBookmarkCollectionId}
                    collectionName={activeBookmarkCollectionName}
                    onOpenSettings={openSettings}
                />}
                {view === 'bookmarkManager' && currentBank && <BookmarkManager bank={currentBank} />}
            </div>

            <FolderTreeSheet
                show={showTree}
                folders={folderTree}
                currentFolderId={currentFolderId}
                onClose={() => setShowTree(false)}
                onSelect={(folderId) => setCurrentFolderId(folderId)}
            />

            <RecycleBinModal
                show={showRecycleBin}
                onClose={() => setShowRecycleBin(false)}
                onChanged={async () => { await loadFolderTree(); }}
            />

            <AdminPanelModal
                show={showAdminPanel}
                onClose={() => setShowAdminPanel(false)}
            />

            <PersonalSettingsModal
                show={settingsState.show}
                user={user}
                currentFolderId={currentFolderId}
                initialSection={settingsState.section}
                onClose={() => setSettingsState({ show: false, section: 'profile' })}
                onLogout={handleLogout}
            />
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
