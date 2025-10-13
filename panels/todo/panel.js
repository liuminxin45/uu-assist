// panel.js - Todo面板功能实现
const PANEL_NAME = "todo-panel";

// DOM 元素
const todoInput = document.getElementById('todo-input');
const addTodoBtn = document.getElementById('add-todo-btn');
const todoLists = document.getElementById('todo-lists');
const todoFilterBtns = document.querySelectorAll('.todo-filter-btn');
const addItemBtns = document.querySelectorAll('.todo-add-item');
const todoCount = document.getElementById('todo-count');
const inProgressCount = document.getElementById('in-progress-count');
const completedCount = document.getElementById('completed-count');

// 模态框元素
const todoModal = document.getElementById('todo-modal');
const editTodoContent = document.getElementById('edit-todo-content');
const editTodoDate = document.getElementById('edit-todo-date');
const editTodoPriority = document.getElementById('edit-todo-priority');
const editTodoTags = document.getElementById('edit-todo-tags');
const saveTodoBtn = document.getElementById('save-todo-btn');
const cancelTodoBtn = document.getElementById('cancel-todo-btn');
const modalClose = document.querySelector('.modal-close');

// 状态变量
let todos = [];
let currentFilter = 'all';
let currentEditTodoId = null;

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
function addTodo(content, status = 'todo', dueDate = '', priority = 'medium', tags = []) {
  const todo = {
    id: generateId(),
    content: content.trim(),
    status: status,
    createdDate: new Date().toISOString(),
    dueDate: dueDate,
    priority: priority,
    tags: tags
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

// 根据过滤器筛选待办事项
function filterTodos() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return todos.filter(todo => {
    switch (currentFilter) {
      case 'active':
        return todo.status !== 'completed';
      case 'completed':
        return todo.status === 'completed';
      case 'today':
        return todo.dueDate && new Date(todo.dueDate).toDateString() === today.toDateString();
      case 'overdue':
        return todo.dueDate && new Date(todo.dueDate) < today && todo.status !== 'completed';
      default:
        return true;
    }
  });
}

// 渲染待办事项
function renderTodos() {
  const filteredTodos = filterTodos();
  
  // 清空所有列表
  document.getElementById('todo-items').innerHTML = '';
  document.getElementById('in-progress-items').innerHTML = '';
  document.getElementById('completed-items').innerHTML = '';
  
  // 按状态分类
  const todosByStatus = {
    'todo': [],
    'in-progress': [],
    'completed': []
  };
  
  filteredTodos.forEach(todo => {
    todosByStatus[todo.status]?.push(todo);
  });
  
  // 更新计数
  todoCount.textContent = todosByStatus['todo'].length;
  inProgressCount.textContent = todosByStatus['in-progress'].length;
  completedCount.textContent = todosByStatus['completed'].length;
  
  // 渲染每个状态的待办事项
  for (const status in todosByStatus) {
    const container = document.getElementById(`${status}-items`);
    todosByStatus[status].forEach(todo => {
      const todoElement = createTodoElement(todo);
      container.appendChild(todoElement);
    });
  }
  
  // 检查是否所有列表都为空
  const allEmpty = Object.values(todosByStatus).every(list => list.length === 0);
  if (allEmpty) {
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
  if (todo.priority !== 'medium') {
    const priorityTag = document.createElement('span');
    priorityTag.className = 'todo-item-priority ' + todo.priority;
    priorityTag.textContent = todo.priority === 'high' ? '高' : '低';
    contentText.appendChild(priorityTag);
  }
  
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
      tagsContainer.appendChild(tagElement);
    });
    
    contentContainer.appendChild(tagsContainer);
  }
  
  contentContainer.appendChild(contentText);
  
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
    if (!e.target.closest('.todo-checkbox') && !e.target.closest('.todo-delete-btn')) {
      openEditModal(todo.id);
    }
  });
  
  todoItem.appendChild(checkbox);
  todoItem.appendChild(contentContainer);
  todoItem.appendChild(deleteBtn);
  
  return todoItem;
}

// 显示空状态
function showEmptyState() {
  // 检查是否已经存在空状态元素
  let emptyState = document.querySelector('.empty-state');
  if (!emptyState) {
    emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <div class="empty-state-icon">📝</div>
      <div>暂无待办事项</div>
      <div style="font-size: 12px; color: var(--text-muted); margin-top: var(--space-sm);">点击上方输入框添加新的待办事项</div>
    `;
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
  
  // 显示所有列表
  document.querySelectorAll('.todo-list').forEach(list => {
    list.style.display = 'flex';
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
  
  // 过滤按钮点击事件
  todoFilterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      todoFilterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTodos();
    });
  });
  
  // 添加待办事项按钮点击事件
  addItemBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const status = btn.dataset.status;
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'todo-input';
      input.placeholder = `添加到${getListName(status)}...`;
      
      // 替换按钮为输入框
      btn.parentNode.replaceChild(input, btn);
      
      // 聚焦输入框
      input.focus();
      
      // 监听输入框事件
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          addTodo(input.value, status);
          // 替换回添加按钮
          input.parentNode.replaceChild(btn, input);
        }
      });
      
      // 失去焦点时替换回添加按钮
      input.addEventListener('blur', () => {
        setTimeout(() => {
          if (input.parentNode) {
            input.parentNode.replaceChild(btn, input);
          }
        }, 100);
      });
    });
  });
  
  // 面板切换下拉菜单
  const panelSwitchBtn = document.getElementById('panelSwitchBtn');
  const panelDropdown = document.getElementById('panelDropdown');
  
  if (panelSwitchBtn && panelDropdown) {
    panelSwitchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panelDropdown.parentNode.classList.toggle('active');
    });
    
    panelDropdown.querySelectorAll('.dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const targetPanel = item.dataset.target;
        if (targetPanel && targetPanel !== PANEL_NAME) {
          // 调用全局的switchToPanel函数切换面板
          if (window.switchToPanel) {
            window.switchToPanel(targetPanel);
          } else {
            console.warn('switchToPanel function not found');
          }
        }
        panelDropdown.parentNode.classList.remove('active');
      });
    });
  }
  
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
    if (e.key === 'Escape' && todoModal.style.display === 'block') {
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
    
    // 显示模态框
    todoModal.style.display = 'block';
    
    // 聚焦内容输入框
    editTodoContent.focus();
  }
}

// 关闭编辑模态框
function closeEditModal() {
  todoModal.style.display = 'none';
  currentEditTodoId = null;
  
  // 清空输入框
  editTodoContent.value = '';
  editTodoDate.value = '';
  editTodoPriority.value = 'medium';
  editTodoTags.value = '';
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
    
    if (content) {
      updateTodo(currentEditTodoId, {
        content: content,
        dueDate: dueDate,
        priority: priority,
        tags: tags
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

// 获取列表名称
function getListName(status) {
  const names = {
    'todo': '待办',
    'in-progress': '进行中',
    'completed': '已完成'
  };
  
  return names[status] || status;
}

// 当DOM加载完成时初始化
document.addEventListener('DOMContentLoaded', init);