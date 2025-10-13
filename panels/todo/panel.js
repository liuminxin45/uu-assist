// panel.js - Todo面板功能实现
const PANEL_NAME = "todo-panel";

// DOM 元素
const todoInput = document.getElementById('todo-input');
const addTodoBtn = document.getElementById('add-todo-btn');
const todoLists = document.getElementById('todo-lists');
const todoCount = document.getElementById('todo-count');
const completedCount = document.getElementById('completed-count');
const todoSearchInput = document.getElementById('todo-search-input'); // 新增：搜索框

// 模态框元素
const todoModal = document.getElementById('todo-modal');
const editTodoContent = document.getElementById('edit-todo-content');
const editTodoDate = document.getElementById('edit-todo-date');
const editTodoPriority = document.getElementById('edit-todo-priority');
const editTodoTags = document.getElementById('edit-todo-tags');
const editTodoNote = document.getElementById('edit-todo-note');
const saveTodoBtn = document.getElementById('save-todo-btn');
const cancelTodoBtn = document.getElementById('cancel-todo-btn');
const modalClose = document.querySelector('.modal-close');
const notePlaceholder = document.querySelector('.note-placeholder');
const noteHint = document.querySelector('.note-hint');

// 状态变量
let todos = [];
let currentEditTodoId = null;
let currentView = 'todo'; // 当前显示的视图 - 'todo' 或 'completed'
let currentSearchTerm = ''; // 新增：当前搜索词
let currentFilterType = ''; // 'tag', 'priority', or 'search'

// 初始化
function init() {
  loadTodos();
  renderTodos();
  setupEventListeners();
  setupModal();
}

// 加载待办事项
function loadTodos() {
  try {
    // 检查是否在Chrome扩展环境中
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.get('todos', (result) => {
        todos = result.todos || [];
        renderTodos();
      });
    } else {
      // 使用localStorage作为备选
      const savedTodos = localStorage.getItem('todos');
      todos = savedTodos ? JSON.parse(savedTodos) : [];
      renderTodos();
    }
  } catch (error) {
    console.error('加载待办事项失败:', error);
    todos = [];
  }
}

// 保存待办事项
function saveTodos() {
  try {
    // 检查是否在Chrome扩展环境中
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ todos: todos });
    } else {
      // 使用localStorage作为备选
      localStorage.setItem('todos', JSON.stringify(todos));
    }
  } catch (error) {
    console.error('保存待办事项失败:', error);
  }
}

// 生成唯一ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// 添加新的待办事项
function addTodo(content, status = 'todo', dueDate = '', priority = 'medium', tags = [], subTasks = [], note = '') {
  // 确保状态只能是todo或completed
  if (status !== 'todo' && status !== 'completed') {
    status = 'todo';
  }
  
  const todo = {
    id: generateId(),
    content: content.trim(),
    status: status,
    createdDate: new Date().toISOString(),
    dueDate: dueDate,
    priority: priority,
    tags: tags,
    subTasks: subTasks, // 子任务数组
    note: note
  };
  
  todos.push(todo);
  saveTodos();
  renderTodos();
}

// 更新待办事项
function updateTodo(id, updates) {
  const index = todos.findIndex(todo => todo.id === id);
  if (index !== -1) {
    todos[index] = { ...todos[index], ...updates };
    saveTodos();
    renderTodos();
  }
}

// 删除待办事项
function deleteTodo(id) {
  todos = todos.filter(todo => todo.id !== id);
  saveTodos();
  renderTodos();
}

// 更改待办事项状态
function changeTodoStatus(id, newStatus) {
  // 确保状态只能是todo或completed
  if (newStatus !== 'todo' && newStatus !== 'completed') {
    newStatus = 'todo';
  }
  updateTodo(id, { status: newStatus });
}

// 切换待办事项完成状态
function toggleTodoComplete(id) {
  const todo = todos.find(todo => todo.id === id);
  if (todo) {
    const newStatus = todo.status === 'completed' ? 'todo' : 'completed';
    updateTodo(id, { status: newStatus });
  }
}



// 渲染待办事项
function renderTodos() {
  // 清空所有列表
  document.getElementById('todo-items').innerHTML = '';
  document.getElementById('completed-items').innerHTML = '';
  
  // 按状态分类
  const todosByStatus = {
    'todo': [],
    'completed': []
  };
  
  // 过滤待办事项
  todos.forEach(todo => {
    // 搜索过滤
    if (currentSearchTerm) {
      const searchLower = currentSearchTerm.toLowerCase();
      // 优先级文本映射
      const priorityTextMap = {
        'high': '高',
        'medium': '中',
        'low': '低'
      };
      
      let matchesSearch = false;
      
      // 根据筛选类型决定匹配方式
      switch(currentFilterType) {
        case 'tag':
          // 标签筛选 - 只匹配标签
          matchesSearch = todo.tags && todo.tags.some(tag => tag.toLowerCase() === searchLower);
          break;
        case 'priority':
          // 优先级筛选 - 只匹配优先级
          matchesSearch = priorityTextMap[todo.priority] && priorityTextMap[todo.priority].includes(currentSearchTerm);
          break;
        case 'search':
        default:
          // 普通搜索 - 匹配内容、标签和优先级
          matchesSearch = 
            todo.content.toLowerCase().includes(searchLower) ||
            (todo.tags && todo.tags.some(tag => tag.toLowerCase().includes(searchLower))) ||
            (priorityTextMap[todo.priority] && priorityTextMap[todo.priority].toLowerCase().includes(searchLower));
      }
      
      if (!matchesSearch) {
        return; // 不匹配搜索词，跳过该项
      }
    }
    
    // 如果是in-progress状态，我们将其视为todo状态
    if (todo.status === 'in-progress') {
      todosByStatus['todo']?.push(todo);
    } else {
      todosByStatus[todo.status]?.push(todo);
    }
  });
  
  // 更新计数
  todoCount.textContent = todosByStatus['todo'].length;
  completedCount.textContent = todosByStatus['completed'].length;
  
  // 更新列表标题
  document.querySelector('.todo-list[data-status="todo"] .todo-list-title').textContent = '待办';
  document.querySelector('.todo-list[data-status="completed"] .todo-list-title').textContent = '已完成';
  
  // 只渲染当前视图的待办事项
  const container = document.getElementById(`${currentView}-items`);
  todosByStatus[currentView].forEach(todo => {
    const todoElement = createTodoElement(todo);
    container.appendChild(todoElement);
  });
  
  // 控制列表的显示和隐藏
  document.querySelectorAll('.todo-list').forEach(list => {
    list.style.display = list.dataset.status === currentView ? 'flex' : 'none';
  });
  
  // 检查当前视图是否为空
  const currentViewEmpty = todosByStatus[currentView].length === 0;
  if (currentViewEmpty) {
    showEmptyState();
  } else {
    hideEmptyState();
  }
}

// 创建待办事项元素
function createTodoElement(todo) {
  const todoItem = document.createElement('div');
  todoItem.className = 'todo-item';
  todoItem.dataset.id = todo.id;
  
  // 复选框
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'todo-checkbox';
  checkbox.checked = todo.status === 'completed';
  checkbox.addEventListener('change', () => toggleTodoComplete(todo.id));
  
  // 内容容器
  const contentContainer = document.createElement('div');
  contentContainer.className = 'todo-content' + (todo.status === 'completed' ? ' completed' : '');
  
  // 内容文本
  const contentText = document.createElement('div');
  contentText.textContent = todo.content;
  
  // 优先级标签
  const priorityTag = document.createElement('span');
  priorityTag.className = 'todo-item-priority ' + todo.priority;
  
  // 显示所有优先级（高、中、低）
  if (todo.priority === 'high') {
    priorityTag.textContent = '高';
  } else if (todo.priority === 'medium') {
    priorityTag.textContent = '中';
  } else {
    priorityTag.textContent = '低';
  }
  
  // 为优先级标签添加点击事件，实现点击优先级筛选功能
  priorityTag.addEventListener('click', (e) => {
    e.stopPropagation(); // 阻止事件冒泡，避免触发其他事件
    todoSearchInput.value = priorityTag.textContent;
    currentSearchTerm = priorityTag.textContent;
    currentFilterType = 'priority'; // 设置为优先级筛选模式
    renderTodos();
  });
  
  contentText.appendChild(priorityTag);
  
  // 先添加任务名称到容器
  contentContainer.appendChild(contentText);
  
  // 截止日期
  if (todo.dueDate) {
    const dueDate = document.createElement('div');
    dueDate.className = 'todo-item-due-date';
    dueDate.textContent = '截止: ' + formatDate(todo.dueDate);
    
    // 检查是否逾期
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(todo.dueDate) < today && todo.status !== 'completed') {
      dueDate.style.color = 'var(--error)';
      dueDate.style.fontWeight = 'bold';
    }
    
    contentContainer.appendChild(dueDate);
  }
  
  // 标签
  if (todo.tags && todo.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'todo-item-tags';
    
    todo.tags.forEach(tag => {
      const tagElement = document.createElement('span');
      tagElement.className = 'todo-item-tag';
      tagElement.textContent = tag;
      
      // 为标签添加点击事件，实现点击标签筛选功能
      tagElement.addEventListener('click', (e) => {
        e.stopPropagation(); // 阻止事件冒泡，避免触发其他事件
        todoSearchInput.value = tag;
        currentSearchTerm = tag;
        currentFilterType = 'tag'; // 设置为标签筛选模式
        renderTodos();
      });
      
      tagsContainer.appendChild(tagElement);
    });
    
    contentContainer.appendChild(tagsContainer);
  }
  
  // 子任务
  if (todo.subTasks && todo.subTasks.length > 0) {
    const subTasksContainer = document.createElement('div');
    subTasksContainer.className = 'todo-sub-tasks';
    
    // 计算完成的子任务数量（内部使用）
    const completedSubTasks = todo.subTasks.filter(st => st.completed).length;
    
    // 子任务列表
    const subTasksList = document.createElement('div');
    subTasksList.className = 'sub-tasks-list';
    
    todo.subTasks.forEach(subTask => {
      const subTaskElement = document.createElement('div');
      subTaskElement.className = 'sub-task-item' + (subTask.completed ? ' completed' : '');
      
      const subTaskCheckbox = document.createElement('input');
      subTaskCheckbox.type = 'checkbox';
      subTaskCheckbox.className = 'sub-task-checkbox';
      subTaskCheckbox.checked = subTask.completed;
      subTaskCheckbox.addEventListener('change', () => {
        updateSubTaskCompletion(todo.id, subTask.id, subTaskCheckbox.checked);
      });
      
      const subTaskContent = document.createElement('span');
      subTaskContent.textContent = subTask.content;
      
      subTaskElement.appendChild(subTaskCheckbox);
      subTaskElement.appendChild(subTaskContent);
      subTasksList.appendChild(subTaskElement);
    });
    
    subTasksContainer.appendChild(subTasksList);
    contentContainer.appendChild(subTasksContainer);
  }
  
  // 附件图标（如果有备注内容）
  if (todo.note && todo.note.trim()) {
    const attachmentIcon = document.createElement('div');
    attachmentIcon.className = 'todo-attachment-icon';
    attachmentIcon.title = '有备注内容';
    contentContainer.appendChild(attachmentIcon);
  }
  
  // 删除按钮
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'todo-delete-btn';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTodo(todo.id);
  });
  
  // 添加点击事件以编辑待办事项
  todoItem.addEventListener('click', (e) => {
    if (!e.target.closest('.todo-checkbox') && !e.target.closest('.todo-delete-btn') && 
        !e.target.closest('.sub-task-checkbox')) {
      openEditModal(todo.id);
    }
  });
  
  todoItem.appendChild(checkbox);
  todoItem.appendChild(contentContainer);
  todoItem.appendChild(deleteBtn);
  
  return todoItem;
}

// 更新子任务完成状态
function updateSubTaskCompletion(todoId, subTaskId, completed) {
  const todo = todos.find(t => t.id === todoId);
  if (todo && todo.subTasks) {
    const subTask = todo.subTasks.find(st => st.id === subTaskId);
    if (subTask) {
      subTask.completed = completed;
      saveTodos();
      renderTodos();
    }
  }
}

// 显示空状态
function showEmptyState() {
  // 检查是否已经存在空状态元素
  let emptyState = document.querySelector('.empty-state');
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    
    // 根据当前视图设置不同的空状态消息和图标
    const emptyStateIcon = currentView === 'todo' ? '📝' : '✅';
    const emptyStateMessage = currentView === 'todo' 
      ? '暂无待办事项' 
      : '暂无已完成事项';
    const emptyStateSubMessage = currentView === 'todo' 
      ? '点击上方输入框添加新的待办事项' 
      : '完成的待办事项会显示在这里';
    
    emptyState.innerHTML = `
      <div class="empty-state-icon">${emptyStateIcon}</div>
      <div>${emptyStateMessage}</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: var(--space-sm);">${emptyStateSubMessage}</div>
    `;
  } else {
    // 更新现有空状态的消息和图标
    const emptyStateIcon = currentView === 'todo' ? '📝' : '✅';
    const emptyStateMessage = currentView === 'todo' 
      ? '暂无待办事项' 
      : '暂无已完成事项';
    const emptyStateSubMessage = currentView === 'todo' 
      ? '点击上方输入框添加新的待办事项' 
      : '完成的待办事项会显示在这里';
    
    emptyState.querySelector('.empty-state-icon').textContent = emptyStateIcon;
    emptyState.querySelector('div:nth-child(2)').textContent = emptyStateMessage;
    emptyState.querySelector('div:nth-child(3)').textContent = emptyStateSubMessage;
    }
  
  // 确保只添加一个空状态元素
  const existingEmptyState = todoLists.querySelector('.empty-state');
  if (!existingEmptyState) {
    todoLists.appendChild(emptyState);
  }
  
  // 隐藏所有列表
  document.querySelectorAll('.todo-list').forEach(list => {
    list.style.display = 'none';
  });
}

// 隐藏空状态
function hideEmptyState() {
  const emptyState = todoLists.querySelector('.empty-state');
  if (emptyState) {
    todoLists.removeChild(emptyState);
  }
  
  // 只显示当前视图的列表
  document.querySelectorAll('.todo-list').forEach(list => {
    list.style.display = list.dataset.status === currentView ? 'flex' : 'none';
  });
}

// 更新备注栏占位符显示
function updateNotePlaceholder() {
  if (editTodoNote && notePlaceholder) {
    if (editTodoNote.innerHTML.trim()) {
      notePlaceholder.style.display = 'none';
    } else {
      notePlaceholder.style.display = 'block';
    }
  }
}

// 设置备注栏事件监听
function setupNoteEditor() {
  if (!editTodoNote) return;
  
  // 处理内容变化，更新占位符
  editTodoNote.addEventListener('input', updateNotePlaceholder);
  
  // 处理点击事件，聚焦备注栏
  editTodoNote.addEventListener('click', () => {
    editTodoNote.focus();
  });
  
  // 处理图片粘贴
  editTodoNote.addEventListener('paste', (e) => {
    // 检查是否有图片数据
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        e.preventDefault();
        
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        
        reader.onload = function(event) {
          const img = document.createElement('img');
          img.src = event.target.result;
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.margin = '5px 0';
          
          // 在当前光标位置插入图片
          const selection = window.getSelection();
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(img);
            
            // 移动光标到图片后面
            range.setStartAfter(img);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
          }
          
          // 更新占位符
          updateNotePlaceholder();
        };
        
        reader.readAsDataURL(blob);
        break;
      }
    }
  });
}

// 设置事件监听器
function setupEventListeners() {
  // 添加待办事项按钮点击事件
  addTodoBtn.addEventListener('click', handleAddTodo);
  
  // 输入框回车事件
  todoInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleAddTodo();
    }
  });
  
  
  
  // 搜索框输入事件
  todoSearchInput.addEventListener('input', () => {
    currentSearchTerm = todoSearchInput.value.trim();
    currentFilterType = 'search'; // 设置为通用搜索模式
    renderTodos();
  });
  
  // 设置备注编辑器
  setupNoteEditor();
  
  // 列表视图切换器 - 下拉框交互逻辑
  const listViewSwitcherBtn = document.getElementById('list-view-switcher-btn');
  const listViewSwitcherText = document.getElementById('list-view-switcher-text');
  const listViewSwitcherDropdown = listViewSwitcherBtn?.nextElementSibling;
  const listViewSwitcherItems = listViewSwitcherDropdown?.querySelectorAll('.dropdown-item');
  
  if (listViewSwitcherBtn && listViewSwitcherDropdown) {
    // 切换下拉菜单显示状态
    listViewSwitcherBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      listViewSwitcherDropdown.parentElement.classList.toggle('active');
    });
    
    // 点击下拉菜单项时切换视图
    listViewSwitcherItems.forEach(item => {
      item.addEventListener('click', () => {
        const value = item.getAttribute('data-value');
        if (value) {
          currentView = value;
          
          // 更新按钮文本
          listViewSwitcherText.textContent = item.textContent;
          
          // 更新选中状态
          listViewSwitcherItems.forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          
          // 关闭下拉菜单
          listViewSwitcherDropdown.parentElement.classList.remove('active');
          
          // 重新渲染待办事项
          renderTodos();
        }
      });
    });
  }
  
  // 面板切换下拉菜单的功能已由shared/dropdown-menu.js处理
  // 这里不再重复实现该功能
  
  // 点击文档其他地方关闭下拉菜单
  document.addEventListener('click', () => {
    const dropdowns = document.querySelectorAll('.dropdown');
    dropdowns.forEach(dropdown => {
      dropdown.classList.remove('active');
    });
  });
}

// 处理添加待办事项
function handleAddTodo() {
  const content = todoInput.value.trim();
  if (content) {
    addTodo(content);
    todoInput.value = '';
  }
}

// 设置模态框
function setupModal() {
  // 保存按钮点击事件
  saveTodoBtn.addEventListener('click', saveEditedTodo);
  
  // 取消按钮点击事件
  cancelTodoBtn.addEventListener('click', closeEditModal);
  
  // 关闭按钮点击事件
  modalClose.addEventListener('click', closeEditModal);
  
  // 点击模态框外部关闭
  todoModal.addEventListener('click', (e) => {
    if (e.target === todoModal) {
      closeEditModal();
    }
  });
  
  // ESC键关闭模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && todoModal.classList.contains('active')) {
      closeEditModal();
    }
  });
}

// 打开编辑模态框
function openEditModal(id) {
  const todo = todos.find(todo => todo.id === id);
  if (todo) {
    currentEditTodoId = id;
    editTodoContent.value = todo.content;
    editTodoDate.value = todo.dueDate ? todo.dueDate.split('T')[0] : '';
    editTodoPriority.value = todo.priority || 'medium';
    editTodoTags.value = todo.tags ? todo.tags.join(', ') : '';
    
    // 填充备注内容
    editTodoNote.innerHTML = todo.note || '';
    
    // 根据备注内容显示/隐藏占位符
    updateNotePlaceholder();
    
    // 渲染子任务
    const subTasksContainer = document.getElementById('sub-tasks-container');
    if (subTasksContainer) {
      subTasksContainer.innerHTML = '';
      
      // 添加子任务输入框
      if (todo.subTasks && todo.subTasks.length > 0) {
        todo.subTasks.forEach(subTask => {
          addSubTaskInput(subTasksContainer, subTask);
        });
      }
      
      // 添加"添加子任务"按钮
      const addSubTaskBtn = document.createElement('button');
      addSubTaskBtn.className = 'btn btn-small';
      addSubTaskBtn.textContent = '+ 添加子任务';
      addSubTaskBtn.addEventListener('click', () => {
        addSubTaskInput(subTasksContainer);
      });
      
      subTasksContainer.appendChild(addSubTaskBtn);
    }
    
    // 显示模态框并添加动画效果
    todoModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 防止背景滚动
    
    // 聚焦内容输入框
    setTimeout(() => {
      editTodoContent.focus();
    }, 100);
  }
}

// 添加子任务输入框
function addSubTaskInput(container, subTask = null) {
  // 首先查找"添加子任务"按钮
  let addSubTaskBtn = null;
  for (let i = 0; i < container.children.length; i++) {
    const child = container.children[i];
    if (child.classList.contains('btn-small') && child.textContent.includes('添加子任务')) {
      addSubTaskBtn = child;
      // 移除按钮，稍后再添加到末尾
      container.removeChild(child);
      break;
    }
  }
  
  // 创建新的子任务行
  const subTaskRow = document.createElement('div');
  subTaskRow.className = 'sub-task-row';
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'sub-task-checkbox';
  checkbox.checked = subTask ? subTask.completed : false;
  
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sub-task-input';
  input.placeholder = '子任务内容...';
  input.value = subTask ? subTask.content : '';
  if (subTask && subTask.id) {
    input.dataset.id = subTask.id;
  }
  
  const removeBtn = document.createElement('button');
  removeBtn.className = 'sub-task-remove-btn';
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    container.removeChild(subTaskRow);
  });
  
  subTaskRow.appendChild(checkbox);
  subTaskRow.appendChild(input);
  subTaskRow.appendChild(removeBtn);
  container.appendChild(subTaskRow);
  
  // 如果找到了添加子任务按钮，则将其重新添加到容器末尾
  if (addSubTaskBtn) {
    container.appendChild(addSubTaskBtn);
  }
  
  // 聚焦新创建的输入框
  input.focus();
}

// 关闭编辑模态框
function closeEditModal() {
  todoModal.classList.remove('active');
  document.body.style.overflow = ''; // 恢复背景滚动
  
  // 延迟清空输入框，等待动画完成
  setTimeout(() => {
    currentEditTodoId = null;
    editTodoContent.value = '';
    editTodoDate.value = '';
    editTodoPriority.value = 'medium';
    editTodoTags.value = '';
    editTodoNote.innerHTML = '';
    updateNotePlaceholder();
  }, 300);
}

// 保存编辑后的待办事项
function saveEditedTodo() {
  if (currentEditTodoId) {
    const content = editTodoContent.value.trim();
    const dueDate = editTodoDate.value;
    const priority = editTodoPriority.value;
    const tags = editTodoTags.value
      ? editTodoTags.value.split(',').map(tag => tag.trim()).filter(tag => tag) 
      : [];
    
    // 获取子任务
    const subTasksContainer = document.getElementById('sub-tasks-container');
    const subTasks = [];
    
    if (subTasksContainer) {
      const subTaskInputs = subTasksContainer.querySelectorAll('.sub-task-input');
      subTaskInputs.forEach(input => {
        const content = input.value.trim();
        if (content) {
          subTasks.push({
            id: input.dataset.id || generateId(),
            content: content,
            completed: input.previousElementSibling.checked
          });
        }
      });
    }
    
    if (content) {
      // 确保note属性被更新，即使它是空字符串
      const updatedNote = editTodoNote.innerHTML.trim();
      updateTodo(currentEditTodoId, {
        content: content,
        dueDate: dueDate,
        priority: priority,
        tags: tags,
        subTasks: subTasks,
        note: updatedNote // 直接使用trim后的值，空字符串也会被保存
      });
    }
  }
  
  closeEditModal();
}

// 格式化日期
function formatDate(dateString) {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}



// 当DOM加载完成时初始化
document.addEventListener('DOMContentLoaded', init);