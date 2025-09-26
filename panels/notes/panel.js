// 笔记收集面板 - panel.js

// DOM 元素
const noteInput = document.getElementById('note-input');
const addNoteBtn = document.getElementById('add-note-btn');
const notesContainer = document.getElementById('notes-container');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const searchResultsInfo = document.getElementById('search-results-info');
const noSearchResults = document.getElementById('no-search-results');

// 搜索状态
let currentSearchTerm = '';
let allNotes = [];

// 面板标识
const PANEL_NAME = 'notes';

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    loadNotes();
});

// 初始化事件监听
function initEvents() {
    // 输入框事件
    noteInput.addEventListener('input', handleInputChange);
    noteInput.addEventListener('keydown', handleKeyDown);
    
    // 搜索框事件
    searchInput.addEventListener('input', handleSearchChange);
    
    // 按钮点击事件
    addNoteBtn.addEventListener('click', addNote);
    
    // 初始禁用按钮
    updateAddButtonState();
}

// 处理输入变化
function handleInputChange() {
    updateAddButtonState();
    adjustTextareaHeight();
}

// 处理键盘事件
function handleKeyDown(e) {
    // 按下回车发送，按下Shift+回车换行
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addNote();
    }
}

// 更新添加按钮状态
function updateAddButtonState() {
    const trimmedText = noteInput.value.trim();
    addNoteBtn.disabled = trimmedText === '';
}

// 调整文本框高度
function adjustTextareaHeight() {
    noteInput.style.height = 'auto';
    const scrollHeight = noteInput.scrollHeight;
    const maxHeight = 120; // 最大高度
    noteInput.style.height = Math.min(scrollHeight, maxHeight) + 'px';
}

// 添加笔记
async function addNote() {
    const content = noteInput.value.trim();
    if (!content) return;
    
    const note = {
        panel: PANEL_NAME,
        taskId: '', // 笔记面板不需要任务号
        content: content,
        time: Date.now()
    };
    
    try {
        // 保存到数据库
        const result = await saveNoteToDB(note);
        if (result.ok) {
            // 清空输入框
            noteInput.value = '';
            updateAddButtonState();
            adjustTextareaHeight();
            
            // 重新加载笔记列表
            await loadNotes();
        } else {
            console.error('保存笔记失败:', result.error);
            alert('保存笔记失败，请重试');
        }
    } catch (error) {
        console.error('添加笔记错误:', error);
        alert('添加笔记失败，请重试');
    }
}

// 保存笔记到数据库
function saveNoteToDB(note) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'cache:addPost',
            panel: note.panel,
            taskId: note.taskId,
            content: note.content,
            time: note.time
        }, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                resolve(response || { ok: false, error: '未知错误' });
            }
        });
    });
}

// 加载笔记
async function loadNotes() {
    try {
        const result = await queryNotesFromDB();
        if (result.ok) {
            // 存储所有笔记
            allNotes = result.items;
            
            // 应用搜索过滤
            filterAndRenderNotes();
        } else {
            console.error('加载笔记失败:', result.error);
            showEmptyState();
        }
    } catch (error) {
        console.error('加载笔记错误:', error);
        showEmptyState();
    }
}

// 处理搜索输入变化
function handleSearchChange() {
    currentSearchTerm = searchInput.value.trim().toLowerCase();
    filterAndRenderNotes();
}

// 根据当前搜索词过滤并渲染笔记
function filterAndRenderNotes() {
    // 清空容器
    notesContainer.innerHTML = '';
    
    // 隐藏所有状态消息
    hideAllStates();
    
    if (!allNotes || allNotes.length === 0) {
        showEmptyState();
        return;
    }
    
    let filteredNotes = allNotes;
    
    // 如果有搜索词，则过滤笔记
    if (currentSearchTerm) {
        filteredNotes = allNotes.filter(note => 
            note.内容.toLowerCase().includes(currentSearchTerm)
        );
        
        // 显示搜索结果信息
        searchResultsInfo.textContent = `找到 ${filteredNotes.length} 条匹配的笔记（共 ${allNotes.length} 条）`;
        searchResultsInfo.style.display = 'block';
        
        if (filteredNotes.length === 0) {
            // 没有找到匹配的笔记
            notesContainer.appendChild(noSearchResults);
            noSearchResults.style.display = 'flex';
            return;
        }
    } else {
        // 没有搜索词，隐藏搜索结果信息
        searchResultsInfo.style.display = 'none';
    }
    
    // 按时间倒序排列（最新的在前面）
    const sortedNotes = [...filteredNotes].sort((a, b) => b.时间 - a.时间);
    
    // 创建并添加笔记卡片
    sortedNotes.forEach(note => {
        const card = createNoteCard(note);
        notesContainer.appendChild(card);
    });
}

// 隐藏所有状态消息
function hideAllStates() {
    emptyState.style.display = 'none';
    noSearchResults.style.display = 'none';
    
    // 确保状态元素存在于容器中
    if (!document.contains(emptyState)) {
        notesContainer.appendChild(emptyState);
    }
    
    if (!document.contains(noSearchResults)) {
        notesContainer.appendChild(noSearchResults);
    }
}

// 从数据库查询笔记
function queryNotesFromDB() {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'cache:queryByTime',
            panel: PANEL_NAME,
            limit: 100
        }, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                resolve(response || { ok: false, error: '未知错误' });
            }
        });
    });
}

// 渲染笔记列表（保留向后兼容性，内部调用新的过滤渲染函数）
function renderNotes(notes) {
    allNotes = notes;
    filterAndRenderNotes();
}

// 创建笔记卡片
function createNoteCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    contentDiv.textContent = note.内容;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'note-time';
    timeDiv.textContent = formatTime(note.时间);
    
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'note-actions';
    
    const editBtn = document.createElement('button');
    editBtn.className = 'action-btn';
    editBtn.textContent = '编辑';
    editBtn.addEventListener('click', () => editNote(note));
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-btn delete';
    deleteBtn.textContent = '删除';
    deleteBtn.addEventListener('click', () => deleteNote(note.id));
    
    actionsDiv.appendChild(editBtn);
    actionsDiv.appendChild(deleteBtn);
    
    card.appendChild(contentDiv);
    card.appendChild(timeDiv);
    card.appendChild(actionsDiv);
    
    return card;
}

// 编辑笔记
function editNote(note) {
    const newContent = prompt('编辑笔记内容:', note.内容);
    if (newContent === null) return; // 用户取消
    
    const trimmedContent = newContent.trim();
    if (trimmedContent === '') {
        alert('笔记内容不能为空');
        return;
    }
    
    // 更新数据库中的笔记
    updateNoteInDB(note.id, trimmedContent).then(() => {
        // 重新加载笔记列表
        loadNotes();
    }).catch(error => {
        console.error('更新笔记失败:', error);
        alert('更新笔记失败，请重试');
    });
}

// 更新数据库中的笔记
function updateNoteInDB(noteId, newContent) {
    // 注意：由于当前数据库实现不支持直接更新，我们采用删除再添加的方式
    return new Promise(async (resolve, reject) => {
        try {
            // 先删除原笔记
            await deleteNoteFromDB(noteId);
            
            // 再添加更新后的笔记
            const newNote = {
                panel: PANEL_NAME,
                taskId: '',
                content: newContent,
                time: Date.now() // 使用当前时间作为更新时间
            };
            
            const result = await saveNoteToDB(newNote);
            if (result.ok) {
                resolve();
            } else {
                reject(new Error(result.error));
            }
        } catch (error) {
            reject(error);
        }
    });
}

// 删除笔记
function deleteNote(noteId) {
    if (!confirm('确定要删除这条笔记吗？')) return;
    
    deleteNoteFromDB(noteId).then((result) => {
        if (result.ok) {
            // 重新加载笔记列表以应用搜索过滤
            loadNotes();
        } else {
            console.error('删除笔记失败:', result.error);
            alert('删除笔记失败，请重试');
        }
    }).catch(error => {
        console.error('删除笔记失败:', error);
        alert('删除笔记失败，请重试');
    });
}

// 从数据库删除笔记
function deleteNoteFromDB(noteId) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            type: 'cache:deletePost',
            id: noteId
        }, (response) => {
            if (chrome.runtime.lastError) {
                resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else {
                resolve(response || { ok: true });
            }
        });
    });
}

// 显示空状态
function showEmptyState() {
    // 如果已经存在空状态元素，则不重复添加
    if (document.contains(emptyState)) return;
    
    notesContainer.appendChild(emptyState);
}

// 格式化时间
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // 小于1分钟
    if (diff < 60000) {
        return '刚刚';
    }
    
    // 小于1小时
    if (diff < 3600000) {
        const minutes = Math.floor(diff / 60000);
        return `${minutes}分钟前`;
    }
    
    // 小于24小时
    if (diff < 86400000) {
        const hours = Math.floor(diff / 3600000);
        return `${hours}小时前`;
    }
    
    // 小于7天
    if (diff < 604800000) {
        const days = Math.floor(diff / 86400000);
        return `${days}天前`;
    }
    
    // 其他情况显示具体日期时间
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}