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

  // 监听来自service worker的日志消息
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'rocket:displayLog' || msg?.type === 'rocket:statusLog') {
      log(msg.message);
    }
  });



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
    const tab = await getActiveTab();
    if (!tab) { log('无活动标签页'); return; }

    const url = tab.url || '';
    const ok = /^https:\/\/.+?tp\-link\.com\.cn\//i.test(url);
    if (!ok) { log('当前页不在 Rocket 域名，忽略'); return; }

    // 读配置（确保已落库）
    const got = await chrome.storage.local.get({ 'rocketMsgLimit': 20, 'rocketPrompt': '' });
    const limit = Math.max(1, Math.min(200, Number(got['rocketMsgLimit'] || 20)));
    const prompt = got['rocketPrompt'] || '';

    setBadge('请求中', false);
    log(`开始生成：limit=${limit}，prompt=${prompt ? '自定义' : '预置'}`);

    chrome.tabs.sendMessage(
      tab.id,
      { type: 'rocket:generate', limit, promptOverride: prompt },
      (resp) => {
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
        setBadge('完成', true);
      }
    );
  });
})();
