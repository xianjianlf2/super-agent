// 待办事项应用

// 获取 DOM 元素
const todoInput = document.getElementById('todo-input');
const addBtn = document.getElementById('add-btn');
const todoList = document.getElementById('todo-list');
const filterButtons = document.querySelectorAll('.filter-btn');
const itemsLeftSpan = document.getElementById('items-left');
const clearCompletedBtn = document.getElementById('clear-completed');

// 初始化待办事项数组
let todos = JSON.parse(localStorage.getItem('todos')) || [];
let currentFilter = 'all';

// 渲染待办事项列表
function renderTodos() {
  // 清空列表
  todoList.innerHTML = '';
  
  // 根据当前筛选条件过滤待办事项
  let filteredTodos = [];
  if (currentFilter === 'all') {
    filteredTodos = todos;
  } else if (currentFilter === 'active') {
    filteredTodos = todos.filter(todo => !todo.completed);
  } else if (currentFilter === 'completed') {
    filteredTodos = todos.filter(todo => todo.completed);
  }
  
  // 如果没有待办事项，显示空状态
  if (filteredTodos.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.innerHTML = `
      <h3>暂无任务</h3>
      <p>${currentFilter === 'completed' ? '还没有完成的任务' : currentFilter === 'active' ? '所有任务都已完成！' : '添加第一个任务吧'}</p>
    `;
    todoList.appendChild(emptyState);
    return;
  }
  
  // 渲染每个待办事项
  filteredTodos.forEach((todo, index) => {
    const li = document.createElement('li');
    li.className = `todo-item ${todo.completed ? 'completed' : ''}`;
    li.dataset.id = todo.id;
    
    li.innerHTML = `
      <input type="checkbox" class="todo-checkbox" ${todo.completed ? 'checked' : ''}>
      <span class="todo-text">${escapeHtml(todo.text)}</span>
      <button class="delete-btn">✕</button>
    `;
    
    todoList.appendChild(li);
  });
}

// 转义 HTML 字符，防止 XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 更新待办事项数量统计
function updateStats() {
  const activeCount = todos.filter(todo => !todo.completed).length;
  itemsLeftSpan.textContent = `${activeCount} ${activeCount === 1 ? '项' : '项'}待完成`;
}

// 保存到 localStorage
function saveToStorage() {
  localStorage.setItem('todos', JSON.stringify(todos));
}

// 添加新待办事项
function addTodo() {
  const text = todoInput.value.trim();
  if (text === '') return;
  
  const newTodo = {
    id: Date.now(),
    text,
    completed: false
  };
  
  todos.push(newTodo);
  saveToStorage();
  todoInput.value = '';
  todoInput.focus();
}

// 切换待办事项完成状态
function toggleTodo(id) {
  todos = todos.map(todo => 
    todo.id === parseInt(id) ? {...todo, completed: !todo.completed} : todo
  );
  saveToStorage();
}

// 删除待办事项
function deleteTodo(id) {
  todos = todos.filter(todo => todo.id !== parseInt(id));
  saveToStorage();
}

// 清除已完成的待办事项
function clearCompleted() {
  todos = todos.filter(todo => !todo.completed);
  saveToStorage();
}

// 事件监听器
addBtn.addEventListener('click', addTodo);

todoInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    addTodo();
  }
});

todoList.addEventListener('click', (e) => {
  if (e.target.classList.contains('todo-checkbox')) {
    const todoItem = e.target.closest('.todo-item');
    if (todoItem) {
      toggleTodo(todoItem.dataset.id);
    }
  } else if (e.target.classList.contains('delete-btn')) {
    const todoItem = e.target.closest('.todo-item');
    if (todoItem) {
      deleteTodo(todoItem.dataset.id);
    }
  }
});

// 筛选按钮事件
filterButtons.forEach(button => {
  button.addEventListener('click', () => {
    // 移除所有 active 类
    filterButtons.forEach(btn => btn.classList.remove('active'));
    // 为点击的按钮添加 active 类
    button.classList.add('active');
    // 更新当前筛选条件
    currentFilter = button.dataset.filter;
  });
});

clearCompletedBtn.addEventListener('click', clearCompleted);

// 初始化应用
function init() {
  renderTodos();
  updateStats();
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 监听 localStorage 变化（当其他标签页修改时）
window.addEventListener('storage', () => {
  todos = JSON.parse(localStorage.getItem('todos')) || [];
  renderTodos();
  updateStats();
});