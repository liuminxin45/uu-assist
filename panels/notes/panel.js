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
const tagBtn = document.getElementById('tag-btn');
const tagMenu = document.getElementById('tag-menu');
const tagMenuSearch = document.getElementById('tag-menu-search');
const tagMenuList = document.getElementById('tag-menu-list');

// 标签相关状态
let allTags = []; // 所有存在的标签
let recentTags = []; // 近期使用的标签（最多保存20个）
let currentTagPrefix = ''; // 当前输入的标签前缀

// 状态变量
let currentSearchTerm = '';
let isDropdownMenuOpen = false; // 添加全局变量来跟踪子菜单状态
let currentEditNoteId = null; // 跟踪当前正在编辑的笔记ID

// 笔记数据
let notes = [];

// 从上下文菜单添加笔记的全局函数
window.addNoteFromContext = function(data) {
  try {
    console.log('从上下文菜单添加笔记:', data);
    
    // 重置输入区域
    resetInput();
    
    // 根据数据类型处理
    if (data.imageUrl) {
      // 处理图片
      fetchImageAsDataURL(data.imageUrl).then(base64Data => {
        if (base64Data) {
          // 设置图片数据
          noteInput.dataset.imagesData = JSON.stringify([base64Data]);
          showMultipleImagePreviews([base64Data]);
          
          // 设置文本内容（如果有）
          if (data.text) {
            noteInput.value = data.text;
          }
          
          // 保存来源信息
          if (data.url && data.title) {
            noteInput.dataset.sourceUrl = data.url;
            noteInput.dataset.sourceTitle = data.title;
          }
          
          // 更新按钮状态
          updateButtonState();
          
          // 延迟添加笔记，确保UI更新完成
          setTimeout(() => {
            addNote();
          }, 100);
        } else {
          console.error('无法获取图片数据');
        }
      }).catch(error => {
        console.error('处理图片失败:', error);
      });
    } else if (data.text) {
      // 只有文本
      noteInput.value = data.text;
      
      // 保存来源信息
      if (data.url && data.title) {
        noteInput.dataset.sourceUrl = data.url;
        noteInput.dataset.sourceTitle = data.title;
      }
      
      updateButtonState();
      
      // 延迟添加笔记
      setTimeout(() => {
        addNote();
      }, 100);
    }
  } catch (error) {
    console.error('添加笔记失败:', error);
  }
};

// 将图片URL转换为base64数据
function fetchImageAsDataURL(url) {
  return new Promise((resolve, reject) => {
    // 检查是否是data URL
    if (url.startsWith('data:image/')) {
      resolve(url);
      return;
    }
    
    // 对于普通URL，尝试获取图片
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 尝试解决跨域问题
    
    img.onload = function() {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        // 转换为base64
        const base64Data = canvas.toDataURL('image/png');
        resolve(base64Data);
      } catch (error) {
        console.error('Canvas绘制失败:', error);
        // 如果canvas失败，尝试使用原始URL（可能在某些情况下有效）
        resolve(url);
      }
    };
    
    img.onerror = function(error) {
      console.error('图片加载失败:', error);
      // 在加载失败时，尝试直接使用URL
      resolve(url);
    };
    
    // 设置图片源
    img.src = url;
  });
}

// 从存储中加载笔记数据
function loadNotesFromStorage() {
    try {
        // 尝试从Chrome存储加载数据
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get(['notes_data', 'tags_data'], (result) => {
                if (result && result.notes_data) {
                    notes = result.notes_data;
                }
                if (result && result.tags_data) {
                    allTags = result.tags_data.allTags || [];
                    recentTags = result.tags_data.recentTags || [];
                }
                
                // 从所有笔记中提取标签，确保标签列表完整
                extractAllTagsFromNotes();
                
                renderNotes();
            });
        } else {
            // 如果没有Chrome API，尝试从localStorage加载
            const savedNotes = localStorage.getItem('notes_data');
            if (savedNotes) {
                notes = JSON.parse(savedNotes);
            }
            
            const savedTags = localStorage.getItem('tags_data');
            if (savedTags) {
                const tagsData = JSON.parse(savedTags);
                allTags = tagsData.allTags || [];
                recentTags = tagsData.recentTags || [];
            }
            
            // 从所有笔记中提取标签，确保标签列表完整
            extractAllTagsFromNotes();
            
            renderNotes();
        }
    } catch (error) {
        console.error('加载笔记数据失败:', error);
        renderNotes();
    }
}

// 从所有笔记中提取标签并清理不再使用的标签
function extractAllTagsFromNotes() {
    const allNoteTags = [];
    
    notes.forEach(note => {
        if (note.content) {
            const tags = extractTagsFromText(note.content);
            allNoteTags.push(...tags);
        }
    });
    
    // 去重
    const uniqueTags = [...new Set(allNoteTags)];
    
    // 清理不再使用的标签
    allTags = uniqueTags;
    
    // 清理recentTags中不再使用的标签
    recentTags = recentTags.filter(tag => allTags.includes(tag));
    
    // 保存更新后的标签数据
    saveTagsToStorage();
}

// 保存标签数据到存储
function saveTagsToStorage() {
    try {
        const tagsData = {
            allTags: allTags,
            recentTags: recentTags
        };
        
        // 尝试保存到Chrome存储
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ 'tags_data': tagsData });
        } else {
            // 如果没有Chrome API，保存到localStorage
            localStorage.setItem('tags_data', JSON.stringify(tagsData));
        }
    } catch (error) {
        console.error('保存标签数据失败:', error);
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
        
        // 同时保存标签数据
        saveTagsToStorage();
    } catch (error) {
        console.error('保存笔记数据失败:', error);
    }
}

// 应用初始化
function initApp() {
    if (noteInput) {
        noteInput.addEventListener('input', updateButtonState);
        noteInput.addEventListener('keydown', handleKeyDown);
        noteInput.addEventListener('paste', handlePaste);
        noteInput.addEventListener('drop', handleDrop);
        noteInput.addEventListener('input', adjustTextareaHeight);
        noteInput.addEventListener('input', handleNoteInputChange);
        noteInput.addEventListener('blur', parseNoteTags);
    }

    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', addNote);
        // 初始禁用按钮
        updateButtonState();
    }

    if (searchInput) {
        searchInput.addEventListener('input', handleSearchChange);
    }

    if (fullscreenPreview) {
        fullscreenPreview.addEventListener('click', hideFullscreenPreview);
    }
    
    // 标签按钮事件监听
    if (tagBtn) {
        tagBtn.addEventListener('click', handleTagButtonClick);
    }
    
    // 标签菜单搜索事件监听
    if (tagMenuSearch) {
        tagMenuSearch.addEventListener('input', filterTagMenu);
    }
    
    // 点击页面其他区域关闭标签菜单
    document.addEventListener('click', (e) => {
        if (!tagBtn.contains(e.target) && !tagMenu.contains(e.target)) {
            hideTagMenu();
        }
    });
    
    // 阻止标签菜单内的点击事件冒泡
    if (tagMenu) {
        tagMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // 为笔记容器添加事件委托，处理标签点击
    if (notesContainer) {
        notesContainer.addEventListener('click', (e) => {
            const tagElement = e.target.closest('.note-tag');
            if (tagElement) {
                e.preventDefault();
                e.stopPropagation();
                
                const tagName = tagElement.dataset.tag;
                if (tagName && searchInput) {
                    searchInput.value = '#' + tagName;
                    handleSearchChange();
                }
            }
        });
    }
    
    // 初始化页面功能
    initializePage();
    
    // 检查是否有待处理的笔记数据
    checkPendingNoteData();
    
    // 监听来自service worker的消息
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.type === 'add-note-from-context') {
                if (message.data) {
                    window.addNoteFromContext(message.data);
                    sendResponse({ ok: true });
                } else {
                    sendResponse({ ok: false, error: '没有数据' });
                }
                return true; // 保持消息通道开放
            }
        });
    }
}

// 检查待处理的笔记数据
function checkPendingNoteData() {
    try {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.get('pending_note_data', (result) => {
                if (result && result.pending_note_data) {
                    const pendingData = result.pending_note_data;
                    console.log('找到待处理的笔记数据:', pendingData);
                    
                    // 清除待处理数据
                    chrome.storage.local.remove('pending_note_data');
                    
                    // 添加笔记
                    window.addNoteFromContext(pendingData);
                }
            });
        }
    } catch (error) {
        console.error('检查待处理笔记数据失败:', error);
    }
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
        hideTagMenu(); // 添加笔记后自动隐藏标签菜单
    } else if (e.key === 'Escape' && currentEditNoteId) {
        e.preventDefault();
        resetInput(); // 重置输入区域
        currentEditNoteId = null; // 清除编辑状态
        addNoteBtn.textContent = '添加笔记'; // 恢复按钮文字
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

function getImagesArray() {
  if (noteInput.dataset.imagesData) {
    try { return JSON.parse(noteInput.dataset.imagesData) || []; } catch { return []; }
  }
  if (noteInput.dataset.imageData) {
    // 旧单图字段转成数组并清理
    const arr = [noteInput.dataset.imageData];
    delete noteInput.dataset.imageData;
    noteInput.dataset.imagesData = JSON.stringify(arr);
    return arr;
  }
  return [];
}
function setImagesArray(arr) {
  if (!arr || arr.length === 0) {
    delete noteInput.dataset.imagesData;
    delete noteInput.dataset.imageData;
    previewContainer.style.display = 'none';
    updateButtonState();
    return;
  }
  noteInput.dataset.imagesData = JSON.stringify(arr);
  showMultipleImagePreviews(arr);
  updateButtonState();
}

// 处理粘贴事件
function handlePaste(e) {
  const cd = e.clipboardData || e.originalEvent?.clipboardData;
  if (!cd) return;

  const text = cd.getData('text/plain');
  const items = cd.items || [];

  // 收集图片
  const imgs = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') !== -1) {
      const f = items[i].getAsFile?.();
      if (f) imgs.push(f);
    }
  }

  if (imgs.length === 0) {
    // 纯文本或无图片，走默认
    return;
  }

  if (text && text.trim()) {
    // 同时有文本与图片：允许默认粘贴文本，同时异步处理图片，避免清空文本
    setTimeout(() => handleMultipleImages(imgs, /* append */ true), 0);
  } else {
    // 只有图片：阻止默认，避免插入奇怪占位，直接处理图片
    e.preventDefault();
    handleMultipleImages(imgs, /* append */ true);
  }
}

// 处理拖拽释放
function handleDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  noteInput.style.borderColor = '';

  const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.indexOf('image') !== -1);
  if (files.length > 0) {
    handleMultipleImages(files, /* append */ true);
  }
}

// 处理多个图片文件
function handleMultipleImages(files, append = true) {
  const readAll = files.map(f => new Promise(res => {
    const r = new FileReader();
    r.onload = ev => res(ev.target.result);
    r.readAsDataURL(f);
  }));

  Promise.all(readAll).then(newImgs => {
    let existing = [];
    if (noteInput.dataset.imagesData) {
      try { existing = JSON.parse(noteInput.dataset.imagesData) || []; } catch {}
    }
    if (noteInput.dataset.imageData) {
      existing.push(noteInput.dataset.imageData);
      delete noteInput.dataset.imageData;
    }

    const combined = append ? existing.concat(newImgs) : newImgs;
    const uniq = Array.from(new Set(combined));

    noteInput.dataset.imagesData = JSON.stringify(uniq);
    // 关键点：不触碰 noteInput.value，保留已输入文字
    showMultipleImagePreviews(uniq);
    updateButtonState();
    adjustTextareaHeight();
  });
}
// 显示多张图片预览
function showMultipleImagePreviews(imagesData) {
  if (!previewContainer) return;
  previewContainer.innerHTML = '';

  const grid = document.createElement('div');
  grid.className = 'image-preview-grid';
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(80px, 1fr))';
  grid.style.gap = '8px';
  grid.style.padding = '8px';

  imagesData.forEach((src, idx) => {
    const cell = document.createElement('div');
    cell.style.position = 'relative';
    cell.style.borderRadius = '6px';
    cell.style.overflow = 'hidden';
    cell.style.border = '1px solid #e5e7eb';

    const img = document.createElement('img');
    img.className = 'image-preview-input';
    img.src = src;
    img.alt = '预览';
    img.style.width = '100%';
    img.style.height = '80px';
    img.style.objectFit = 'cover';

    const del = document.createElement('button');
    del.type = 'button';
    del.title = '删除此图';
    del.style.position = 'absolute';
    del.style.top = '4px';
    del.style.right = '4px';
    del.style.width = '20px';
    del.style.height = '20px';
    del.style.border = 'none';
    del.style.borderRadius = '50%';
    del.style.background = 'rgba(255,255,255,.95)';
    del.style.color = '#EF4444';
    del.style.cursor = 'pointer';
    del.style.lineHeight = '1';
    del.textContent = '×';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      removeOneImage(idx);
    });

    cell.appendChild(img);
    cell.appendChild(del);
    grid.appendChild(cell);
  });

  previewContainer.appendChild(grid);
  previewContainer.style.display = imagesData.length ? 'block' : 'none';
}

// 新增：删除单张
function removeOneImage(index) {
  const arr = getImagesArray();
  if (index < 0 || index >= arr.length) return;
  arr.splice(index, 1);
  setImagesArray(arr);
}

// 更新按钮状态
function updateButtonState() {
  if (!noteInput || !addNoteBtn) return;
  const hasText = !!noteInput.value.trim();
  const hasSingle = !!noteInput.dataset.imageData;
  const hasMulti = !!noteInput.dataset.imagesData;
  addNoteBtn.disabled = !(hasText || hasSingle || hasMulti);
}

// 添加笔记
// 添加新笔记
function addNote() {
    if (!noteInput) return;
    
    const content = noteInput.value.trim();
    const imagesData = noteInput.dataset.imagesData ? JSON.parse(noteInput.dataset.imagesData) : null;
    const imageData = noteInput.dataset.imageData;
    
    // 获取来源信息
    const sourceUrl = noteInput.dataset.sourceUrl;
    const sourceTitle = noteInput.dataset.sourceTitle;
    
    console.log('添加笔记时的图片数据:', { imagesData, imageData });
    
    // 检查是否有内容或图片
    if (!content && !imagesData && !imageData) {
        return; // 没有内容不添加
    }
    
    const newNote = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        content: content,
        isArchived: false
    };
    
    // 设置图片相关属性
    if (imagesData && imagesData.length > 0) {
        newNote.imagesData = imagesData;
        newNote.isMultipleImages = true;
        newNote.hasImages = true;
        newNote.isImage = false;
    } else if (imageData) {
        newNote.imageData = imageData;
        newNote.hasImage = true;
        newNote.isImage = !content;
    } else {
        newNote.isImage = false;
        newNote.hasImage = false;
        newNote.isMultipleImages = false;
    }
    
    // 设置来源信息
    if (sourceUrl) {
        newNote.sourceUrl = sourceUrl;
        newNote.sourceTitle = sourceTitle;
    }
    
    // 清除来源信息，避免影响下一条笔记
    delete noteInput.dataset.sourceUrl;
    delete noteInput.dataset.sourceTitle;
    
    console.log('创建的新笔记:', newNote);
    
    // 如果是编辑模式，删除旧笔记
    if (currentEditNoteId) {
        // 找到旧笔记的索引
        const oldNoteIndex = notes.findIndex(note => note.id === currentEditNoteId);
        if (oldNoteIndex !== -1) {
            // 保留归档状态
            newNote.isArchived = notes[oldNoteIndex].isArchived;
            // 保留原始笔记的时间戳（创建时间）
            newNote.timestamp = notes[oldNoteIndex].timestamp;
            // 删除旧笔记
            notes.splice(oldNoteIndex, 1);
        }
    }
    
    // 添加到笔记列表
    notes.unshift(newNote);
    
    // 重新排序笔记（先显示未归档的，再显示归档的）
    notes.sort((a, b) => {
        if (a.isArchived && !b.isArchived) return 1;
        if (!a.isArchived && b.isArchived) return -1;
        return b.timestamp - a.timestamp;
    });
    
    // 保存到存储
    saveNotesToStorage();
    
    // 渲染笔记
    renderNotes();
    
    // 重置输入
    resetInput();
    
    // 清除编辑状态
    if (currentEditNoteId) {
        currentEditNoteId = null;
        addNoteBtn.textContent = '添加笔记';
    }
    
    // 提取并更新所有标签列表，确保新添加的标签能立即显示在标签列表中
    extractAllTagsFromNotes();
}

// 重置输入区域
function resetInput() {
    if (!noteInput || !previewContainer) return;
    noteInput.value = '';
    noteInput.removeAttribute('data-image-data');
    noteInput.removeAttribute('data-images-data');
    previewContainer.style.display = 'none';
    
    // 重置输入区域高度
    const inputWrapper = document.querySelector('.note-input-wrapper');
    if (inputWrapper) {
        inputWrapper.style.minHeight = 'auto';
    }
    
    updateButtonState();
    adjustTextareaHeight();
}

// 编辑笔记
function editNote(note) {
    if (!noteInput) return;
    
    // 保存原始笔记的ID和时间戳
    currentEditNoteId = note.id;
    
    // 先清空输入框和预览
    noteInput.value = '';
    noteInput.removeAttribute('data-image-data');
    noteInput.removeAttribute('data-images-data');
    previewContainer.style.display = 'none';
    
    // 检查是否包含多张图片
    if (note.isMultipleImages && note.imagesData) {
        noteInput.dataset.imagesData = JSON.stringify(note.imagesData);
        showMultipleImagePreviews(note.imagesData);
        noteInput.value = note.content || '';
    } 
    // 检查是否同时包含单张图片和文字
    else if (note.hasImage && note.imageData) {
        // 显示图片预览
        noteInput.dataset.imageData = note.imageData;
        showImagePreview(note.imageData);
        
        // 填充文本内容
        noteInput.value = note.content || '';
    } else if (note.isImage && !note.isMultipleImages) {
        // 如果只有单张图片
        noteInput.dataset.imageData = note.content;
        showImagePreview(note.content);
    } else {
        // 如果只有文字
        noteInput.value = note.content || '';
    }
    
    // 更新按钮状态
    updateButtonState();
    adjustTextareaHeight();
    
    // 将焦点设置到输入框
    if (noteInput) {
        noteInput.focus();
    }
    
    // 更改按钮文字
    addNoteBtn.textContent = '更新笔记';
}

// 创建笔记卡片
function createNoteCard(note) {
    if (!note) return null;
    
    console.log('渲染笔记卡片:', { id: note.id, isMultipleImages: note.isMultipleImages, imagesData: note.imagesData?.length });
    
    const card = document.createElement('div');
    card.className = 'note-card';
    
    if (note.isArchived) {
        card.classList.add('archived');
    }
    card.dataset.id = note.id;
    
    // 先创建时间元素和来源信息元素的容器
    const headerContainer = document.createElement('div');
    headerContainer.className = 'note-header';
    
    // 创建时间元素
    const timeDiv = document.createElement('div');
    timeDiv.className = 'note-time';
    if (note.isArchived) {
        timeDiv.classList.add('archived-text');
    }
    timeDiv.textContent = formatTime(note.timestamp);
    headerContainer.appendChild(timeDiv);
    
    // 创建来源信息元素（如果有来源信息）
    if (note.sourceUrl) {
        const sourceDiv = document.createElement('div');
        sourceDiv.className = 'note-source';
        
        // 获取域名和省略的标题
        const urlObj = new URL(note.sourceUrl);
        const domain = urlObj.hostname;
        const shortTitle = note.sourceTitle ? truncateText(note.sourceTitle, 15) : '未命名页面';
        
        // 创建favicon元素
        const faviconImg = document.createElement('img');
        faviconImg.className = 'source-favicon';
        faviconImg.src = `${urlObj.protocol}//${domain}/favicon.ico`;
        faviconImg.alt = 'favicon';
        faviconImg.onerror = function() {
            // 如果favicon加载失败，使用默认图标
            this.src = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Cpath fill=%22%239ca3af%22 d=%22M14.5 2.5a.5.5 0 01.5.5v10a.5.5 0 01-.5.5h-13a.5.5 0 01-.5-.5v-10a.5.5 0 01.5-.5h13zm-1 0h-11v10h11v-10zm-5 3a.5.5 0 00-.5.5v4a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-1zm-3 0a.5.5 0 00-.5.5v4a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-1zm6 0a.5.5 0 00-.5.5v4a.5.5 0 00.5.5h1a.5.5 0 00.5-.5v-4a.5.5 0 00-.5-.5h-1z%22/%3E%3C/svg%3E';
        };
        
        // 创建标题链接
        const titleLink = document.createElement('a');
        titleLink.className = 'source-title';
        titleLink.href = note.sourceUrl;
        titleLink.target = '_blank';
        titleLink.textContent = shortTitle;
        titleLink.title = `${note.sourceTitle || '未命名页面'}\n${note.sourceUrl}`;
        
        // 组装来源信息
        sourceDiv.appendChild(faviconImg);
        sourceDiv.appendChild(titleLink);
        
        headerContainer.appendChild(sourceDiv);
    }
    
    // 创建内容区域
    const contentDiv = document.createElement('div');
    contentDiv.className = 'note-content';
    if (note.isArchived) {
        contentDiv.classList.add('archived-text');
    }
    
    // 根据笔记类型设置内容
    if (note.isMultipleImages && note.imagesData) {
        console.log('渲染多张图片笔记，图片数量:', note.imagesData.length);
        // 如果是多张图片笔记
        if (note.content) {
            // 先添加文字内容
            const textDiv = document.createElement('div');
            if (note.isArchived) {
                textDiv.classList.add('archived-text');
            }
            textDiv.innerHTML = formatNoteContent(note.content);
            contentDiv.appendChild(textDiv);
        }
        
        // 创建图片网格
        const imageGrid = document.createElement('div');
        imageGrid.className = 'note-image-grid';
        
        note.imagesData.forEach((imageData, index) => {
            console.log('添加图片到网格:', index, imageData.substring(0, 30) + '...');
            const img = document.createElement('img');
            img.className = 'note-image';
            img.src = imageData;
            img.alt = '笔记图片';
            img.addEventListener('click', () => previewFullImage(imageData));
            imageGrid.appendChild(img);
        });
        
        contentDiv.appendChild(imageGrid);
    } else if (note.isImage && !note.isMultipleImages) {
        // 如果是单张图片笔记
        const img = document.createElement('img');
        img.className = 'note-image';
        img.src = note.content;
        img.alt = '笔记图片';
        img.addEventListener('click', () => previewFullImage(note.content));
        contentDiv.appendChild(img);
    } else if (note.hasImage && note.imageData) {
        // 如果是同时包含单张图片和文字的笔记
        // 先添加文字内容
        const textDiv = document.createElement('div');
        if (note.isArchived) {
            textDiv.classList.add('archived-text');
        }
        textDiv.innerHTML = formatNoteContent(note.content);
        contentDiv.appendChild(textDiv);
        
        // 再添加图片
        const img = document.createElement('img');
        img.className = 'note-image';
        img.src = note.imageData;
        img.alt = '笔记图片';
        img.addEventListener('click', () => previewFullImage(note.imageData));
        contentDiv.appendChild(img);
    } else {
        // 如果是纯文字笔记
        contentDiv.innerHTML = formatNoteContent(note.content);
    }
    
    // 创建更多菜单容器
    const moreMenuContainer = document.createElement('div');
    moreMenuContainer.className = 'more-menu-container';
    
    // 创建更多按钮
    const moreBtn = document.createElement('div');
    moreBtn.className = 'more-btn';
    moreBtn.textContent = '...';
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const menu = moreBtn.nextElementSibling;
        const isOpen = menu.style.display === 'block';
        
        // 先关闭所有其他下拉菜单
        const allDropMenus = document.querySelectorAll('.drop-menu');
        allDropMenus.forEach(m => {
            m.style.display = 'none';
        });
        
        if (isOpen) {
            // 关闭当前菜单
            menu.style.display = 'none';
            isDropdownMenuOpen = false;
            if (notesContainer) {
                notesContainer.classList.remove('menu-open');
            }
        } else {
            // 打开当前菜单
            menu.style.display = 'block';
            isDropdownMenuOpen = true;
            if (notesContainer) {
                notesContainer.classList.add('menu-open');
            }
        }
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
    
    // 创建归档选项
    const archiveOption = document.createElement('div');
    archiveOption.className = 'menu-option';
    archiveOption.textContent = note.isArchived ? '取消归档' : '归档';
    archiveOption.addEventListener('click', () => {
        archiveNote(note.id, !note.isArchived);
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
    dropMenu.appendChild(archiveOption);
    dropMenu.appendChild(deleteOption);
    
    // 将更多按钮和下拉菜单添加到容器
    moreMenuContainer.appendChild(moreBtn);
    moreMenuContainer.appendChild(dropMenu);
    
    // 调整元素顺序：头部(时间+来源) -> 内容 -> 更多菜单
    card.appendChild(headerContainer);
    card.appendChild(contentDiv);
    card.appendChild(moreMenuContainer);
    
    // 点击卡片其他区域关闭下拉菜单
    card.addEventListener('click', () => {
        dropMenu.style.display = 'none';
    });
    
    return card;
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
    
    // 先转义
    let escapedContent = escapeHtml(content);
    
    // 将换行符转换为<br>标签
    escapedContent = escapedContent.replace(/\n/g, '<br>');
    
    // 再替换#标签（#后面跟任意非空白字符，符合要求）
    // 使用data-tag属性而不是内联onclick，避免CSP限制
    return escapedContent.replace(/#([^\s]+)/g, '<span class="note-tag" data-tag="$1">#$1</span>');
}

// 截断文本，添加省略号
function truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {
        return text;
    }
    return text.substring(0, maxLength) + '...';
}

// 处理标签点击事件
function handleTagClick(event, tagName) {
    event.preventDefault();
    event.stopPropagation();
    
    // 将标签写入搜索框
    if (searchInput) {
        searchInput.value = '#' + tagName;
        
        // 执行筛选
        handleSearchChange();
    }
}

// 预览全屏图片
// 显示图片预览（单张图片）
function showImagePreview(imageData) {
  const arr = getImagesArray();
  arr.push(imageData);
  setImagesArray(Array.from(new Set(arr))); // 去重
}

// 移除图片预览
function removeImagePreview() {
    if (!noteInput || !previewContainer) return;
    noteInput.removeAttribute('data-image-data');
    noteInput.removeAttribute('data-images-data');
    previewContainer.style.display = 'none';
    updateButtonState();
}

// 全屏预览图片
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

// 处理搜索变化
function handleSearchChange() {
    if (!searchInput) return;
    currentSearchTerm = searchInput.value.trim().toLowerCase();
    renderNotes();
}

// 归档/取消归档笔记
function archiveNote(noteId, isArchived) {
    const noteIndex = notes.findIndex(note => note.id === noteId);
    if (noteIndex !== -1) {
        // 更新笔记的归档状态
        notes[noteIndex].isArchived = isArchived;
        
        // 保存到存储
        saveNotesToStorage();
        
        // 重新渲染笔记列表
        renderNotes();
    }
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
    
    // 按归档状态和时间排序：非归档笔记在前，归档笔记在后，均按时间倒序排列
    filteredNotes.sort((a, b) => {
        // 首先按归档状态排序：非归档在前，归档在后
        if (a.isArchived !== b.isArchived) {
            return a.isArchived ? 1 : -1;
        }
        
        // 然后按时间戳倒序排列（最新的在前）
        // 直接使用时间戳进行比较，确保排序的稳定性和准确性
        return b.timestamp - a.timestamp;
    });
    
    // 渲染每条笔记
    filteredNotes.forEach(note => {
        const card = createNoteCard(note);
        notesContainer.appendChild(card);
    });
}

// 点击页面其他区域关闭所有下拉菜单
function setupDropdownMenuHandlers() {
    document.addEventListener('click', () => {
        const allDropMenus = document.querySelectorAll('.drop-menu');
        allDropMenus.forEach(menu => {
            menu.style.display = 'none';
        });

        // 更新子菜单状态
        isDropdownMenuOpen = false;

        // 移除菜单打开状态的类
        if (notesContainer) {
            notesContainer.classList.remove('menu-open');
        }
    });
}

// 初始化页面功能
function initializePage() {
    // 设置下拉菜单处理
    setupDropdownMenuHandlers();
    
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

    // 设置拖拽相关事件监听
    noteInput.addEventListener('dragover', handleDragOver);
    noteInput.addEventListener('dragleave', handleDragLeave);
    
    // 初始化时加载笔记
    loadNotesFromStorage();
}

// 处理标签按钮点击事件
function handleTagButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 获取光标位置
    const cursorPosition = noteInput.selectionStart;
    
    // 在光标位置插入 #
    const text = noteInput.value;
    const beforeCursor = text.substring(0, cursorPosition);
    const afterCursor = text.substring(cursorPosition);
    
    noteInput.value = beforeCursor + '#' + afterCursor;
    
    // 设置光标位置在 # 后面
    noteInput.setSelectionRange(cursorPosition + 1, cursorPosition + 1);
    noteInput.focus();
    
    // 显示标签菜单
    showTagMenu();
}

// 显示标签菜单
function showTagMenu() {
    if (!tagMenu) return;
    
    // 填充标签菜单
    populateTagMenu();
    
    // 更新标签菜单位置
    updateTagMenuPosition();
    
    // 显示标签菜单
    tagMenu.style.display = 'block';
    
    // 清空搜索框
    if (tagMenuSearch) {
        tagMenuSearch.value = '';
    }
}

// 隐藏标签菜单
function hideTagMenu() {
    if (!tagMenu) return;
    tagMenu.style.display = 'none';
}

// 更新标签菜单位置
function updateTagMenuPosition() {
    if (!tagMenu || !noteInput) return;
    
    // 获取输入框位置信息
    const rect = noteInput.getBoundingClientRect();
    const containerRect = noteInput.parentElement.getBoundingClientRect();
    
    // 设置标签菜单位置
    tagMenu.style.top = (containerRect.bottom - rect.top) + 'px';
    tagMenu.style.left = '0px';
}

// 填充标签菜单
function populateTagMenu() {
    if (!tagMenuList) return;
    
    // 清空标签菜单
    tagMenuList.innerHTML = '';
    
    // 按近期使用优先排序标签
    const sortedTags = [...new Set([...recentTags, ...allTags.filter(tag => !recentTags.includes(tag))])];
    
    // 如果没有标签，显示提示信息
    if (sortedTags.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'tag-menu-item';
        emptyItem.style.color = '#9ca3af';
        emptyItem.textContent = '暂无标签';
        tagMenuList.appendChild(emptyItem);
        return;
    }
    
    // 添加标签项
    sortedTags.forEach(tag => {
        const item = document.createElement('div');
        item.className = 'tag-menu-item';
        item.style.position = 'relative';
        
        const tagElement = document.createElement('span');
        tagElement.className = 'tag-menu-item-tag';
        tagElement.textContent = '#' + tag;
        
        // 创建删除按钮
        const deleteBtn = document.createElement('span');
        deleteBtn.className = 'tag-menu-item-delete';
        deleteBtn.textContent = '✕';
        deleteBtn.style.position = 'absolute';
        deleteBtn.style.right = '8px';
        deleteBtn.style.opacity = '0';
        deleteBtn.style.color = '#ef4444';
        deleteBtn.style.fontSize = '12px';
        deleteBtn.style.cursor = 'pointer';
        deleteBtn.style.transition = 'opacity 0.2s ease';
        deleteBtn.style.padding = '2px 4px';
        deleteBtn.style.borderRadius = '2px';
        deleteBtn.style.background = 'rgba(239, 68, 68, 0.1)';
        
        // 添加悬浮显示删除按钮的效果
        item.addEventListener('mouseenter', () => {
            deleteBtn.style.opacity = '1';
        });
        
        item.addEventListener('mouseleave', () => {
            deleteBtn.style.opacity = '0';
        });
        
        // 删除按钮点击事件
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡
            
            // 显示确认对话框
            if (confirm(`此操作将删除所有使用了标签 "#${tag}" 的笔记，确定要继续吗？`)) {
                // 删除所有包含该标签的笔记
                deleteNotesByTag(tag);
                // 从标签列表中移除该标签
                removeTagFromLists(tag);
                // 重新填充标签菜单
                populateTagMenu();
                // 重新渲染笔记列表
                renderNotes();
            }
        });
        
        item.appendChild(tagElement);
        item.appendChild(deleteBtn);
        
        item.addEventListener('click', () => {
            insertTagAtCursor(tag);
            hideTagMenu();
        });
        
        tagMenuList.appendChild(item);
    });
}

// 根据标签删除笔记
function deleteNotesByTag(tag) {
    // 找出所有包含该标签的笔记
    const notesWithTag = notes.filter(note => {
        if (!note.content) return false;
        // 检查笔记内容中是否包含该标签
        return note.content.includes(`#${tag}`);
    });
    
    // 从笔记列表中删除这些笔记
    notes = notes.filter(note => !notesWithTag.some(n => n.id === note.id));
    
    // 保存更新后的笔记列表
    saveNotesToStorage();
}

// 从标签列表中移除指定标签
function removeTagFromLists(tag) {
    // 从所有标签列表中移除
    allTags = allTags.filter(t => t !== tag);
    
    // 从近期使用的标签列表中移除
    recentTags = recentTags.filter(t => t !== tag);
    
    // 保存更新后的标签数据
    saveTagsToStorage();
}

// 过滤标签菜单
function filterTagMenu() {
    if (!tagMenuSearch || !tagMenuList) return;
    
    const searchTerm = tagMenuSearch.value.toLowerCase();
    const items = tagMenuList.querySelectorAll('.tag-menu-item');
    
    items.forEach(item => {
        const tagText = item.querySelector('.tag-menu-item-tag')?.textContent || '';
        const shouldShow = tagText.toLowerCase().includes(searchTerm);
        item.style.display = shouldShow ? 'flex' : 'none';
    });
}

// 在光标位置插入标签
function insertTagAtCursor(tagName) {
    if (!noteInput) return;
    
    // 获取光标位置
    const cursorPosition = noteInput.selectionStart;
    
    // 获取当前文本
    const text = noteInput.value;
    
    // 查找光标前的 # 位置
    let hashPosition = -1;
    for (let i = cursorPosition - 1; i >= 0; i--) {
        if (text[i] === '#') {
            hashPosition = i;
            break;
        }
        if (text[i] === ' ' || text[i] === '\n' || text[i] === '\t') {
            break;
        }
    }
    
    // 如果找到了 #，替换从 # 开始到光标位置的文本
    let newText, newCursorPosition;
    if (hashPosition !== -1) {
        const beforeHash = text.substring(0, hashPosition);
        const afterCursor = text.substring(cursorPosition);
        newText = beforeHash + '#' + tagName + ' ' + afterCursor;
        newCursorPosition = hashPosition + tagName.length + 2; // +2 for # and space
    } else {
        // 如果没有找到 #，在光标位置插入标签
        const beforeCursor = text.substring(0, cursorPosition);
        const afterCursor = text.substring(cursorPosition);
        newText = beforeCursor + '#' + tagName + ' ' + afterCursor;
        newCursorPosition = cursorPosition + tagName.length + 2; // +2 for # and space
    }
    
    // 更新输入框内容
    noteInput.value = newText;
    
    // 设置光标位置
    noteInput.setSelectionRange(newCursorPosition, newCursorPosition);
    noteInput.focus();
    
    // 更新按钮状态
    updateButtonState();
    
    // 更新标签列表和使用记录
    updateAllTags([tagName]);
    updateRecentTags(tagName);
}

// 处理笔记输入变化
function handleNoteInputChange() {
    const input = noteInput;
    const value = input.value;
    const cursorPosition = input.selectionStart;
    
    // 检查光标前是否有#符号
    const beforeCursor = value.substring(0, cursorPosition);
    const lastHashIndex = beforeCursor.lastIndexOf('#');
    
    // 如果找到了#，并且#后面没有空格（即正在输入标签）
    if (lastHashIndex !== -1) {
        const afterHash = beforeCursor.substring(lastHashIndex + 1);
        if (afterHash.trim() === '') {
            // 显示标签菜单
            currentTagPrefix = '';
            showTagMenu();
        } else if (!/\s/.test(afterHash)) {
            // 更新当前标签前缀并过滤菜单
            currentTagPrefix = afterHash;
            showTagMenu();
            filterTagMenu();
        } else {
            // 如果#后面有空格，关闭菜单
            hideTagMenu();
        }
    } else {
        // 如果没有找到#，关闭菜单
        hideTagMenu();
    }
}

// 解析笔记中的标签
function parseNoteTags() {
    if (!noteInput) return;
    
    const text = noteInput.value;
    const tags = extractTagsFromText(text);
    
    // 更新所有标签列表
    updateAllTags(tags);
}

// 从文本中提取标签
function extractTagsFromText(text) {
    const tags = [];
    const tagRegex = /#([^\s\n\t]+)/g;
    let match;
    
    while ((match = tagRegex.exec(text)) !== null) {
        tags.push(match[1]);
    }
    
    // 去重
    return [...new Set(tags)];
}

// 更新所有标签列表
function updateAllTags(newTags) {
    if (!newTags || newTags.length === 0) return;
    
    // 将新标签添加到所有标签列表中
    newTags.forEach(tag => {
        if (!allTags.includes(tag)) {
            allTags.push(tag);
        }
    });
    
    // 保存标签数据
    saveTagsToStorage();
}

// 更新近期使用的标签
function updateRecentTags(tagName) {
    // 移除已存在的相同标签
    const index = recentTags.indexOf(tagName);
    if (index !== -1) {
        recentTags.splice(index, 1);
    }
    
    // 添加到开头
    recentTags.unshift(tagName);
    
    // 限制最多保存20个标签
    if (recentTags.length > 20) {
        recentTags = recentTags.slice(0, 20);
    }
    
    // 保存标签数据
    saveTagsToStorage();
}