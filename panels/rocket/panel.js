/* panels/rocket/panel.js — 只记录运行状态，不记录聊天文本 */
import { persistField } from '../../shared/persist.js';

(async () => {
  const $ = s => document.querySelector(s);
  const statusEl = $('#status');
  const $limit   = $('#msgLimit');
  const $prompt  = $('#prompt');
  const $autoListen = $('#autoListen');
  const aiReplyEl = $('#aiReply');
  const btnCopyAIReply = $('#btnCopyAIReply');
  const btnClearAIReply = $('#btnClearAIReply');

  const ts = () => {
    const d=new Date(); const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const log = (line) => { 
    // 确保完整显示所有内容，不做任何截断
    statusEl.textContent += `[${ts()}] ${line}\n`; 
    statusEl.scrollTop = statusEl.scrollHeight; 
  };



  // 监听来自service worker的消息
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg?.type === 'rocket:displayLog' || msg?.type === 'rocket:statusLog') {
        log(msg.message);
      }
      // 处理AI回复内容
      else if (msg?.type === 'rocket:aiReply') {
        if (msg.content) {
          displayAIReply(msg.content);
        }
      }
    });
  } else {
    console.log('当前环境不是Chrome扩展，无法使用runtime API');
  }
  
  // 显示AI回复内容
  function displayAIReply(content) {
    aiReplyEl.value = content;
    // 滚动到底部以显示最新内容
    aiReplyEl.scrollTop = aiReplyEl.scrollHeight;
  }
  
  // 复制AI回复到剪贴板
  btnCopyAIReply.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(aiReplyEl.value);
      log('AI回复已复制到剪贴板');
      // 显示临时提示
      const originalText = btnCopyAIReply.textContent;
      btnCopyAIReply.textContent = '已复制';
      setTimeout(() => {
        btnCopyAIReply.textContent = originalText;
      }, 2000);
    } catch (err) {
      log(`复制失败：${err.message}`);
    }
  });
  
  // 清空AI回复
  btnClearAIReply.addEventListener('click', () => {
    aiReplyEl.value = '';
    log('AI回复已清空');
  });



  // --- helpers
  async function getActiveTab() {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        return tab;
      } catch (e) {
        console.warn('获取活动标签页失败:', e);
        return null;
      }
    }
    return null;
  }
  
  // --- 通知内容脚本更新配置
  async function notifyContentScript() {
    if (typeof chrome === 'undefined' || !chrome.tabs) {
      return;
    }
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
  persistField($prompt, 'rocketPrompt');
  
  // 为需要持久化的元素添加变更监听以通知内容脚本
  $limit.addEventListener('change', notifyContentScript);
  $autoListen.addEventListener('change', notifyContentScript);
  $prompt.addEventListener('change', notifyContentScript);
  
  // 下拉菜单功能由公共组件 shared/dropdown-menu.js 提供
})();
