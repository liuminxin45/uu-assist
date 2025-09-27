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

// 笔记数据
let notes = [];

// 从存储中加载笔记数据
function loadNotesFromStorage() {
    try {
        // 尝试从Chrome存储加载数据
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get('notes_data', (result) => {
                if (result && result.notes_data) {
                    notes = result.notes_data;
                }
                renderNotes();
            });
        } else {
            // 如果没有Chrome API，尝试从localStorage加载
            const savedNotes = localStorage.getItem('notes_data');
            if (savedNotes) {
                notes = JSON.parse(savedNotes);
            }
            renderNotes();
        }
    } catch (error) {
        console.error('加载笔记数据失败:', error);
        renderNotes();
    }
}

// 保存笔记数据到存储
function saveNotesToStorage() {
    try {
        // 尝试保存到Chrome存储
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ 'notes_data': notes });
        } else {
            // 如果没有Chrome API，保存到localStorage
            localStorage.setItem('notes_data', JSON.stringify(notes));
        }
    } catch (error) {
        console.error('保存笔记数据失败:', error);
    }
}

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
    
    // 从存储中加载笔记数据
    loadNotesFromStorage();
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
    
    const textContent = noteInput.value.trim();
    const imageData = noteInput.dataset.imageData;
    
    // 如果没有内容，则不创建笔记
    if (!textContent && !imageData) return;
    
    // 创建新笔记对象
    const newNote = {
        id: `note_${Date.now()}`,
        timestamp: Date.now()
    };
    
    // 根据内容类型设置属性
    if (imageData && textContent) {
        // 如果同时有图片和文字，保存两种内容
        newNote.content = textContent;
        newNote.imageData = imageData;
        newNote.hasImage = true;
        newNote.isImage = false; // 不是纯图片笔记
    } else if (imageData) {
        // 如果只有图片
        newNote.content = imageData;
        newNote.isImage = true;
    } else {
        // 如果只有文字
        newNote.content = textContent;
        newNote.isImage = false;
    };
    
    // 添加到笔记列表
    notes.unshift(newNote);
    
    // 保存到存储
    saveNotesToStorage();
    
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
        filteredNotes = notes.filter(note => {
            // 对于同时有图片和文字的笔记，搜索文字部分
            if (note.hasImage && note.content) {
                return note.content.toLowerCase().includes(currentSearchTerm);
            }
            // 对于纯图片笔记，不进行搜索（因为图片数据是base64，搜索没有意义）
            else if (note.isImage) {
                return false;
            }
            // 对于纯文字笔记，搜索文字内容
            else {
                return note.content.toLowerCase().includes(currentSearchTerm);
            }
        });
        
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
    
    // 先创建时间元素，放在卡片最上方
    const timeDiv = document.createElement('div');
    timeDiv.className = 'note-time';
    timeDiv.textContent = formatTime(note.timestamp);
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    
    // 检查是否同时包含图片和文字
    if (note.hasImage && note.imageData) {
        // 先添加图片
        const img = document.createElement('img');
        img.src = note.imageData;
        img.className = 'note-image';
        img.alt = '笔记图片';
        img.onclick = () => previewFullImage(note.imageData);
        contentDiv.appendChild(img);
        
        // 再添加文字（如果有）
        if (note.content && note.content.trim()) {
            const textDiv = document.createElement('div');
            textDiv.className = 'note-text';
            // 处理#标签
            textDiv.innerHTML = formatNoteContent(note.content);
            contentDiv.appendChild(textDiv);
        }
    } else if (note.isImage) {
        // 如果只有图片，创建img元素
        const img = document.createElement('img');
        img.src = note.content;
        img.className = 'note-image';
        img.alt = '笔记图片';
        img.onclick = () => previewFullImage(note.content);
        contentDiv.appendChild(img);
    } else {
        // 如果只有文字，显示文本内容（带#标签处理）
        contentDiv.innerHTML = formatNoteContent(note.content);
    }
    
    // 创建右上角的更多按钮容器
    const moreMenuContainer = document.createElement('div');
    moreMenuContainer.className = 'more-menu-container';
    
    // 创建更多按钮
    const moreBtn = document.createElement('button');
    moreBtn.className = 'more-btn';
    moreBtn.textContent = '...';
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = moreBtn.nextElementSibling;
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });
    
    // 创建下拉菜单
    const dropMenu = document.createElement('div');
    dropMenu.className = 'drop-menu';
    dropMenu.style.display = 'none';
    
    // 创建编辑选项
    const editOption = document.createElement('div');
    editOption.className = 'menu-option';
    editOption.textContent = '编辑';
    editOption.addEventListener('click', () => {
        editNote(note);
        dropMenu.style.display = 'none';
    });
    
    // 创建删除选项
    const deleteOption = document.createElement('div');
    deleteOption.className = 'menu-option delete';
    deleteOption.textContent = '删除';
    deleteOption.addEventListener('click', () => {
        deleteNote(note.id);
        dropMenu.style.display = 'none';
    });
    
    // 组装下拉菜单
    dropMenu.appendChild(editOption);
    dropMenu.appendChild(deleteOption);
    
    // 将更多按钮和下拉菜单添加到容器
    moreMenuContainer.appendChild(moreBtn);
    moreMenuContainer.appendChild(dropMenu);
    
    // 调整元素顺序：时间 -> 内容 -> 更多菜单
    card.appendChild(timeDiv);
    card.appendChild(contentDiv);
    card.appendChild(moreMenuContainer);
    
    // 点击卡片其他区域关闭下拉菜单
    card.addEventListener('click', () => {
        dropMenu.style.display = 'none';
    });
    
    return card;
}

// 点击页面其他区域关闭所有下拉菜单
document.addEventListener('click', () => {
    const allDropMenus = document.querySelectorAll('.drop-menu');
    allDropMenus.forEach(menu => {
        menu.style.display = 'none';
    });
});

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
    
    // 先清空输入框和预览
    noteInput.value = '';
    noteInput.removeAttribute('data-image-data');
    previewContainer.style.display = 'none';
    
    // 检查是否同时包含图片和文字
    if (note.hasImage && note.imageData) {
        // 显示图片预览
        noteInput.dataset.imageData = note.imageData;
        showImagePreview(note.imageData);
        
        // 填充文本内容
        noteInput.value = note.content || '';
    } else if (note.isImage) {
        // 如果只有图片
        noteInput.dataset.imageData = note.content;
        showImagePreview(note.content);
    } else {
        // 如果只有文字
        noteInput.value = note.content || '';
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
    
    // 保存到存储
    saveNotesToStorage();
    
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

// 格式化时间 - 显示完整的日期和时间
function formatTime(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

// 格式化笔记内容，处理#标签
function formatNoteContent(content) {
    if (!content) return '';
    
    // 转义HTML特殊字符，避免XSS
    const escapeHtml = (text) => {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    };
    
    // 先转义，再替换#标签
    const escapedContent = escapeHtml(content);
    
    // 匹配#标签（#后面跟字母、数字、下划线）
    return escapedContent.replace(/#([a-zA-Z0-9_]+)/g, '<span class="note-tag" onclick="handleTagClick(event, \'$1\')">#$1</span>');
}

// 处理标签点击事件
function handleTagClick(event, tagName) {
    event.preventDefault();
    event.stopPropagation();
    // 这里可以实现点击标签后的逻辑，例如搜索该标签的所有笔记
    console.log('点击标签:', tagName);
    // 可以添加搜索功能，或者高亮显示该标签的所有笔记等
}