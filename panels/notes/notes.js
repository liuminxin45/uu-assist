// 笔记收集面板 - 不依赖Chrome API的版本

// DOM 元素
const noteInput = document.getElementById('note-input');
const addNoteBtn = document.getElementById('add-note-btn');
const notesContainer = document.getElementById('notes-container');
const emptyState = document.getElementById('empty-state');
const searchInput = document.getElementById('search-input');
const previewContainer = document.getElementById('image-preview-container');
const previewImage = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const fullscreenPreview = document.getElementById('fullscreen-preview');
const fullscreenImage = document.getElementById('fullscreen-image');

// 状态变量
let currentSearchTerm = '';

// 内存存储的笔记数据
let notes = [
    {
        id: 'note_1',
        content: '这是一条测试笔记',
        timestamp: Date.now() - 3600000,
        isImage: false
    },
    {
        id: 'note_2',
        content: '这是另一条测试笔记',
        timestamp: Date.now() - 1800000,
        isImage: false
    }
];

// 初始化应用
function initApp() {
    // 绑定事件
    if (noteInput) {
        noteInput.addEventListener('input', updateButtonState);
        noteInput.addEventListener('keydown', handleKeyDown);
        noteInput.addEventListener('paste', handlePaste);
        noteInput.addEventListener('dragover', handleDragOver);
        noteInput.addEventListener('drop', handleDrop);
    }
    
    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', addNote);
        // 初始禁用按钮
        updateButtonState();
    }
    
    if (removeImageBtn) {
        removeImageBtn.addEventListener('click', removeImagePreview);
    }

    if (searchInput) {
        searchInput.addEventListener('input', handleSearchChange);
    }

    if (fullscreenPreview) {
        fullscreenPreview.addEventListener('click', hideFullscreenPreview);
    }
    
    // 渲染笔记列表
    renderNotes();
}

// 初始化
document.addEventListener('DOMContentLoaded', initApp);

// 处理输入变化
function updateButtonState() {
    if (!noteInput || !addNoteBtn) return;
    const hasContent = noteInput.value.trim().length > 0 || noteInput.dataset.imageData;
    addNoteBtn.disabled = !hasContent;
}

// 处理键盘事件
function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addNote();
    }
}

// 调整文本框高度
function adjustTextareaHeight() {
    if (!noteInput) return;
    noteInput.style.height = 'auto';
    const scrollHeight = noteInput.scrollHeight;
    const maxHeight = 120;
    noteInput.style.height = Math.min(scrollHeight, maxHeight) + 'px';
}

// 处理粘贴事件
function handlePaste(e) {
    e.preventDefault(); // 阻止默认粘贴行为，避免显示base64文本
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            handleImageFile(file);
            break;
        }
    }
}

// 处理拖拽悬停
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    noteInput.style.borderColor = '#4A84FF';
}

// 处理拖拽离开
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    noteInput.style.borderColor = '';
}

// 处理拖拽释放
function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    noteInput.style.borderColor = '';
    
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.indexOf('image') !== -1) {
            handleImageFile(file);
        }
    }
}

// 处理图片文件
function handleImageFile(file) {
    const reader = new FileReader();
    reader.onload = function(event) {
        const imageData = event.target.result;
        noteInput.dataset.imageData = imageData; // 存储图片数据但不显示在输入框
        noteInput.value = '';
        showImagePreview(imageData);
        updateButtonState();
    };
    reader.readAsDataURL(file);
}

// 显示图片预览
function showImagePreview(imageData) {
    if (!previewContainer || !previewImage) return;
    previewImage.src = imageData;
    previewContainer.style.display = 'block';
}

// 移除图片预览
function removeImagePreview() {
    if (!noteInput || !previewContainer) return;
    noteInput.removeAttribute('data-image-data');
    previewContainer.style.display = 'none';
    updateButtonState();
}

// 添加笔记
function addNote() {
    if (!noteInput) return;
    
    let content = noteInput.value.trim();
    const imageData = noteInput.dataset.imageData;
    
    // 如果有图片数据，优先使用图片数据
    if (imageData) {
        content = imageData;
    }
    
    if (!content) return;
    
    // 创建新笔记
    const newNote = {
        id: `note_${Date.now()}`,
        content: content,
        timestamp: Date.now(),
        isImage: content.startsWith('data:image/')
    };
    
    // 添加到笔记列表
    notes.unshift(newNote);
    
    // 清空输入框和预览
    resetInput();
    
    // 重新渲染笔记列表
    renderNotes();
}

// 重置输入区域
function resetInput() {
    if (!noteInput || !previewContainer) return;
    noteInput.value = '';
    noteInput.removeAttribute('data-image-data');
    previewContainer.style.display = 'none';
    
    // 重置输入区域高度
    const inputWrapper = document.querySelector('.note-input-wrapper');
    if (inputWrapper) {
        inputWrapper.style.minHeight = 'auto';
    }
    
    updateButtonState();
    adjustTextareaHeight();
}

// 处理搜索输入变化
function handleSearchChange() {
    if (!searchInput) return;
    currentSearchTerm = searchInput.value.trim().toLowerCase();
    renderNotes();
}

// 渲染笔记列表
function renderNotes() {
    if (!notesContainer || !emptyState) return;
    
    // 清空容器
    notesContainer.innerHTML = '';
    
    if (notes.length === 0) {
        showEmptyState();
        return;
    }
    
    // 隐藏空状态
    emptyState.style.display = 'none';
    
    let filteredNotes = notes;
    
    // 如果有搜索词，则过滤笔记
    if (currentSearchTerm) {
        filteredNotes = notes.filter(note => 
            note.content.toLowerCase().includes(currentSearchTerm)
        );
        
        if (filteredNotes.length === 0) {
            showNoSearchResults();
            return;
        }
    }
    
    // 渲染每条笔记
    filteredNotes.forEach(note => {
        const card = createNoteCard(note);
        notesContainer.appendChild(card);
    });
}

// 创建笔记卡片
function createNoteCard(note) {
    const card = document.createElement('div');
    card.className = 'note-card';
    card.dataset.id = note.id;
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    
    // 检查内容是否为图片
    if (note.isImage) {
        // 如果是图片，创建img元素
        const img = document.createElement('img');
        img.src = note.content;
        img.className = 'note-image';
        img.alt = '笔记图片';
        img.onclick = () => previewFullImage(note.content);
        contentDiv.appendChild(img);
    } else {
        // 否则显示文本内容
        contentDiv.textContent = note.content;
    }
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'note-time';
    timeDiv.textContent = formatTime(note.timestamp);
    
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

// 预览全屏图片
function previewFullImage(imageData) {
    if (!fullscreenPreview || !fullscreenImage) return;
    fullscreenImage.src = imageData;
    fullscreenPreview.style.display = 'flex';
}

// 隐藏全屏预览
function hideFullscreenPreview() {
    if (!fullscreenPreview) return;
    fullscreenPreview.style.display = 'none';
}

// 编辑笔记
function editNote(note) {
    if (!noteInput) return;
    
    // 如果是图片笔记
    if (note.isImage) {
        // 显示图片预览
        noteInput.dataset.imageData = note.content;
        noteInput.value = '';
        showImagePreview(note.content);
    } else {
        // 填充文本内容
        noteInput.value = note.content;
    }
    
    // 更新按钮状态
    updateButtonState();
    adjustTextareaHeight();
    
    // 滚动到输入框
    noteInput.scrollIntoView({ behavior: 'smooth' });
    
    // 聚焦输入框
    noteInput.focus();
    
    // 删除旧笔记
    deleteNote(note.id);
}

// 删除笔记
function deleteNote(noteId) {
    // 从笔记列表中删除
    notes = notes.filter(note => note.id !== noteId);
    
    // 重新渲染笔记列表
    renderNotes();
}

// 显示空状态
function showEmptyState() {
    if (!notesContainer || !emptyState) return;
    notesContainer.innerHTML = '';
    emptyState.style.display = 'block';
}

// 显示无搜索结果状态
function showNoSearchResults() {
    if (!notesContainer) return;
    notesContainer.innerHTML = '';
    
    // 创建无搜索结果信息
    const noResultsMsg = document.createElement('div');
    noResultsMsg.className = 'no-results';
    noResultsMsg.innerHTML = `<p>没有找到包含 "${currentSearchTerm}" 的笔记</p>`;
    notesContainer.appendChild(noResultsMsg);
}

// 格式化时间
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffMins < 1) {
        return '刚刚';
    } else if (diffMins < 60) {
        return `${diffMins}分钟前`;
    } else if (diffHours < 24) {
        return `${diffHours}小时前`;
    } else if (diffDays < 7) {
        return `${diffDays}天前`;
    } else {
        const month = date.getMonth() + 1;
        const day = date.getDate();
        return `${month}月${day}日`;
    }
}