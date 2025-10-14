// panel.js - Gerrit面板功能实现
const PANEL_NAME = "gerrit-panel";

// DOM 元素
const gerritList = document.getElementById('gerrit-list');
const gerritDetail = document.getElementById('gerrit-detail');
const gerritSearchInput = document.getElementById('gerrit-search-input');
const refreshBtn = document.getElementById('refresh-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const closeSettingsModal = document.getElementById('close-settings-modal');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const gerritUrlInput = document.getElementById('gerrit-url');
const gerritUsernameInput = document.getElementById('gerrit-username');
const gerritHostInput = document.getElementById('gerrit-host');
const filterButtons = document.querySelectorAll('.gerrit-filter-btn');
const statusElement = document.getElementById('status');

// 状态变量
let gerritChanges = [];
let currentFilter = 'mine';
let currentSearchTerm = '';
let currentSelectedChange = null;
let isLoading = false;

// 从存储加载配置
async function loadSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(['gerrit_url', 'gerrit_username', 'gerrit_host']);
      if (result.gerrit_url) {
        gerritUrlInput.value = result.gerrit_url;
      }
      if (result.gerrit_username) {
        gerritUsernameInput.value = result.gerrit_username;
      }
      if (result.gerrit_host) {
        gerritHostInput.value = result.gerrit_host;
      }
    }
  } catch (error) {
    console.error('加载设置失败:', error);
    setStatus('加载设置失败');
  }
}

// 保存配置到存储
async function saveSettings() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({
        gerrit_url: gerritUrlInput.value.trim(),
        gerrit_username: gerritUsernameInput.value.trim(),
        gerrit_host: gerritHostInput.value.trim()
      });
      setStatus('设置已保存');
      settingsModal.style.display = 'none';
    }
  } catch (error) {
    console.error('保存设置失败:', error);
    setStatus('保存设置失败');
  }
}

// 设置状态栏消息
function setStatus(message) {
  if (statusElement) {
    statusElement.textContent = message;
    // 3秒后清除状态消息
    setTimeout(() => {
      if (statusElement && statusElement.textContent === message) {
        statusElement.textContent = '';
      }
    }, 3000);
  }
}

// 加载Gerrit变更列表
async function loadGerritChanges() {
  if (isLoading) return;
  
  isLoading = true;
  gerritList.innerHTML = '<div class="gerrit-loading">加载中</div>';
  
  try {
    const gerritUrl = gerritUrlInput.value.trim() || 'https://review.tp-link.net';
    const gerritUsername = gerritUsernameInput.value.trim();
    
    // 构建查询URL
    let query = '';
    switch (currentFilter) {
      case 'mine':
        query = 'is:open owner:self';
        break;
      case 'pending':
        query = `is:open -owner:self reviewer:self`;
        break;
      default:
        query = 'is:open';
    }
    
    // 添加搜索词
    if (currentSearchTerm) {
      query += ` ${currentSearchTerm}`;
    }
    
    // URL编码查询
    const encodedQuery = encodeURIComponent(query);
    const url = `${gerritUrl}/gerrit/changes/?q=${encodedQuery}&n=50&o=DETAILED_ACCOUNTS&o=DETAILED_LABELS`;
    
    setStatus('正在加载变更列表...');
    
    // 使用扩展的消息机制获取数据
    const response = await chrome.runtime.sendMessage({ 
      type: "fetchGerritChanges", 
      url: url,
      gerritUrl: gerritUrl
    }).catch(error => {
      console.error('获取Gerrit变更失败:', error);
      throw new Error('网络请求失败');
    });
    
    if (response && response.ok) {
      // 移除前缀字符 )]}'
      const cleanData = response.data.substring(response.data.indexOf('\n') + 1);
      gerritChanges = JSON.parse(cleanData);
      renderGerritList();
      setStatus(`加载了 ${gerritChanges.length} 个变更`);
    } else {
      throw new Error(response?.error || '获取数据失败');
    }
  } catch (error) {
    console.error('加载Gerrit变更时出错:', error);
    gerritList.innerHTML = `<div class="gerrit-empty">加载失败: ${error.message}</div>`;
    setStatus(`加载失败: ${error.message}`);
  } finally {
    isLoading = false;
  }
}

// 渲染单个变更项
function renderChangeItem(change) {
  const item = document.createElement('div');
  item.className = 'gerrit-item' + (currentSelectedChange?.id === change.id ? ' active' : '');
  item.dataset.id = change.id;
  
  // 确定变更状态
  let statusClass = 'gerrit-item-status-pending';
  let statusText = '待评审';
  
  // 获取当前用户名
  const currentUsername = gerritUsernameInput.value.trim();
  
  // 检查当前用户是否是owner
  const isOwner = currentUsername && change.owner && 
    (change.owner.name === currentUsername || change.owner.email === currentUsername);
  
  // 检查当前用户是否在评审人列表中
  let isInReviewers = false;
  if (currentUsername && change.reviewers) {
    const allReviewers = [];
    
    // 合并所有类型的评审人
    if (change.reviewers.REVIEWER) {
      allReviewers.push(...change.reviewers.REVIEWER);
    }
    if (change.reviewers.CC) {
      allReviewers.push(...change.reviewers.CC);
    }
    
    // 检查当前用户是否在评审人列表中
    isInReviewers = allReviewers.some(reviewer => 
      reviewer.name === currentUsername || reviewer.email === currentUsername
    );
  }
  
  // 应用分类规则
  // 1. 如果owner是我自己，则显示为"我的变更"
  if (currentUsername && isOwner) {
    statusClass = 'gerrit-item-status-mine';
    statusText = '我的变更';
  }
  // 2. 如果owner不是我，且我在评审人列表中，则是"待评审"
  else if (currentUsername && !isOwner && isInReviewers) {
    statusClass = 'gerrit-item-status-pending';
    statusText = '待评审';
  }
  // 3. 其他情况则标签为"无须处理"
  else {
    statusClass = 'gerrit-item-status-ignore';
    statusText = '无须处理';
  }
  
  // 检查特殊状态
  if (change.status === 'ABANDONED') {
    statusClass = 'gerrit-item-status-abandoned';
    statusText = '已放弃';
  }
  
  // 获取变更的评分
  let score = '';
  let scoreColor = '';
  if (change.labels && change.labels['Code-Review'] && change.labels['Code-Review'].all) {
    const votes = change.labels['Code-Review'].all;
    if (Array.isArray(votes)) {
      // 获取最新的评分（最大的值）
      const maxVote = votes.reduce((max, vote) => {
        if (vote && vote.value > max) return vote.value;
        return max;
      }, -Infinity);
      if (maxVote >= 2) {
        score = '+2';
        scoreColor = 'success';
      }
      else if (maxVote >= 1) {
        score = '+1';
        scoreColor = 'success';
      }
      else if (maxVote <= -1) {
        score = maxVote.toString();
        scoreColor = 'error';
      }
    }
  }
  
  // 设置项的HTML内容
  item.innerHTML = `
    <div class="gerrit-item-title">
      <span>${change.subject}</span>
      <span class="gerrit-item-status ${statusClass}">${statusText}</span>
    </div>
    <div class="gerrit-item-info">
      <div class="gerrit-item-meta">
        <span class="gerrit-item-owner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
          </svg>
          ${change.owner?.name || '未知作者'}
        </span>
        <span>•</span>
        <span class="gerrit-item-date">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          ${new Date(change.updated).toLocaleDateString('zh-CN')}
        </span>
        <span>#${change._number}</span>
        ${score ? `<span class="gerrit-item-score score-${scoreColor}">${score}</span>` : ''}
      </div>
    </div>
  `;
  
  // 添加点击事件
  item.addEventListener('click', () => {
    selectChange(change);
  });
  
  return item;
}

// 渲染Gerrit变更列表
function renderGerritList() {
  if (gerritChanges.length === 0) {
    gerritList.innerHTML = '<div class="gerrit-empty">没有找到匹配的变更</div>';
    return;
  }
  
  gerritList.innerHTML = '';
  
  gerritChanges.forEach(change => {
    const item = renderChangeItem(change);
    gerritList.appendChild(item);
  });
}

// 选择变更并显示详情
async function selectChange(change) {
  currentSelectedChange = change;
  
  // 更新列表中的选中状态
  document.querySelectorAll('.gerrit-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === change.id);
  });
  
  // 显示加载状态
  gerritDetail.innerHTML = '<div class="gerrit-loading">加载详情</div>';
  
  try {
    const gerritUrl = gerritUrlInput.value.trim() || 'https://review.tp-link.net';
    const detailUrl = `${gerritUrl}/gerrit/changes/${change.id}/detail`;
    
    setStatus('正在加载变更详情...');
    
    // 获取变更详情
    const response = await chrome.runtime.sendMessage({ 
      type: "fetchGerritChanges", 
      url: detailUrl,
      gerritUrl: gerritUrl
    }).catch(error => {
      console.error('获取变更详情失败:', error);
      throw new Error('网络请求失败');
    });
    
    if (response && response.ok) {
      // 移除前缀字符 )]}'
      const cleanData = response.data.substring(response.data.indexOf('\n') + 1);
      const detailedChange = JSON.parse(cleanData);
      renderChangeDetail(detailedChange);
      setStatus('已加载变更详情');
    } else {
      throw new Error(response?.error || '获取详情失败');
    }
  } catch (error) {
    console.error('加载变更详情时出错:', error);
    gerritDetail.innerHTML = `<div class="gerrit-empty">加载详情失败: ${error.message}</div>`;
    setStatus(`加载详情失败: ${error.message}`);
  }
}

// 渲染变更详情
function renderChangeDetail(change) {
  const gerritUrl = gerritUrlInput.value.trim() || 'https://review.tp-link.net';
  // 从change.id中提取提交ID部分 (格式为: project~branch~commitId)
  const parts = change.id.split('~');
  const commitId = parts.length >= 3 ? parts[2] : change.id;
  const changeUrl = `${gerritUrl}/gerrit/q/${commitId}`;
  
  // 确定变更状态
    let statusClass = 'gerrit-item-status-pending';
    let statusText = '待评审';
    
    // 获取当前用户名
    const currentUsername = gerritUsernameInput.value.trim();
    
    // 检查当前用户是否是owner
    const isOwner = currentUsername && change.owner && 
      (change.owner.name === currentUsername || change.owner.email === currentUsername);
    
    // 检查当前用户是否在评审人列表中
    let isInReviewers = false;
    if (currentUsername && change.reviewers) {
      const allReviewers = [];
      
      // 合并所有类型的评审人
      if (change.reviewers.REVIEWER) {
        allReviewers.push(...change.reviewers.REVIEWER);
      }
      if (change.reviewers.CC) {
        allReviewers.push(...change.reviewers.CC);
      }
      
      // 检查当前用户是否在评审人列表中
      isInReviewers = allReviewers.some(reviewer => 
        reviewer.name === currentUsername || reviewer.email === currentUsername
      );
    }
    
    // 应用分类规则
    // 1. 如果owner是我自己，则显示为"我的变更"
    if (currentUsername && isOwner) {
      statusClass = 'gerrit-item-status-mine';
      statusText = '我的变更';
    }
    // 2. 如果owner不是我，且我在评审人列表中，则是"待评审"
    else if (currentUsername && !isOwner && isInReviewers) {
      statusClass = 'gerrit-item-status-pending';
      statusText = '待评审';
    }
    // 3. 其他情况则标签为"无须处理"
    else {
      statusClass = 'gerrit-item-status-ignore';
      statusText = '无须处理';
    }
    
    // 检查特殊状态
    if (change.status === 'ABANDONED') {
      statusClass = 'gerrit-item-status-abandoned';
      statusText = '已放弃';
    }
  
  // 渲染文件变更列表
  let changesHtml = '';
  if (change.revisions && Object.keys(change.revisions).length > 0) {
    const latestRevision = change.revisions[Object.keys(change.revisions)[0]];
    if (latestRevision.files) {
      changesHtml = Object.entries(latestRevision.files).map(([path, fileInfo]) => {
        let icon = '📄';
        if (fileInfo.type === 'DELETED') {
          icon = '🗑️';
        } else if (fileInfo.type === 'ADDED') {
          icon = '✚';
        } else if (fileInfo.type === 'MODIFIED') {
          icon = '📝';
        }
        
        return `
          <div class="gerrit-detail-change">
            <span class="gerrit-detail-change-icon">${icon}</span>
            <span class="gerrit-detail-change-path">${path}</span>
          </div>
        `;
      }).join('');
    }
  }
  
  // 渲染评审人
  let reviewersHtml = '';
  if (change.reviewers) {
    const allReviewers = [];
    
    // 合并所有类型的评审人
    if (change.reviewers.REVIEWER) {
      allReviewers.push(...change.reviewers.REVIEWER);
    }
    if (change.reviewers.CC) {
      allReviewers.push(...change.reviewers.CC);
    }
    
    reviewersHtml = allReviewers.map(reviewer => {
      return `
        <div style="padding: 4px 0;">
          ${reviewer.name} (${reviewer.email})
        </div>
      `;
    }).join('');
  }
  
  gerritDetail.innerHTML = `
    <div class="gerrit-detail-header">
      <div>
        <div class="gerrit-detail-title">${change.subject}</div>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <span class="gerrit-item-status ${statusClass}">${statusText}</span>
          <span style="color: var(--text-muted); font-size: 14px;">#${change._number}</span>
        </div>
      </div>
      <div class="gerrit-detail-actions">
        <a href="${changeUrl}" target="_blank" class="gerrit-detail-btn">
          在Gerrit中打开
        </a>
      </div>
    </div>
    
    <div class="gerrit-detail-content">
      <div class="gerrit-detail-section">
        <div class="gerrit-detail-section-title">提交信息</div>
        <div class="gerrit-detail-message">
          ${change.commitMessage || '无提交信息'}
        </div>
      </div>
      
      <div class="gerrit-detail-section">
        <div class="gerrit-detail-section-title">基本信息</div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div><strong>项目:</strong> ${change.project}</div>
          <div><strong>分支:</strong> ${change.branch}</div>
          <div><strong>作者:</strong> ${change.owner.name} (${change.owner.email})</div>
          <div><strong>创建时间:</strong> ${new Date(change.created).toLocaleString()}</div>
          <div><strong>更新时间:</strong> ${new Date(change.updated).toLocaleString()}</div>
          <div><strong>提交ID:</strong> ${change.id}</div>
        </div>
      </div>
      
      <div class="gerrit-detail-section">
        <div class="gerrit-detail-section-title">文件变更</div>
        <div class="gerrit-detail-changes">
          ${changesHtml || '无文件变更信息'}
        </div>
      </div>
      
      <div class="gerrit-detail-section">
        <div class="gerrit-detail-section-title">评审人</div>
        <div>
          ${reviewersHtml || '无评审人'}
        </div>
      </div>
    </div>
  `;
}

// 处理搜索
function handleSearch() {
  currentSearchTerm = gerritSearchInput.value.trim();
  loadGerritChanges();
}

// 处理筛选
function handleFilter(filter) {
  currentFilter = filter;
  
  // 更新筛选按钮状态
  filterButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  
  loadGerritChanges();
}

// 设置事件监听器
function setupEventListeners() {
  // 刷新按钮
  refreshBtn.addEventListener('click', loadGerritChanges);
  
  // 设置按钮
  settingsBtn.addEventListener('click', () => {
    settingsModal.style.display = 'block';
  });
  
  // 关闭设置模态框
  closeSettingsModal.addEventListener('click', () => {
    settingsModal.style.display = 'none';
  });
  
  // 保存设置
  saveSettingsBtn.addEventListener('click', saveSettings);
  
  // 点击模态框外部关闭
  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });
  
  // 搜索
  gerritSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  });
  
  // 筛选按钮
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      handleFilter(btn.dataset.filter);
    });
  });
  
  // 页面显示时恢复状态
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      loadSettings().catch(e => console.warn('恢复设置失败:', e));
    }
  });
}

// 初始化
async function init() {
  // 检查DOM元素是否存在
  if (!gerritList || !gerritDetail || !gerritSearchInput) {
    console.warn('DOM元素尚未完全加载，稍后重试...');
    // 如果DOM元素不存在，延迟后重试
    setTimeout(() => {
      init().catch(e => console.error('重试初始化失败:', e));
    }, 100);
    return;
  }
  
  await loadSettings();
  setupEventListeners();
  
  // 页面完全加载后自动加载数据
  loadGerritChanges().catch(error => {
    console.warn('首次加载数据失败，可点击刷新重试:', error);
    setStatus('加载变更列表失败，点击刷新重试');
  });
}

// 等待DOM内容完全加载后再启动面板
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    init().catch(error => {
      console.error('初始化Gerrit面板失败:', error);
      setStatus(`初始化失败: ${error.message}`);
    });
  });
} else {
  // 页面已经加载完成，直接初始化
  init().catch(error => {
    console.error('初始化Gerrit面板失败:', error);
    setStatus(`初始化失败: ${error.message}`);
  });
}

// 导出一些方法供其他模块使用（如果需要）
window.gerritPanel = {
  refresh: loadGerritChanges,
  loadSettings: loadSettings
};