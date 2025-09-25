/* panels/rocket/panel.js — 只记录运行状态，不记录聊天文本 */
(async () => {
  const $ = s => document.querySelector(s);
  const statusEl = $('#status');
  const badgeEl  = $('#badge');
  const $limit   = $('#msgLimit');
  const $prompt  = $('#prompt');

  const ts = () => {
    const d=new Date(); const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const log = (line) => { statusEl.textContent += `[${ts()}] ${line}\n`; statusEl.scrollTop = statusEl.scrollHeight; };
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

  // --- storage keys
  const K = { limit: 'rocketMsgLimit', prompt: 'rocketPrompt' };

  // --- load & hydrate
  chrome.storage.local.get({ [K.limit]: 20, [K.prompt]: '' }, got => {
    $limit.value = Number(got[K.limit] || 20);
    $prompt.value = got[K.prompt] || '';
  });

  // --- helpers
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // --- save config
  $('#btnSave').addEventListener('click', async () => {
    const limit = Math.max(1, Math.min(200, Number($limit.value || 20)));
    const prompt = $prompt.value || '';
    await chrome.storage.local.set({ [K.limit]: limit, [K.prompt]: prompt });
    log(`配置已保存：limit=${limit}，prompt=${prompt ? '自定义' : '预置'}`);
    setBadge('已保存', true);
  });

  // --- clear status
  $('#btnClear').addEventListener('click', () => { statusEl.textContent = ''; setBadge('空闲', false); });

  // --- trigger generation
  $('#btnGen').addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (!tab) { log('无活动标签页'); return; }

    const url = tab.url || '';
    const ok = /^https:\/\/.+?tp\-link\.com\.cn\//i.test(url);
    if (!ok) { log('当前页不在 Rocket 域名，忽略'); return; }

    // 读配置（确保已落库）
    const got = await chrome.storage.local.get({ [K.limit]: 20, [K.prompt]: '' });
    const limit = Math.max(1, Math.min(200, Number(got[K.limit] || 20)));
    const prompt = got[K.prompt] || '';

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
