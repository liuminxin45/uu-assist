/* panels/rocket/panel.js — 只记录运行状态，不记录聊天文本 */
import { persistField } from '../../shared/persist.js';

(async () => {
  const $ = s => document.querySelector(s);
  const statusEl = $('#status');
  const badgeEl  = $('#badge');
  const $limit   = $('#msgLimit');
  const $prompt  = $('#prompt');
  const $autoListen = $('#autoListen');
  const $userName = $('#userName');

  const ts = () => {
    const d=new Date(); const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const log = (line) => { 
    // 确保完整显示所有内容，不做任何截断
    statusEl.textContent += `[${ts()}] ${line}\n`; 
    statusEl.scrollTop = statusEl.scrollHeight; 
  };
  const setBadge = (t, ok) => {
    badgeEl.textContent = t;
    badgeEl.style.background = ok ? '#ecfdf5' : '#eef2ff';
    badgeEl.style.color = ok ? '#065f46' : '#3730a3';
    badgeEl.style.borderColor = ok ? '#a7f3d0' : '#c7d2fe';
  };

  // 获取当前AI供应商和模型信息
  async function getCurrentAIInfo() {
    try {
      const data = await chrome.storage.local.get(['aiCfg2']);
      if (data.aiCfg2 && data.aiCfg2.vendors) {
        const aiCfg2 = data.aiCfg2;
        const activeVendorId = aiCfg2.activeVendorId;
        const vendor = aiCfg2.vendors[activeVendorId];
        if (vendor) {
          const activeModelId = vendor.activeModelId;
          const model = vendor.models[activeModelId];
          if (model) {
            return {
              vendor: vendor.name,
              model: model.name || model.model
            };
          }
        }
      }
    } catch (e) {
      console.error('获取AI信息失败:', e);
    }
    return { vendor: '未知', model: '未知' };
  }

  // 更新状态标签显示AI供应商和模型
  async function updateBadgeWithAIInfo() {
    const aiInfo = await getCurrentAIInfo();
    setBadge(`${aiInfo.vendor} | ${aiInfo.model}`, true);
  }

  // 监听来自service worker的日志消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'rocket:displayLog' || msg?.type === 'rocket:statusLog') {
      log(msg.message);
    }
  });

  // 页面加载时更新状态标签
  updateBadgeWithAIInfo();

  // 监听存储变化以更新状态标签
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && (changes.aiCfg2 || changes.aiCfg)) {
      updateBadgeWithAIInfo();
    }
  });

  // --- 请求状态跟踪
  let isRequestInProgress = false;
  
  // --- helpers
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }
  
  // --- 通知内容脚本更新配置
  async function notifyContentScript() {
    try {
      const tab = await getActiveTab();
      if (tab && /^https:\/\/.+?tp\-link\.com\.cn\//i.test(tab.url || '')) {
        chrome.tabs.sendMessage(tab.id, { type: 'rocket:updateConfig' });
      }
    } catch (e) {
      // 忽略错误
    }
  }

  // --- 监听配置变更并通知内容脚本
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      notifyContentScript();
      // 页面重新可见时也更新状态标签
      updateBadgeWithAIInfo();
    }
  });
  
  // 为各个输入元素实现持久化
  persistField($limit, 'rocketMsgLimit');
  persistField($autoListen, 'rocketAutoListen');
  persistField($userName, 'rocketUserName');
  
  // 为需要持久化的元素添加变更监听以通知内容脚本
  $limit.addEventListener('change', notifyContentScript);
  $autoListen.addEventListener('change', notifyContentScript);
  $userName.addEventListener('change', notifyContentScript);
  
  // --- trigger generation
  $('#btnGen').addEventListener('click', async () => {
    // 检查是否已有请求在执行
    if (isRequestInProgress) {
      log('已有请求执行中，本次请求失败');
      return;
    }
    
    const tab = await getActiveTab();
    if (!tab) { log('无活动标签页'); return; }

    const url = tab.url || '';
    const ok = /^https:\/\/.+?tp\-link\.com\.cn\//i.test(url);
    if (!ok) { log('当前页不在 Rocket 域名，忽略'); return; }

    // 读配置（确保已落库）
    const got = await chrome.storage.local.get({ 'rocketMsgLimit': 20, 'rocketPrompt': '', 'rocketUserName': '刘民心' });
    const limit = Math.max(1, Math.min(200, Number(got['rocketMsgLimit'] || 20)));
    const prompt = got['rocketPrompt'] || '';
    const userName = got['rocketUserName'] || '刘民心';

    // 设置请求状态为进行中
    isRequestInProgress = true;
    // 保存原始状态文本
    const originalBadgeText = badgeEl.textContent;
    setBadge('请求中', false);
    log(`开始生成：limit=${limit}，prompt=${prompt ? '自定义' : '预置'}`);

    chrome.tabs.sendMessage(
      tab.id,
      { type: 'rocket:generate', limit, promptOverride: prompt, userName },
      (resp) => {
        // 请求完成，无论成功失败都重置状态
        try {
          if (chrome.runtime.lastError) {
            log(`失败：${chrome.runtime.lastError.message || '未知错误'}`);
            setBadge('失败', false);
            return;
          }
          if (!resp || !resp.ok) {
            log(`失败：${resp?.error || '内容脚本未响应'}`);
            setBadge('失败', false);
            return;
          }
          // 只记录状态，不记录聊天和 AI 文本
          log(`成功：AI 已完成生成并写入候选；tokens≈${resp.tokens || '-'}`);
          // 恢复显示AI供应商和模型信息
          setBadge(originalBadgeText, true);
        } finally {
          // 确保状态重置，即使发生异常
          isRequestInProgress = false;
        }
      }
    );
  });
})();
