// panel.js - Gerrit面板功能实现
const PANEL_NAME = "gerrit-panel";

// DOM 元素
  const gerritList = document.getElementById('gerrit-list');
  const gerritDetail = document.getElementById('gerrit-detail-content');
  const gerritDetailModal = document.getElementById('gerrit-detail-modal');
  const closeDetailModal = document.getElementById('gerrit-detail-close');
  const gerritSearchInput = document.getElementById('gerrit-search-input');
  const refreshBtn = document.getElementById('refresh-btn');
  const settingsBtn = document.getElementById('settings-btn');
  const filterButtons = document.querySelectorAll('.gerrit-filter-btn');
  const settingsModal = document.getElementById('settings-modal');
  const closeSettingsModal = document.getElementById('close-settings-modal');
  const saveSettingsBtn = document.getElementById('save-settings-btn');
  const gerritUrlInput = document.getElementById('gerrit-url');
  const gerritUsernameInput = document.getElementById('gerrit-username');
  const gerritHostInput = document.getElementById('gerrit-host');
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
    // 列表接口只获取必要的元信息
    const url = `${gerritUrl}/gerrit/changes/?q=${encodedQuery}&n=50&o=DETAILED_ACCOUNTS&o=DETAILED_LABELS&o=CURRENT_REVISION`;
    
    setStatus('正在加载变更列表...');
    
    // 使用扩展的消息机制获取数据
    let response;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        response = await chrome.runtime.sendMessage({ 
          type: "fetchGerritChanges", 
          url: url,
          gerritUrl: gerritUrl
        });
      } else {
        // 模拟环境下返回测试数据
        throw new Error('Chrome扩展环境不可用，无法获取数据');
      }
    } catch (error) {
      console.error('获取Gerrit变更失败:', error);
      throw new Error('网络请求失败');
    }
    
    if (response && response.ok) {
      // 移除前缀字符 )]}'
      const cleanData = response.data.replace(/^\)\]\}'\n?/, '');
      gerritChanges = JSON.parse(cleanData);
      
      // 等待一小段时间确保DOM加载完成
      await new Promise(resolve => setTimeout(resolve, 300));
      
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

// 添加统一键值生成函数
function pathKey(s){ return encodeURIComponent(s); } // 唯一且与 URL 编码一致

// 等待工具函数
function wait(ms){ return new Promise(r=>setTimeout(r, ms)); }

// 修改等待文件块函数，使用key列表
async function waitForFileBlocks(paths, timeoutMs=3000) {
  const start = Date.now();
  const waitSet = new Set(paths.map(pathKey));
  while (Date.now() - start < timeoutMs) {
    document.querySelectorAll('.gerrit-detail-change[data-key]')
      .forEach(el => waitSet.delete(el.getAttribute('data-key')));
    if (waitSet.size === 0) return true;
    await wait(50);
  }
  console.warn('超时仍未挂载的文件块(keys):', Array.from(waitSet));
  return false;
}

// 获取文件变更详情
async function fetchFileDiff(gerritUrl, changeNum, rev, filePath) {
  const encodedFile = encodeURIComponent(filePath);
  const url = `${gerritUrl}/gerrit/changes/${changeNum}/revisions/${rev}/files/${encodedFile}/diff?context=ALL&intraline&whitespace=IGNORE_NONE`;
  console.debug('diff url', url); // 添加调试日志
  let response;
  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      response = await chrome.runtime.sendMessage({ type: "fetchGerritDiff", url, gerritUrl });
      if (!response || !response.ok) {
        // 后备：有些后台只实现了 fetchGerritChanges
        response = await chrome.runtime.sendMessage({ type: "fetchGerritChanges", url, gerritUrl });
      }
    } else {
      throw new Error('Chrome扩展环境不可用，无法获取diff数据');
    }
  } catch (e) {
    console.error('sendMessage失败', e);
    showFileError(filePath, '网络请求失败');
    return null;
  }
  
  // 添加错误显示函数
  function showFileError(path, msg) {
    const key = pathKey(path);
    const el = document.querySelector(`.gerrit-detail-change[data-key="${key}"] .gerrit-file-diff`);
    if (el) el.innerHTML = `<div class="gerrit-diff-empty">${msg}</div>`;
  }
  
  if (!response || !response.ok) {
    console.warn('diff响应非OK', { url, resp: response && response.error, status: response && response.status });
    showFileError(filePath, `diff失败: ${response && response.status || '网络错误'}`);
    return null;
  }
  
  let clean = response.data || '';
  clean = clean.replace(/^\)\]\}'\n?/, '');
  
  try {
    const json = JSON.parse(clean);
    return json;
  } catch (e) {
    console.error('diff JSON 解析失败', { url, sample: clean.slice(0, 200) });
    showFileError(filePath, 'diff解析失败');
    return null;
  }
}

// 解析diff内容为可读格式
function parseDiffContent(diffData) {
  if (!diffData || !diffData.content) {
    return [];
  }
  
  const linesArray = [];
  
  if (Array.isArray(diffData.content)) {
    for (const chunk of diffData.content) {
      if (chunk.hasOwnProperty('ab')) {
        // 上下文（未改动）行
        const raw = chunk.ab;
        if (Array.isArray(raw)) {
          raw.forEach(line => {
            linesArray.push({ type: 'context', text: line });
          });
        } else {
          linesArray.push({ type: 'context', text: raw });
        }
      } else {
        // 删除行
        if (chunk.hasOwnProperty('a')) {
          const rawA = chunk.a;
          if (Array.isArray(rawA)) {
            rawA.forEach(line => {
              linesArray.push({ type: 'delete', text: line });
            });
          } else {
            linesArray.push({ type: 'delete', text: rawA });
          }
        }
        // 新增行
        if (chunk.hasOwnProperty('b')) {
          const rawB = chunk.b;
          if (Array.isArray(rawB)) {
            rawB.forEach(line => {
              linesArray.push({ type: 'add', text: line });
            });
          } else {
            linesArray.push({ type: 'add', text: rawB });
          }
        }
      }
    }
  }
  
  return linesArray;
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
  
  // 加载详情到模态框
  gerritDetail.innerHTML = '<div id="gerrit-detail-loading" class="ai-insight-loading"><div class="loading-spinner"></div><p>加载中...</p></div>';
  // 显示模态框
  gerritDetailModal.style.display = 'flex';
  
  try {
    const gerritUrl = gerritUrlInput.value.trim() || 'https://review.tp-link.net';
    const detailUrl = `${gerritUrl}/gerrit/changes/${change.id}/detail`;
    
    setStatus('正在加载变更详情...');
    
    // 获取变更详情，添加必要的选项参数
    const detailedUrl = `${gerritUrl}/gerrit/changes/${change._number}/detail?o=DETAILED_LABELS&o=CURRENT_REVISION&o=CURRENT_COMMIT&o=CURRENT_FILES`;
    
    let response;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        response = await chrome.runtime.sendMessage({ 
          type: "fetchGerritChanges", 
          url: detailedUrl,
          gerritUrl: gerritUrl
        });
      } else {
        // 模拟环境下返回测试数据
        throw new Error('Chrome扩展环境不可用，无法获取数据');
      }
    } catch (error) {
      console.error('获取变更详情失败:', error);
      throw new Error('网络请求失败');
    }
    
    if (response && response.ok) {
      // 移除前缀字符 )]}'
      const cleanData = response.data.replace(/^\)\]\}'\n?/, '');
      const detailedChange = JSON.parse(cleanData);
      
      // 先显示基本信息
      renderChangeDetail(detailedChange);
      
      // 异步加载文件变更详情
      loadFileChanges(gerritUrl, detailedChange);
      
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

// 加载文件变更详情
async function loadFileChanges(gerritUrl, change) {
  try {
    // 使用当前修订版本而不是随机选择
    const rev = change.current_revision;
    if (!rev) {
      console.warn('未找到当前修订版本');
      return;
    }
    
    const revision = change.revisions?.[rev];
    if (!revision || !revision.files) {
      console.warn('未找到文件信息');
      return;
    }
    
    const files = revision.files;
    const pairs = Object.entries(files).filter(([p]) => p !== '/PATCHSET_LEVEL');
    await waitForFileBlocks(pairs.map(([p]) => p)); // 等待文件块出现，使用过滤后的路径列表
    setStatus(`正在加载 ${pairs.length} 个文件的变更详情...`);
    
    // 逐个加载文件的diff内容
    for (const [path, info] of pairs) {
      // 处理文件重命名情况
      const reqPath = info.old_path && info.type === 'RENAMED' ? info.old_path : path;
      const diffData = await fetchFileDiff(gerritUrl, change._number, rev, reqPath);
      
      // 处理二进制文件或过大文件
      let content = null;
      if (diffData?.binary) {
        content = [{ type: 'separator', text: '(binary file)' }];
      } else if (diffData?.intraline_status === 'ERROR') {
        content = [{ type: 'separator', text: '(diff too large)' }];
      } else if (diffData) {
        content = parseDiffContent(diffData);
      }
      
      // 更新UI显示已加载的文件
      await updateFileDiffUI(path, content);
    }
    
    setStatus(`已加载所有文件变更详情`);
  } catch (error) {
    console.error('加载文件变更详情失败:', error);
    setStatus(`加载文件变更详情失败: ${error.message}`);
  }
}

// CSS简单转义函数
function cssEscapeSimple(s) { return s.replace(/["\\]/g, '\\$&'); }



// 渲染变更详情
// 修复renderChangeDetail函数中的HTML标签闭合问题
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
  if (change.current_revision && change.revisions && change.revisions[change.current_revision] && change.revisions[change.current_revision].files) {
    const rev = change.current_revision;
    const currentRevision = change.revisions[rev];
    const files = currentRevision.files;
    
    changesHtml = Object.entries(files).map(([path, fileInfo]) => {
      // 跳过Gerrit虚拟文件
      if (path === '/PATCHSET_LEVEL') return '';
      
      let icon = '📄';
      if (fileInfo.type === 'DELETED') {
        icon = '🗑️';
      } else if (fileInfo.type === 'ADDED') {
        icon = '✚';
      } else if (fileInfo.type === 'MODIFIED') {
        icon = '📝';
      }
      
      const key = pathKey(path);
      return `
        <div class="gerrit-detail-change" data-key="${key}">
          <span class="gerrit-detail-change-icon">${icon}</span>
          <span class="gerrit-detail-change-path">${path}</span>
          <div class="gerrit-file-diff">
            <div class="gerrit-diff-loading">加载中...</div>
          </div>
        </div>
      `;
    }).join('');
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
    <style>
      .gerrit-file-diff {
        margin-top: 4px;
        margin-left: 20px;
        font-family: monospace;
        font-size: 13px;
        line-height: 1.4;
      }
      
      .gerrit-diff-loading {
        color: var(--text-muted);
        font-style: italic;
      }
      
      .gerrit-diff-empty {
        color: var(--text-muted);
        font-style: italic;
      }
      
      .gerrit-diff-content {
        max-height: 300px;
        overflow-y: auto;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background-color: var(--bg-tertiary);
      }
      
      .gerrit-diff-context {
        color: var(--text-primary);
        padding: 2px 4px;
        border-left: 3px solid transparent;
      }
      
      .gerrit-diff-delete {
        color: var(--error);
        background-color: rgba(239, 68, 68, 0.1);
        padding: 2px 4px;
        border-left: 3px solid var(--error);
      }
      
      .gerrit-diff-add {
        color: var(--success);
        background-color: rgba(34, 197, 94, 0.1);
        padding: 2px 4px;
        border-left: 3px solid var(--success);
      }
      
      .gerrit-diff-separator {
        text-align: center;
        color: var(--text-muted);
        padding: 2px 0;
      }
      
      .gerrit-diff-prefix {
        display: inline-block;
        width: 12px;
        margin-right: 4px;
        text-align: center;
        font-weight: bold;
      }
    </style>
    
    <div class="gerrit-detail-header">
      <div>
        <div class="gerrit-detail-title">${change.subject}</div>
        <div style="display: flex; gap: 8px; margin-top: 4px;">
          <span class="gerrit-item-status ${statusClass}">${statusText}</span>
          <span style="color: var(--text-muted); font-size: 14px;">#${change._number}</span>
        </div>
      </div>
      <div class="gerrit-detail-actions">
        <a href="${changeUrl}" target="_blank" class="gerrit-detail-btn" id="gerrit-jump-link">
          跳转
        </a>
      </div>
    </div>
    
    <div class="gerrit-detail-content">
      <div class="gerrit-detail-section">
        <div class="gerrit-detail-section-title">提交信息</div>
        <div class="gerrit-detail-message">
          ${change.current_revision && change.revisions && change.revisions[change.current_revision] && change.revisions[change.current_revision].commit && change.revisions[change.current_revision].commit.message || '无提交信息'}
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

// 更新文件变更的UI显示，使用key精确选择
async function updateFileDiffUI(filePath, diffContent) {
  const key = pathKey(filePath);
  let el = null;
  for (let i = 0; i < 10 && !el; i++) {
    el = document.querySelector(`.gerrit-detail-change[data-key="${key}"]`);
    if (!el) await wait(50);
  }
  
  if (!el) {
    console.warn('未找到文件块 path=', filePath, 'key=', key);
    return;
  }
  
  let box = el.querySelector('.gerrit-file-diff');
  if (!box) {
    box = document.createElement('div');
    box.className = 'gerrit-file-diff';
    el.appendChild(box);
  }
  
  if (!diffContent || !diffContent.length) {
    box.innerHTML = '<div class="gerrit-diff-empty">无法加载文件变更详情</div>';
    return;
  }
  
  let html = '<div class="gerrit-diff-content">';
  for (const line of diffContent) {
    if (line.type === 'separator') {
      html += `<div class="gerrit-diff-separator">${line.text}</div>`;
      continue;
    }
    
    const cls = line.type === 'add' ? 'gerrit-diff-add'
              : line.type === 'delete' ? 'gerrit-diff-delete'
              : 'gerrit-diff-context';
    
    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
    
    const esc = String(line.text)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    
    html += `<div class="${cls}"><span class="gerrit-diff-prefix">${prefix}</span>${esc}</div>`;
  }
  
  html += '</div>';
  box.innerHTML = html;
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
  
  // 关闭详情模态框
  closeDetailModal.addEventListener('click', () => {
    gerritDetailModal.style.display = 'none';
    currentSelectedChange = null;
    // 移除选择高亮
    const selectedItems = document.querySelectorAll('.gerrit-item.active');
    selectedItems.forEach(item => item.classList.remove('active'));
  });
  
  // 保存设置
  saveSettingsBtn.addEventListener('click', saveSettings);
  
  // 点击模态框外部关闭
  window.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    } else if (e.target === gerritDetailModal) {
      gerritDetailModal.style.display = 'none';
      currentSelectedChange = null;
      // 移除选择高亮
      const selectedItems = document.querySelectorAll('.gerrit-item.active');
      selectedItems.forEach(item => item.classList.remove('active'));
    }
  });

  // 阻止事件冒泡
  if (gerritDetailModal) {
    const modalContent = gerritDetailModal.querySelector('.ai-insight-modal-content');
    if (modalContent) {
      modalContent.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
  }
  
  // ESC键关闭模态框
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (settingsModal.style.display === 'block') {
        settingsModal.style.display = 'none';
      } else if (gerritDetailModal.style.display === 'flex') {
        gerritDetailModal.style.display = 'none';
        // 清除选中状态
        currentSelectedChange = null;
        // 移除选择高亮
        const selectedItems = document.querySelectorAll('.gerrit-item.active');
        selectedItems.forEach(item => item.classList.remove('active'));
      }
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
  
  // 添加跳转链接的事件处理
  const jumpLink = document.getElementById('gerrit-jump-link');
  if (jumpLink) {
    jumpLink.addEventListener('click', (e) => {
      // 在打开新标签页前，确保当前标签页的面板状态被保存
      if (typeof window.switchToPanel === 'function') {
        // 如果存在switchToPanel函数，直接调用它保存当前面板状态
        try {
          window.switchToPanel('gerrit-panel');
        } catch (error) {
          console.warn('调用switchToPanel失败:', error);
        }
      } else if (typeof chrome !== 'undefined' && chrome.runtime) {
        // 否则使用chrome.runtime.sendMessage
        try {
          chrome.runtime.sendMessage({
            type: "switchPanel", 
            name: "gerrit-panel"
          });
        } catch (error) {
          console.warn('发送switchPanel消息失败:', error);
        }
      }
    });
  } else {
    // 如果跳转链接不存在，添加一个延时检查
    setTimeout(() => {
      const delayedJumpLink = document.getElementById('gerrit-jump-link');
      if (delayedJumpLink) {
        delayedJumpLink.addEventListener('click', (e) => {
          if (typeof window.switchToPanel === 'function') {
            try {
              window.switchToPanel('gerrit-panel');
            } catch (error) {
              console.warn('调用switchToPanel失败:', error);
            }
          } else if (typeof chrome !== 'undefined' && chrome.runtime) {
            try {
              chrome.runtime.sendMessage({
                type: "switchPanel", 
                name: "gerrit-panel"
              });
            } catch (error) {
              console.warn('发送switchPanel消息失败:', error);
            }
          }
        });
      }
    }, 500);
  }
  
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