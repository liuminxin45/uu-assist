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
const mentionBtn = document.getElementById('mention-btn');
const tagMenu = document.getElementById('tag-menu');
const tagMenuSearch = document.getElementById('tag-menu-search');
const tagMenuList = document.getElementById('tag-menu-list');

// @引用功能相关元素
const mentionMenu = document.getElementById('mention-menu');
const mentionMenuList = document.getElementById('mention-menu-list');
const mentionMenuSearch = document.getElementById('mention-menu-search');
const mentionPopover = document.getElementById('mention-popover');
const mentionPopoverClose = document.getElementById('mention-popover-close');
const mentionPopoverMeta = document.getElementById('mention-popover-meta');
const mentionPopoverContent = document.getElementById('mention-popover-content');

// 标签相关状态
let allTags = []; // 所有存在的标签
let recentTags = []; // 近期使用的标签（最多保存20个）
let currentTagPrefix = ''; // 当前输入的标签前缀

// @引用相关状态
let currentMentionPrefix = ''; // 当前输入的@引用前缀
let currentMentionNoteId = null; // 当前引用的笔记ID

// 状态变量和元素引用
let searchButton = null; // 搜索按钮元素
let searchDropdown = null; // 搜索下拉框元素
let trashButton = null; // 回收站按钮元素
let currentSearchTerm = '';
let isDropdownMenuOpen = false; // 添加全局变量来跟踪子菜单状态
let currentEditNoteId = null; // 跟踪当前正在编辑的笔记ID
let isTrashView = false; // 是否处于回收站视图模式

// 笔记数据
let notes = [];
let trashNotes = []; // 回收站中的笔记

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
            chrome.storage.local.get(['notes_data', 'tags_data', 'trash_notes_data'], (result) => {
                if (result && result.notes_data) {
                    notes = result.notes_data;
                }
                if (result && result.tags_data) {
                    allTags = result.tags_data.allTags || [];
                    recentTags = result.tags_data.recentTags || [];
                }
                
                // 加载回收站数据
                if (result && result.trash_notes_data) {
                    trashNotes = result.trash_notes_data;
                }
                
                // 从所有笔记中提取标签，确保标签列表完整
                extractAllTagsFromNotes();
                
                // 清理超过30天的回收站笔记
                cleanupOldTrashNotes();
                
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
            
            // 加载回收站数据
            const savedTrashNotes = localStorage.getItem('trash_notes_data');
            if (savedTrashNotes) {
                trashNotes = JSON.parse(savedTrashNotes);
            }
            
            // 从所有笔记中提取标签，确保标签列表完整
            extractAllTagsFromNotes();
            
            // 清理超过30天的回收站笔记
            cleanupOldTrashNotes();
            
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

// 保存回收站数据到存储
function saveTrashNotesToStorage() {
    try {
        // 尝试保存到Chrome存储
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({ 'trash_notes_data': trashNotes });
        } else {
            // 如果没有Chrome API，保存到localStorage
            localStorage.setItem('trash_notes_data', JSON.stringify(trashNotes));
        }
    } catch (error) {
        console.error('保存回收站数据失败:', error);
    }
}

// 清理超过30天的回收站笔记
function cleanupOldTrashNotes() {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const remainingNotes = trashNotes.filter(note => note.trashTimestamp > thirtyDaysAgo);
    
    if (remainingNotes.length !== trashNotes.length) {
        trashNotes = remainingNotes;
        saveTrashNotesToStorage();
    }
}

// 显示@引用菜单
function showMentionMenu() {
    if (!mentionMenu || !mentionMenuSearch || !mentionMenuList) return;
    
    // 使用与标签菜单相同的定位逻辑
    const rect = noteInput.getBoundingClientRect();
    const containerRect = noteInput.parentElement.getBoundingClientRect();
    
    // 设置@引用菜单位置
    mentionMenu.style.top = (containerRect.bottom - rect.top) + 'px';
    mentionMenu.style.left = '0px';
    
    // 重置搜索框
    mentionMenuSearch.value = currentMentionPrefix;
    
    // 填充菜单
    populateMentionMenu();
    
    // 显示菜单
    mentionMenu.style.display = 'block';
    
    // 聚焦搜索框
    mentionMenuSearch.focus();
    
    // 添加键盘事件监听以处理ESC键
    document.addEventListener('keydown', handleEscKeyForMentionMenu);
}

// 隐藏@引用菜单
function hideMentionMenu() {
    if (!mentionMenu) return;
    mentionMenu.style.display = 'none';
    
    // 移除键盘事件监听
    document.removeEventListener('keydown', handleEscKeyForMentionMenu);
}

// 处理ESC键隐藏@引用菜单
function handleEscKeyForMentionMenu(e) {
    if (e.key === 'Escape') {
        // 删除输入框中的@符号
        if (noteInput && currentMentionPrefix !== null) {
            const value = noteInput.value;
            const cursorPosition = noteInput.selectionStart;
            const beforeCursor = value.substring(0, cursorPosition);
            
            // 找到最后一个@的位置
            const lastMentionIndex = beforeCursor.lastIndexOf('@');
            
            if (lastMentionIndex !== -1) {
                // 删除@符号及其后面的内容
                const newBeforeCursor = beforeCursor.substring(0, lastMentionIndex);
                const newValue = newBeforeCursor + value.substring(cursorPosition);
                
                // 更新输入值
                noteInput.value = newValue;
                
                // 移动光标到@符号之前的位置
                noteInput.setSelectionRange(lastMentionIndex, lastMentionIndex);
                
                // 触发输入事件以更新状态
                noteInput.dispatchEvent(new Event('input'));
            }
        }
        
        hideMentionMenu();
    }
}

// 过滤@引用菜单
function filterMentionMenu() {
    if (!mentionMenuSearch || !mentionMenuList) return;
    
    const searchTerm = mentionMenuSearch.value.toLowerCase();
    currentMentionPrefix = searchTerm;
    
    // 重新填充菜单以应用过滤
    populateMentionMenu();
}

// 显示toast提示
function showToast(message, x, y) {
    // 移除之前的toast
    const oldToast = document.getElementById('custom-toast');
    if (oldToast) {
        oldToast.remove();
    }
    
    // 创建toast元素
    const toast = document.createElement('div');
    toast.id = 'custom-toast';
    toast.style.position = 'fixed';
    toast.style.top = `${y + 10}px`;
    toast.style.left = `${x}px`;
    toast.style.maxWidth = '300px';
    toast.style.padding = '8px 12px';
    toast.style.backgroundColor = 'rgba(31, 41, 55, 0.95)';
    toast.style.color = 'white';
    toast.style.borderRadius = '6px';
    toast.style.zIndex = '10000';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.fontSize = '12px';
    toast.style.lineHeight = '1.4';
    toast.style.wordBreak = 'break-word';
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    toast.textContent = message;
    
    document.body.appendChild(toast);
    
    // 显示toast
    setTimeout(() => {
        toast.style.opacity = '1';
    }, 10);
    
    // 3秒后自动隐藏
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 200);
    }, 3000);
    
    return toast;
}

// 隐藏toast
function hideToast() {
    const toast = document.getElementById('custom-toast');
    if (toast) {
        toast.style.opacity = '0';
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 200);
    }
}

// 填充@引用菜单
function populateMentionMenu() {
    if (!mentionMenuList) return;
    
    // 清空菜单
    mentionMenuList.innerHTML = '';
    
    // 获取所有笔记并按创建时间排序（最新的在前）
    const sortedNotes = [...notes].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    // 应用过滤
    const filteredNotes = sortedNotes.filter(note => {
        // 如果没有搜索词，显示所有笔记
        if (!currentMentionPrefix) return true;
        
        // 检查笔记内容是否包含搜索词（不区分大小写）
        const content = (note.content || '').toLowerCase();
        return content.includes(currentMentionPrefix.toLowerCase());
    });
    
    // 添加过滤后的笔记到菜单
    filteredNotes.forEach(note => {
        const noteItem = document.createElement('div');
        noteItem.className = 'tag-menu-item';
        
        // 创建笔记内容预览
        const preview = document.createElement('div');
        preview.className = 'mention-preview';
        
        // 添加标题（如果内容不为空）
        if (note.content) {
            const title = document.createElement('div');
            title.className = 'mention-title';
            title.textContent = truncateText(note.content, 50);
            preview.appendChild(title);
        }
        

        
        noteItem.appendChild(preview);
        
        // 添加点击事件
        noteItem.addEventListener('click', () => {
            insertMentionAtCursor(note);
            hideMentionMenu();
        });
        
        // 添加鼠标悬浮事件以显示完整笔记内容
        noteItem.addEventListener('mouseenter', (e) => {
            if (note.content) {
                // 计算toast位置
                const rect = noteItem.getBoundingClientRect();
                const x = rect.left;
                const y = rect.bottom;
                
                // 显示toast
                showToast(note.content, x, y);
            }
        });
        
        noteItem.addEventListener('mouseleave', () => {
            hideToast();
        });
        
        mentionMenuList.appendChild(noteItem);
    });
    
    // 如果没有匹配的笔记，显示提示
    if (filteredNotes.length === 0) {
        const noResults = document.createElement('div');
        noResults.className = 'tag-menu-item tag-menu-item-disabled';
        noResults.textContent = '没有找到匹配的笔记';
        mentionMenuList.appendChild(noResults);
    }
}

// 在光标位置插入@引用
function insertMentionAtCursor(note) {
    const input = noteInput;
    const value = input.value;
    const cursorPosition = input.selectionStart;
    const beforeCursor = value.substring(0, cursorPosition);
    const afterCursor = value.substring(cursorPosition);
    
    // 找到@的位置
    const lastMentionIndex = beforeCursor.lastIndexOf('@');
    
    if (lastMentionIndex !== -1) {
        // 创建引用标记格式：@[笔记内容预览](笔记ID)
        const previewText = truncateText(note.content, 30);
        const mentionText = `@[${previewText}](${note.id})`;
        
        // 替换@及其后面的内容为引用标记
        const newBeforeCursor = beforeCursor.substring(0, lastMentionIndex) + mentionText;
        const newValue = newBeforeCursor + afterCursor;
        
        // 更新输入值
        input.value = newValue;
        
        // 移动光标到引用标记后面
        const newCursorPosition = newBeforeCursor.length;
        input.setSelectionRange(newCursorPosition, newCursorPosition);
        
        // 触发输入事件以更新状态
        input.dispatchEvent(new Event('input'));
        
        // 保存笔记以便后续引用查看
        currentMentionNoteId = note.id;
    }
}

// 处理@引用标签点击事件
function handleMentionClick(noteId) {
    // 查找被引用的笔记
    const mentionedNote = notes.find(note => note.id === noteId);
    
    if (mentionedNote) {
        // 显示引用弹窗
        showMentionPopover(mentionedNote);
    }
}

// 显示@引用弹窗
function showMentionPopover(note) {
    if (!mentionPopover || !mentionPopoverMeta || !mentionPopoverContent) return;
    
    // 使用卡片本身的时间，确保时间显示正确
    let formattedDate = '';
    
    // 尝试多种可能的时间字段
    if (note.time) {
        // 优先使用time字段
        formattedDate = note.time;
    } else if (note.timestamp && !isNaN(note.timestamp)) {
        // 如果有timestamp字段，格式化它
        formattedDate = formatTimeForInsight(note.timestamp);
    } else if (note.createdAt && !isNaN(note.createdAt)) {
        // 最后尝试createdAt字段
        formattedDate = formatTimeForInsight(note.createdAt);
    }
    
    // 简化显示格式，直接显示时间
    mentionPopoverMeta.textContent = formattedDate || '未知时间';
    
    // 格式化显示笔记内容
    mentionPopoverContent.innerHTML = '';
    
    // 创建内容元素
    const contentElement = document.createElement('div');
    contentElement.className = 'mention-popover-content-item';
    
    // 显示笔记文本内容
    if (note.content) {
        const textContent = document.createElement('p');
        textContent.className = 'mention-popover-text';
        textContent.textContent = note.content;
        contentElement.appendChild(textContent);
    }
    
    // 显示笔记中的图片（如果有）- 确保图片可以正常显示
    // 检查单个图片
    if (note.imageData) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'mention-popover-image-container';
        
        const image = document.createElement('img');
        image.className = 'mention-popover-image';
        image.alt = '笔记图片';
        image.style.cursor = 'pointer'; // 添加光标样式
        
        // 设置Base64图片数据
        image.src = note.imageData;
        
        // 添加图片加载错误处理
        image.onerror = function() {
            console.error('Failed to load image from imageData');
            this.alt = '无法加载图片';
            this.style.cursor = 'default'; // 加载失败时恢复默认光标
        };
        
        // 添加点击预览事件
        image.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡，避免关闭弹窗
            previewFullImage(note.imageData);
        });
        
        imageContainer.appendChild(image);
        contentElement.appendChild(imageContainer);
    }
    
    // 检查多个图片
    if (note.imagesData && note.imagesData.length > 0) {
        const imagesContainer = document.createElement('div');
        imagesContainer.className = 'mention-popover-images-grid';
        
        note.imagesData.forEach((imageData, index) => {
            const imageContainer = document.createElement('div');
            imageContainer.className = 'mention-popover-image-container';
            
            const image = document.createElement('img');
            image.className = 'mention-popover-image';
            image.alt = `笔记图片 ${index + 1}`;
            image.style.cursor = 'pointer'; // 添加光标样式
            
            // 设置Base64图片数据
            image.src = imageData;
            
            // 添加图片加载错误处理
            image.onerror = function() {
                console.error(`Failed to load image ${index + 1} from imagesData`);
                this.alt = `无法加载图片 ${index + 1}`;
                this.style.cursor = 'default'; // 加载失败时恢复默认光标
            };
            
            // 添加点击预览事件
            image.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止事件冒泡，避免关闭弹窗
                previewFullImage(imageData);
            });
            
            imageContainer.appendChild(image);
            imagesContainer.appendChild(imageContainer);
        });
        
        contentElement.appendChild(imagesContainer);
    }
    
    // 保持原有的imageUrl支持，以便兼容可能使用此格式的笔记
    if (note.imageUrl && !note.imageData && (!note.imagesData || note.imagesData.length === 0)) {
        const imageContainer = document.createElement('div');
        imageContainer.className = 'mention-popover-image-container';
        
        const image = document.createElement('img');
        image.className = 'mention-popover-image';
        image.alt = '笔记图片';
        image.style.cursor = 'pointer'; // 添加光标样式
        
        // 确保图片路径正确
        try {
            // 处理各种可能的图片路径格式
            if (note.imageUrl.startsWith('/')) {
                // 相对路径
                image.src = window.location.origin + note.imageUrl;
            } else if (note.imageUrl.startsWith('http://') || note.imageUrl.startsWith('https://')) {
                // 绝对URL
                image.src = note.imageUrl;
            } else {
                // 其他情况，尝试作为相对路径处理
                image.src = note.imageUrl;
            }
        } catch (error) {
            console.error('设置图片路径失败:', error);
        }
        
        // 添加图片加载错误处理
        image.onerror = function() {
            console.error('Failed to load image:', this.src);
            this.alt = '无法加载图片';
            this.style.cursor = 'default'; // 加载失败时恢复默认光标
        };
        
        // 添加点击预览事件
        image.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止事件冒泡，避免关闭弹窗
            previewFullImage(image.src);
        });
        
        imageContainer.appendChild(image);
        contentElement.appendChild(imageContainer);
    }
    
    mentionPopoverContent.appendChild(contentElement);
    
    // 显示弹窗
    mentionPopover.style.display = 'block';
    
    // 确保弹窗在屏幕可见位置
    positionMentionPopover();
}

// 隐藏@引用弹窗
function hideMentionPopover() {
    if (!mentionPopover) return;
    mentionPopover.style.display = 'none';
}

// 定位引用弹窗 - 确保水平、竖直居中
function positionMentionPopover() {
    if (!mentionPopover) return;
    
    // 清除可能干扰居中的定位属性
    mentionPopover.style.left = '';
    mentionPopover.style.top = '';
    mentionPopover.style.right = '';
    mentionPopover.style.bottom = '';
    mentionPopover.style.margin = '';
    
    // 确保应用了正确的CSS属性
    mentionPopover.style.display = 'flex';
    mentionPopover.style.alignItems = 'center';
    mentionPopover.style.justifyContent = 'center';
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
    
    // 添加ESC键关闭引用弹窗的功能
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mentionPopover && mentionPopover.style.display === 'block') {
            hideMentionPopover();
        }
    });

    if (addNoteBtn) {
        addNoteBtn.addEventListener('click', addNote);
        // 初始禁用按钮
        updateButtonState();
    }

    // 获取搜索和回收站按钮元素
    searchButton = document.getElementById('search-button');
    trashButton = document.getElementById('trash-button');
    
    // 添加一个函数来清空搜索框内容
    function clearSearchInput() {
        const input = document.getElementById('search-input');
        if (input) {
            input.value = '';
            // 重置搜索状态
            currentSearchTerm = '';
            // 重新渲染所有笔记
            renderNotes();
        }
    }
    
    // 搜索按钮事件监听
    if (searchButton) {
        searchButton.addEventListener('click', (e) => {
            e.stopPropagation(); // 阻止冒泡，避免触发document的点击事件
            
            // 获取搜索输入框
            const input = document.getElementById('search-input');
            if (input) {
                // 检查当前搜索按钮是否处于激活状态
                const isActive = searchButton.classList.contains('active');
                
                // 如果按钮未激活或搜索框隐藏，点击后显示并激活
                if (!isActive || input.style.display === 'none' || input.style.display === '') {
                    searchButton.classList.add('active');
                    input.style.display = 'block';
                    setTimeout(() => {
                        input.focus();
                    }, 10);
                } else {
                    // 如果按钮已激活且搜索框显示，点击后根据输入内容决定行为
                    // 如果输入框为空，隐藏搜索框并取消选中状态
                    if (!input.value.trim()) {
                        searchButton.classList.remove('active');
                        input.style.display = 'none';
                        clearSearchInput();
                    } else {
                        // 如果输入框有内容，保持搜索框显示和选中状态
                        // 不执行任何操作
                    }
                }
            }
        });
    }
    
    // 搜索输入框事件监听 - 重新获取元素确保正确绑定
    const searchInputElement = document.getElementById('search-input');
    if (searchInputElement) {
        searchInputElement.addEventListener('input', handleSearchChange);
        
        // 回车键处理 - 不自动清空搜索文本
        searchInputElement.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                
                // 如果输入框为空，隐藏搜索框并取消选中状态
                if (!searchInputElement.value.trim() && searchButton) {
                    searchButton.classList.remove('active');
                    searchInputElement.style.display = 'none';
                    clearSearchInput();
                }
                // 如果输入框有内容，保持搜索框显示和选中状态
                // 不执行任何隐藏操作
            }
        });
        
        // 失焦事件处理 - 确保显隐状态与选中状态一致
        searchInputElement.addEventListener('blur', () => {
            if (searchButton) {
                setTimeout(() => {
                    // 如果输入框为空，隐藏搜索框并取消选中状态
                    if (!searchInputElement.value.trim()) {
                        searchButton.classList.remove('active');
                        searchInputElement.style.display = 'none';
                        clearSearchInput();
                    } else {
                        // 如果输入框有内容，保持搜索框显示并保持选中状态
                        // 不执行任何隐藏操作
                    }
                }, 200); // 延迟执行，避免点击其他按钮时立即隐藏
            }
        });
        
        // 阻止搜索输入框的点击事件冒泡，避免点击输入框时关闭搜索
        searchInputElement.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // 回收站按钮事件监听
    if (trashButton) {
        trashButton.addEventListener('click', () => {
            // 切换回收站视图状态
            isTrashView = !isTrashView;
            
            // 更新按钮样式
            if (isTrashView) {
                trashButton.classList.add('active');
            } else {
                trashButton.classList.remove('active');
            }
            
            // 控制笔记输入框的显示和隐藏，保留搜索和回收站按钮
            const addNoteWrapper = document.querySelector('.add-note-wrapper');
            if (addNoteWrapper) {
                addNoteWrapper.style.display = isTrashView ? 'none' : 'block';
            }
            
            // 重新渲染笔记列表
            renderNotes();
        });
    }
    
    // 点击页面其他区域处理逻辑
    document.addEventListener('click', (e) => {
        const searchInput = document.getElementById('search-input');
        if (searchButton && !searchButton.contains(e.target) && 
            searchInput && !searchInput.contains(e.target)) {
            // 确保显隐状态与选中状态一致
            // 只有当输入框为空时才隐藏搜索框并取消选中状态
            if (!searchInput.value.trim()) {
                searchButton.classList.remove('active');
                searchInput.style.display = 'none';
                clearSearchInput();
            }
            // 输入框有内容时保持搜索框显示和搜索按钮的选中状态
        }
    });

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
        
        // 点击页面其他区域关闭@引用菜单
        if (!mentionMenu.contains(e.target) && e.target !== noteInput) {
            hideMentionMenu();
        }
    });
    
    // 阻止标签菜单内的点击事件冒泡
    if (tagMenu) {
        tagMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // @引用菜单搜索事件监听
    if (mentionMenuSearch) {
        mentionMenuSearch.addEventListener('input', filterMentionMenu);
    }
    
    // 阻止@引用菜单内的点击事件冒泡
    if (mentionMenu) {
        mentionMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    // @引用弹窗关闭事件
    if (mentionPopoverClose) {
        mentionPopoverClose.addEventListener('click', hideMentionPopover);
    }
    
    // 点击弹窗外部关闭@引用弹窗
    if (mentionPopover) {
        mentionPopover.addEventListener('click', (e) => {
            if (e.target === mentionPopover) {
                hideMentionPopover();
            }
        });
        
        // 阻止弹窗内容区域的点击事件冒泡
        const popoverContent = mentionPopover.querySelector('.ai-insight-modal-content');
        if (popoverContent) {
            popoverContent.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
    
    // 为笔记容器添加事件委托，处理标签点击和@引用点击
    if (notesContainer) {
        notesContainer.addEventListener('click', (e) => {
            // 处理#标签点击
            const tagElement = e.target.closest('.note-tag');
            if (tagElement) {
                e.preventDefault();
                e.stopPropagation();
                
                const tagName = tagElement.dataset.tag;
                const inputElement = document.getElementById('search-input');
                const searchBtn = document.getElementById('search-button');
                if (tagName && inputElement && searchBtn) {
                    // 设置搜索框的值
                    inputElement.value = '#' + tagName;
                    
                    // 设置搜索按钮为激活状态
                    searchBtn.classList.add('active');
                    
                    // 显示搜索输入框
                    inputElement.style.display = 'block';
                    
                    // 执行搜索筛选
                    handleSearchChange({target: inputElement});
                    
                    // 聚焦搜索框
                    setTimeout(() => {
                        inputElement.focus();
                    }, 10);
                }
            }
            
            // 处理@引用标签点击
            const mentionElement = e.target.closest('.mention-tag');
            if (mentionElement) {
                e.preventDefault();
                e.stopPropagation();
                
                const noteId = mentionElement.dataset.noteId;
                if (noteId) {
                    handleMentionClick(noteId);
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
  
  // 控制@引用按钮和#标签按钮的显示（设置为隐藏）
  if (tagBtn) {
    tagBtn.style.display = 'none';
  }
  
  if (mentionBtn) {
    mentionBtn.style.display = 'none';
  }
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
    // 在回收站视图中添加特殊样式
    if (isTrashView) {
        card.classList.add('trash-note');
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
    if (isTrashView && note.trashTimestamp) {
        timeDiv.textContent = `删除于: ${formatTime(note.trashTimestamp)}`;
        timeDiv.classList.add('trash-time');
    } else {
        timeDiv.textContent = formatTime(note.timestamp);
    }
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
    
    // 根据是否在回收站视图显示不同的菜单选项
    if (isTrashView) {
        // 回收站视图只显示恢复选项
        const restoreOption = document.createElement('div');
        restoreOption.className = 'menu-option';
        restoreOption.textContent = '恢复';
        restoreOption.addEventListener('click', () => {
            restoreNote(note.id);
            dropMenu.style.display = 'none';
        });
        dropMenu.appendChild(restoreOption);
    } else {
        // 正常视图显示完整菜单
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
        
        // 创建AI洞察选项
        const aiInsightOption = document.createElement('div');
        aiInsightOption.className = 'menu-option';
        aiInsightOption.textContent = '洞察';
        aiInsightOption.addEventListener('click', () => {
            // 显示AI洞察弹窗
            showAiInsightModal(note);
            dropMenu.style.display = 'none';
        });
        
        // 创建关联选项
        const relateOption = document.createElement('div');
        relateOption.className = 'menu-option';
        relateOption.textContent = '关联';
        relateOption.addEventListener('click', () => {
            // 显示关联报告弹窗
            showRelateReportModal(note);
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
        dropMenu.appendChild(aiInsightOption);
        dropMenu.appendChild(relateOption);
        dropMenu.appendChild(deleteOption);
    }
    
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

// AI洞察功能相关函数
function showAiInsightModal(currentNote) {
  // 获取弹窗元素
  const modal = document.getElementById('ai-insight-modal');
  const loading = document.getElementById('ai-insight-loading');
  const content = document.getElementById('ai-insight-content');
  const closeBtn = document.getElementById('close-ai-insight-modal');
  
  // 重置弹窗状态
  loading.style.display = 'block';
  content.style.display = 'none';
  content.textContent = '';
  
  // 显示弹窗
  modal.style.display = 'flex';
  
  // 关闭弹窗事件
  function closeModal() {
    modal.style.display = 'none';
  }
  
  closeBtn.onclick = closeModal;
  
  // 点击弹窗外部关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
  
  // 阻止事件冒泡
  modal.querySelector('.ai-insight-modal-content').onclick = (e) => {
    e.stopPropagation();
  };
  
  // 准备笔记数据
  const dataset = prepareInsightDataset(currentNote);
  
  // 调用AI获取洞察结果
  generateInsightWithAI(dataset).then(insightResult => {
    try {
      // 显示结果
      loading.style.display = 'none';
      content.style.display = 'block';
      content.textContent = insightResult;
    } catch (error) {
      console.error('处理AI结果失败:', error);
      content.textContent = '生成洞察时出错，请重试。';
      content.style.display = 'block';
      loading.style.display = 'none';
    }
  }).catch(error => {
    console.error('获取AI洞察失败:', error);
    // 显示用户要求的统一错误提示
    content.textContent = 'AI 调用 失败';
    content.style.display = 'block';
    loading.style.display = 'none';
  });
}

// 准备发送给AI的数据集
function prepareInsightDataset(currentNote) {
  // 构建当前卡片数据
  const nowCard = {
    content: currentNote.content || '',
    timestamp: currentNote.timestamp,
    date: formatTimeForInsight(currentNote.timestamp),
    hasImages: currentNote.hasImages || false
  };
  
  // 收集历史笔记（排除当前笔记且不包含图片base64）
  const historyNotes = notes.filter(note => note.id !== currentNote.id)
    .map(note => ({
      content: note.content || '',
      timestamp: note.timestamp,
      date: formatTimeForInsight(note.timestamp),
      hasImages: note.hasImages || false
    }))
    .sort((a, b) => b.timestamp - a.timestamp); // 按时间倒序排列
  
  return {
    now_card: nowCard,
    history_notes: historyNotes,
    total_count: notes.length
  };
}

// 格式化时间用于洞察显示
function formatTimeForInsight(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

// 加载AI配置
function loadAiCfg() {
  return new Promise(res => {
    try {
      // 检查扩展上下文是否有效
      if (chrome.runtime && chrome.runtime.id) {
        chrome.storage.local.get({ aiCfg: null }, got => res(got.aiCfg || null));
      } else {
        // 上下文无效，直接返回null
        res(null);
      }
    } catch (error) {
      // 捕获Extension context invalidated等错误
      console.warn('无法访问存储，扩展上下文可能已失效:', error);
      res(null);
    }
  });
}

// 生成AI洞察
async function generateInsightWithAI(dataset) {
  // 尝试调用真实AI API
  try {
    const aiCfg = await loadAiCfg();
    if (aiCfg && aiCfg.base && aiCfg.model && aiCfg.key) {
      const result = await callRealAIAPI(dataset, aiCfg);
      return result;
    }
    // 配置不完整
    throw new Error('AI配置不完整');
  } catch (error) {
    console.error('AI调用失败:', error);
    // AI调用失败时直接返回失败提示
    throw new Error('AI 调用 失败');
  }
}

// 调用真实AI API
async function callRealAIAPI(dataset, aiCfg) {
  const prompt = `你是一位清明克制的“洞察向导”。对象是笔记作者本人。不是给答案，而是在他的文字里扶一盏小灯：围绕【当前卡片】从历年笔记中看见2–3条长期脉络，点出各自的张力或突破口，用温和的追问与可验证的小步方向，促成更澄明的自我看见。（要有哲学性和引导性）
写作方式
 - 对话体，统一第二人称“你”。不标题、不列表、不编号，不要 Markdown。
 - 多段落、渐进式表达：4–6 段，每段 1–4 句。段与段之间必须有空行。全文 400–700 字。
 - 证据织入：把 1–3 个来自输入的日期或原话短语自然嵌入语句中（如“在 2025-01-15 你写到……”或用引号点亮原词），不要做清单。
 - 语气宁静，不评判；允许留白与停顿。多用“看见/体察/呼吸/试试看”等温和动词；可偶尔用类似公案的提问，但避免玄而又玄的空话。
 - 在文中分散提出 2–3 个开放式问题；给 1–2 个一两天内可验证的小步方向（邀请式，如“要不要先……看看会发生什么”）。
 - 只使用输入中的事实、日期、原词与标签；不得新增书名、概念或外部信息。拿不准用“可能/似乎/倾向于”。
段落节奏（描述给你，不要写出小标题或编号）
 1) 开场定锚：用当前卡片把当下心念落地，并点出时间跨度或最近一次关键记录。
 2) 脉络 A：说出一条长期线索的演进与当下张力，嵌入一个日期或原句，落到一个开放式追问。
 3) 脉络 B（可选脉络 C）：同上，但换一个维度（方法/动机/情绪/场域），避免重复措辞。
 4) 收束与下一步：提炼一个更高处的看见，给 1–2 个可验证的小步方向，以温和邀请收尾。
反模板（出现请自行改写后再输出）
 - 禁用套话：如“可以看到几个明显的脉络”“体现了清晰的演进”“建议你可以尝试”“形成呼应”“值得思考的问题”等。
 - 禁用命令式与感叹号；避免流水账复述与空洞总结。
材料不足时
 - 在第一段开头半句注明“材料有限，以下为保守观照”，其余要求不变。
输入
 - 将笔记数据（含时间、内容）作证据，不能虚构
输出
 - 仅一段落序列的自由中文文本，严格按“多段落、渐进式”写作。不要任何标题、列表、编号、标记或额外说明。
 - 若未满足段落数或字数上限，请自我重写直至满足。
`;
  
  // 准备历史笔记内容，最多使用10条最近的笔记
  const historyNotesText = dataset.history_notes
    .slice(0, 10)
    .map(note => `[${note.date}] ${note.content.substring(0, 200)}${note.content.length > 200 ? '...' : ''}`)
    .join('\n');
  
  // 构建完整的用户消息
  const userMessage = `当前卡片（${dataset.now_card.date}）：${dataset.now_card.content}\n\n历史笔记摘要：\n${historyNotesText}\n\n请按照要求生成个人知识洞察。`;
  
  const url = `${aiCfg.base.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: aiCfg.model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userMessage }
    ],
    temperature: 0.3,
    max_tokens: 1000,
    stream: false
  };
  
  // 添加日志：显示当前使用的AI配置
  console.log("[Notes AI Request] 使用的配置:", {
    base: aiCfg.base,
    model: aiCfg.model,
    key: aiCfg.key ? "[REDACTED]" : "未设置"
  });
  
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.key}` },
      body: JSON.stringify(body)
    });
    
    if (!resp.ok) {
      throw new Error(`API请求失败: ${resp.status}`);
    }
    
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const usage = data?.usage || {};
    
    // 添加日志：显示实际使用的模型和返回内容
    const usedModel = data?.model || aiCfg.model;
    console.log("[Notes AI Response] 实际使用的模型:", usedModel);
    console.log("[Notes AI Response] 返回内容:", text);
    
    return text || '';
  } catch (error) {
    console.error("[Notes AI Error]", error);
    throw error;
  }
}



// 格式化笔记内容，处理#标签和@引用，以及搜索文本高亮
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
    escapedContent = escapedContent.replace(/#([^\s]+)/g, '<span class="note-tag" data-tag="$1">#$1</span>');
    
    // 处理@引用标记，格式为@[笔记内容预览](笔记ID)
    // 使用data-note-id属性存储笔记ID
    escapedContent = escapedContent.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, 
        '<span class="mention-tag" data-note-id="$2">@[$1]</span>');
    
    // 如果有搜索词，添加搜索文本高亮（黄色背景）
    if (currentSearchTerm && currentSearchTerm.trim()) {
        // 转义搜索词中的特殊字符，避免影响正则表达式
        const escapedSearchTerm = currentSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 使用不区分大小写的正则表达式全局匹配
        const regex = new RegExp(`(${escapedSearchTerm})`, 'gi');
        // 将匹配的文本用黄色背景的span标签包裹
        escapedContent = escapedContent.replace(regex, '<span style="background-color: #FFF76A;">$1</span>');
    }
    
    return escapedContent;
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
    const inputElement = document.getElementById('search-input');
    if (inputElement) {
        inputElement.value = '#' + tagName;
        
        // 执行筛选
        handleSearchChange({target: inputElement});
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

// 关联报告功能相关函数
function showRelateReportModal(currentNote) {
  // 获取弹窗元素
  const modal = document.getElementById('relate-report-modal');
  const loading = document.getElementById('relate-report-loading');
  const content = document.getElementById('relate-report-content');
  const closeBtn = document.getElementById('close-relate-report-modal');
  
  // 重置弹窗状态
  loading.style.display = 'block';
  content.style.display = 'none';
  content.textContent = '';
  
  // 显示弹窗
  modal.style.display = 'flex';
  
  // 关闭弹窗事件
  function closeModal() {
    modal.style.display = 'none';
  }
  
  closeBtn.onclick = closeModal;
  
  // 点击弹窗外部关闭
  modal.onclick = (e) => {
    if (e.target === modal) {
      closeModal();
    }
  };
  
  // 阻止事件冒泡
  modal.querySelector('.ai-insight-modal-content').onclick = (e) => {
    e.stopPropagation();
  };
  
  // 准备笔记数据
  const prompt = prepareRelateReportPrompt(currentNote);
  
  // 调用AI获取关联报告结果
  generateRelateReportWithAI(prompt).then(reportResult => {
    try {
      // 显示结果
      loading.style.display = 'none';
      content.style.display = 'block';
      
      // 将Markdown转换为HTML并显示
      content.innerHTML = markdownToHtml(reportResult);
      
      // 为生成的链接添加点击事件
      const links = content.querySelectorAll('a');
      links.forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          const href = link.getAttribute('href');
          if (href && href.startsWith('app://note/')) {
            const noteId = href.replace('app://note/', '');
            handleMentionClick(noteId);
          } else if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            window.open(href, '_blank');
          }
        });
      });
    } catch (error) {
      console.error('处理AI结果失败:', error);
      content.innerHTML = '<div class="error-message">生成关联报告时出错，请重试。</div>';
      content.style.display = 'block';
      loading.style.display = 'none';
    }
  }).catch(error => {
    console.error('获取AI关联报告失败:', error);
    // 显示错误提示
    content.innerHTML = '<div class="error-message">AI 调用失败</div>';
    content.style.display = 'block';
    loading.style.display = 'none';
  });
}

// 准备关联报告的prompt
function prepareRelateReportPrompt(nowCard) {
  // 验证nowCard参数
  if (!nowCard || typeof nowCard !== 'object') {
    return '';
  }
  
  // 准备所有笔记数据
  const allNotes = notes.map(note => {
    if (!note || typeof note !== 'object') {
      return null;
    }
    return {
      id: note.id || '',
      date: formatTimeForInsight(note.timestamp),
      content: note.content || '',
      title: truncateText(note.content || '', 20)
    };
  }).filter(Boolean);
  
  // 验证数据
  if (!allNotes || !Array.isArray(allNotes)) {
    return '';
  }
  
  const nowCardTitle = truncateText(nowCard.content || '', 20);
  
  // 准备notes数据字符串
  let notesData = 'notes:\n';
  allNotes.forEach(note => {
    if (!note || typeof note !== 'object') {
      return;
    }
    notesData += `- id: ${note.id || ''}\n`;
    notesData += `  date: ${note.date || ''}\n`;
    notesData += `  title: ${note.title || ''}\n`;
    notesData += `  content: ${note.content || ''}\n\n`;
  });
  
  // 根据用户提供的模板构建prompt
  const prompt = `你是一位"关联编纂器+洞察向导"。任务：围绕【now_card】在notes中发现隐藏联系，发现其中隐藏的价值，生成可直接发布的「关联报告」。约束：仅使用输入数据；所有结论必须可追溯到notes片段与日期；摘录≤180字；报告总长≤900字。

请按以下要求生成报告：
1. 只使用段落区分内容，不要使用任何标题、列表、特殊格式标记（如#、*、-等）
2. 报告内容应包含对当前笔记与其他笔记的关联分析
3. 如需引用具体笔记，请使用[YYYY-MM-DD｜标题](app://note/{id})格式
4. 保持语言简洁清晰，使用中文，不写空话或不可验证内容

${notesData}

now_card:
- id: ${nowCard.id || ''}
- date: ${nowCard.timestamp ? formatTimeForInsight(nowCard.timestamp) : ''}
- title: ${nowCardTitle}
- content: ${truncateText(nowCard.content || '', 300)}`;
  
  return prompt;
}

// 生成关联报告
async function generateRelateReportWithAI(prompt) {
  // 尝试调用真实AI API
  try {
    const aiCfg = await loadAiCfg();
    if (aiCfg && aiCfg.base && aiCfg.model && aiCfg.key) {
      const result = await callRelateReportAIAPI(prompt, aiCfg);
      return result;
    }
    // 配置不完整
    throw new Error('AI配置不完整');
  } catch (error) {
    console.error('AI调用失败:', error);
    // AI调用失败时直接返回失败提示
    throw new Error('AI 调用 失败');
  }
}

// 调用AI API生成关联报告
async function callRelateReportAIAPI(prompt, aiCfg) {
  const url = `${aiCfg.base.replace(/\/+$/, '')}/chat/completions`;
  const body = {
    model: aiCfg.model,
    messages: [
      { role: "system", content: "你是一位'关联编纂器+洞察向导'。" },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 1500,
    stream: false
  };
  
  // 添加日志：显示当前使用的AI配置
  console.log("[Notes Relate AI Request] 使用的配置:", {
    base: aiCfg.base,
    model: aiCfg.model,
    key: aiCfg.key ? "[REDACTED]" : "未设置"
  });
  
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.key}` },
      body: JSON.stringify(body)
    });
    
    if (!resp.ok) {
      throw new Error(`API请求失败: ${resp.status}`);
    }
    
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const usage = data?.usage || {};
    
    // 添加日志：显示实际使用的模型和返回内容
    const usedModel = data?.model || aiCfg.model;
    console.log("[Notes Relate AI Response] 实际使用的模型:", usedModel);
    console.log("[Notes Relate AI Response] 返回内容:", text);
    
    return text || '';
  } catch (error) {
    console.error("[Notes Relate AI Error]", error);
    throw error;
  }
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
function handleSearchChange(e) {
    // 优先从事件对象中获取目标元素，如果没有则重新获取
    const inputElement = e?.target || document.getElementById('search-input');
    if (!inputElement) return;
    currentSearchTerm = inputElement.value.trim().toLowerCase();
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

// 删除笔记（移动到回收站）
function deleteNote(noteId) {
    // 从笔记列表中找到要删除的笔记
    const noteIndex = notes.findIndex(note => note.id === noteId);
    if (noteIndex !== -1) {
        // 获取要删除的笔记
        const noteToDelete = notes[noteIndex];
        
        // 为笔记添加回收站时间戳
        noteToDelete.trashTimestamp = Date.now();
        
        // 从笔记列表中移除
        notes.splice(noteIndex, 1);
        
        // 添加到回收站
        trashNotes.push(noteToDelete);
        
        // 保存到存储
        saveNotesToStorage();
        saveTrashNotesToStorage();
        
        // 重新渲染笔记列表
        renderNotes();
        
        // 显示提示
        showToast('笔记已移至回收站', 10, 10);
    }
}

// 恢复回收站中的笔记
function restoreNote(noteId) {
    // 从回收站中找到要恢复的笔记
    const noteIndex = trashNotes.findIndex(note => note.id === noteId);
    if (noteIndex !== -1) {
        // 获取要恢复的笔记
        const restoredNote = trashNotes[noteIndex];
        
        // 删除回收站时间戳
        delete restoredNote.trashTimestamp;
        
        // 将笔记添加回主列表
        notes.push(restoredNote);
        
        // 从回收站中移除
        trashNotes.splice(noteIndex, 1);
        
        // 保存到存储
        saveNotesToStorage();
        saveTrashNotesToStorage();
        
        // 重新渲染笔记列表
        renderNotes();
        
        // 显示提示
        showToast('笔记已恢复', 10, 10);
    }
}

// 渲染笔记列表
function renderNotes() {
    if (!notesContainer || !emptyState) return;
    
    // 清空容器
    notesContainer.innerHTML = '';
    
    // 确定当前要显示的笔记列表
    let currentNotes = isTrashView ? trashNotes : notes;
    
    if (currentNotes.length === 0) {
        showEmptyState();
        return;
    }
    
    // 隐藏空状态
    emptyState.style.display = 'none';
    
    let filteredNotes = currentNotes;
    
    // 如果有搜索词，则过滤笔记（适用于普通视图和回收站视图）
    if (currentSearchTerm) {
        filteredNotes = filteredNotes.filter(note => {
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
    
    // 排序：根据是否为回收站视图使用不同的排序逻辑
    if (isTrashView) {
        // 回收站视图：按回收站时间戳倒序排列（最新删除的在前）
        filteredNotes.sort((a, b) => b.trashTimestamp - a.trashTimestamp);
    } else {
        // 正常视图：按归档状态和时间排序
        filteredNotes.sort((a, b) => {
            // 首先按归档状态排序：非归档在前，归档在后
            if (a.isArchived !== b.isArchived) {
                return a.isArchived ? 1 : -1;
            }
            
            // 然后按时间戳倒序排列（最新的在前）
            return b.timestamp - a.timestamp;
        });
    }
    
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
    
    // 初始化时隐藏搜索输入框
    const searchInputElement = document.getElementById('search-input');
    const searchButtonElement = searchButton || document.querySelector('.search-button');
    if (searchInputElement && searchButtonElement) {
        searchInputElement.style.display = 'none';
        searchButtonElement.classList.remove('active');
    }
    
    // 初始化时确保笔记输入区域显示
    const inputSection = document.querySelector('.input-section');
    if (inputSection) {
        inputSection.style.display = 'block';
    }
    
    // 初始化时加载笔记
    loadNotesFromStorage();
    
    // @引用按钮事件监听
    if (mentionBtn) {
        mentionBtn.addEventListener('click', handleMentionButtonClick);
    }
}

// 处理标签按钮点击事件
function handleTagButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 先隐藏@引用菜单
    hideMentionMenu();
    
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

// 处理@引用按钮点击事件
function handleMentionButtonClick(e) {
    e.preventDefault();
    e.stopPropagation();
    
    // 先隐藏标签菜单
    hideTagMenu();
    
    // 获取光标位置
    const cursorPosition = noteInput.selectionStart;
    
    // 在光标位置插入 @
    const text = noteInput.value;
    const beforeCursor = text.substring(0, cursorPosition);
    const afterCursor = text.substring(cursorPosition);
    
    noteInput.value = beforeCursor + '@' + afterCursor;
    
    // 设置光标位置在 @ 后面
    noteInput.setSelectionRange(cursorPosition + 1, cursorPosition + 1);
    noteInput.focus();
    
    // 显示@引用菜单
    showMentionMenu();
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
    
    // 检查光标前是否有@符号
    const lastMentionIndex = beforeCursor.lastIndexOf('@');
    
    // 如果找到了@，并且@后面没有空格（即正在输入引用）
    if (lastMentionIndex !== -1) {
        const afterMention = beforeCursor.substring(lastMentionIndex + 1);
        if (afterMention.trim() === '') {
            // 显示引用菜单
            currentMentionPrefix = '';
            showMentionMenu();
        } else if (!/\s/.test(afterMention)) {
            // 更新当前引用前缀并过滤菜单
            currentMentionPrefix = afterMention;
            showMentionMenu();
            filterMentionMenu();
        } else {
            // 如果@后面有空格，关闭菜单
            hideMentionMenu();
        }
    } else {
        // 如果没有找到@，关闭菜单
        hideMentionMenu();
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

// Markdown转HTML的简单实现，用于关联报告的格式化显示
function markdownToHtml(markdown) {
    if (!markdown) return '';
    
    // 转义HTML特殊字符
    let html = markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    
    // 处理链接 [text](url)
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
    
    // 将连续换行符转换为段落分隔符
    const paragraphs = html.split(/\n\s*\n/).filter(p => p.trim());
    
    // 对每个段落添加适当的样式和换行处理
    const formattedParagraphs = paragraphs.map(paragraph => {
        // 将段落内的换行符转换为<br>
        const formattedText = paragraph.replace(/\n/g, '<br>');
        return `<p class="report-paragraph">${formattedText}</p>`;
    });
    
    // 为关联报告添加特殊样式
    const styledHtml = `
        <div class="relate-report">
            ${formattedParagraphs.join('')}
        </div>
    `;
    
    return styledHtml;
}