// panel.js - Todo面板功能实现
const PANEL_NAME = "todo-panel";

// DOM 元素
const todoInput = document.getElementById('todo-input');
const addTodoBtn = document.getElementById('add-todo-btn');
const todoLists = document.getElementById('todo-lists');
const todoFilterBtns = document.querySelectorAll('.todo-filter-btn');
const addItemBtns = document.querySelectorAll('.todo-add-item');
const todoCount = document.getElementById('todo-count');
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
let currentView = 'todo'; // 新增：当前显示的视图 - 'todo' 或 'completed'

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
function addTodo(content, status = 'todo', dueDate = '', priority = 'medium', tags = [], subTasks = []) {
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
    subTasks: subTasks // 子任务数组
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
  document.getElementById('completed-items').innerHTML = '';
  
  // 按状态分类
  const todosByStatus = {
    'todo': [],
    'completed': []
  };
  
  filteredTodos.forEach(todo => {
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
  if (todo.priority !== 'medium') {
    const priorityTag = document.createElement('span');
    priorityTag.className = 'todo-item-priority ' + todo.priority;
    priorityTag.textContent = todo.priority === 'high' ? '高' : '低';
    contentText.appendChild(priorityTag);
  }
  
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
      tagsContainer.appendChild(tagElement);
    });
    
    contentContainer.appendChild(tagsContainer);
  }
  
  // 子任务
  if (todo.subTasks && todo.subTasks.length > 0) {
    const subTasksContainer = document.createElement('div');
    subTasksContainer.className = 'todo-sub-tasks';
    
    // 子任务标题
    const subTasksTitle = document.createElement('div');
    subTasksTitle.className = 'sub-tasks-title';
    
    // 计算完成的子任务数量
    const completedSubTasks = todo.subTasks.filter(st => st.completed).length;
    subTasksTitle.textContent = `子任务 (${completedSubTasks}/${todo.subTasks.length})`;
    
    subTasksContainer.appendChild(subTasksTitle);
    
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
  
  // 列表视图切换器事件监听
  const listViewSwitcher = document.getElementById('list-view-switcher');
  if (listViewSwitcher) {
    listViewSwitcher.addEventListener('change', () => {
      currentView = listViewSwitcher.value;
      renderTodos();
    });
  }
  
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
      updateTodo(currentEditTodoId, {
        content: content,
        dueDate: dueDate,
        priority: priority,
        tags: tags,
        subTasks: subTasks
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
    'completed': '已完成'
  };
  
  return names[status] || status;
}

// 当DOM加载完成时初始化
document.addEventListener('DOMContentLoaded', init);