/* sw.js v0.7.3 */
const stripXSSI = t => String(t || "")
  .replace(/^\uFEFF/, "")                         // BOM
  .replace(/^\)\]\}'[^\n]*\n?/, "")               // Gerrit: )]}'
  .replace(/^\s*for\s*\(\s*;;\s*\)\s*;?\s*/i, "") // Phabricator: for (;;);
  .trim();
// 统一解析辅助：返回 { ok, status, data } 或 { ok:false, status, error, snippet }
async function parseJsonResponse(resp) {
  const txt = await resp.text();
  const clean = stripXSSI(txt);
  try {
    const data = JSON.parse(clean);
    return { ok: true, status: resp.status, data };
  } catch (e) {
    return { ok: false, status: resp.status, error: "JSON解析失败", snippet: clean.slice(0, 300) };
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

const oneShot = (sendResponse) => { let done = false; return (p) => { if (!done) { done = true; try { sendResponse(p); } catch (_) { } } }; };
async function waitComplete(tabId, tries = 60, interval = 200) {
  for (let i = 0; i < tries; i++) { try { const t = await chrome.tabs.get(tabId); if (t?.status === "complete") return; } catch (_) { } await sleep(interval); }
}
async function ensureTab(url) {
  const base = url.split("#")[0];
  const ts = await chrome.tabs.query({ url: base + "*" });
  return ts[0] || await chrome.tabs.create({ url, active: false });
}
async function ensureCS(tabId) {
  // 先探测
  try { await chrome.tabs.sendMessage(tabId, { type: "ping" }); return; } catch (_) { }
  // 未注入则动态注入
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content_script.js"] });
  // 再探测一次
  await chrome.tabs.sendMessage(tabId, { type: "ping" });
}
async function sendMsgWithTimeout(tabId, msg, timeoutMs = 20000) {
  return await Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_, rej) => setTimeout(() => rej(new Error("content_script timeout")), timeoutMs))
  ]);
}


function stripXSSIPrefix(t) {
  if (!t) return "";
  // trim leading whitespace and any 'for (;;);' prefix
  t = t.replace(/^\uFEFF/, "");
  t = t.replace(/^\s*for\s*\(\s*;;\s*\);\s*/i, "");
  return t;
}
function relaxParseJSON(t) {
  t = stripXSSIPrefix(t);
  // try direct
  try { return JSON.parse(t); } catch (_) { }
  // slice to first '{' and last '}' if exists
  const i = t.indexOf("{"); const j = t.lastIndexOf("}");
  if (i >= 0 && j > i) {
    const s = t.slice(i, j + 1);
    try { return JSON.parse(s); } catch (_) { }
  }
  // as last resort, return null
  return null;
}
function grepIdAndUri(t) {
  let id = null, uri = null;
  try {
    const mId = t.match(/"id"\s*:\s*(\d{2,})/);
    if (mId) id = mId[1];
    const mUri = t.match(/"uri"\s*:\s*"([^"]+)"/);
    if (mUri) uri = mUri[1];
  } catch (_) { }
  return { id, uri };
}


// ==== track last active tab id (for sidePanel) ====
let lastTabId = null;

async function spSetLastTab(tabId) {
  if (!tabId) return;
  lastTabId = tabId;
  try { await chrome.storage.session.set({ __uu_assist_last_tab_id: tabId }); } catch (_) { }
}
async function spGetLastTabFromSession() {
  try {
    const o = await chrome.storage.session.get('__uu_assist_last_tab_id');
    return o?.__uu_assist_last_tab_id || null;
  } catch (_) { return null; }
}
async function spGetStableTabId(sender) {
  // side panel 页面 sender.tab 为空；content script/图标点击会带
  if (sender?.tab?.id) { await spSetLastTab(sender.tab.id); return sender.tab.id; }
  if (lastTabId) return lastTabId;
  const fromSess = await spGetLastTabFromSession();
  if (fromSess) { lastTabId = fromSess; return fromSess; }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id) { await spSetLastTab(tab.id); return tab.id; }
  return null;
}

// 初始化与持续更新
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await spSetLastTab(tabId);

  // 恢复标签页的面板状态，但避免不必要的重置
  if (tabId) {
    try {
      const panelName = await getCurrentTabPanelState(tabId);

      // 检查当前标签页是否已经有相同的面板打开
      try {
        const currentOptions = await chrome.sidePanel.getOptions({ tabId: tabId });
        const currentPanelName = Object.keys(PANEL_PATHS).find(key => PANEL_PATHS[key] === currentOptions.path) || "pha-panel";

        // 只有当当前面板名称与存储的不同时，才切换面板
        if (currentPanelName !== panelName) {
          await openPanelByName(panelName, tabId, { fromSidePanel: false });
        }
      } catch (sidePanelError) {
        // 如果获取当前面板选项失败，则直接打开存储的面板
        console.warn(`获取当前面板选项失败:`, sidePanelError);
        await openPanelByName(panelName, tabId, { fromSidePanel: false });
      }
    } catch (error) {
      console.warn(`恢复标签页 ${tabId} 的面板状态失败:`, error);
    }
  }
});
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  if (tab?.id) {
    await spSetLastTab(tab.id);

    // 恢复标签页的面板状态，但避免不必要的重置
    try {
      const panelName = await getCurrentTabPanelState(tab.id);

      // 检查当前标签页是否已经有相同的面板打开
      try {
        const currentOptions = await chrome.sidePanel.getOptions({ tabId: tab.id });
        const currentPanelName = Object.keys(PANEL_PATHS).find(key => PANEL_PATHS[key] === currentOptions.path) || "pha-panel";

        // 只有当当前面板名称与存储的不同时，才切换面板
        if (currentPanelName !== panelName) {
          await openPanelByName(panelName, tab.id, { fromSidePanel: false });
        }
      } catch (sidePanelError) {
        // 如果获取当前面板选项失败，则直接打开存储的面板
        console.warn(`获取当前面板选项失败:`, sidePanelError);
        await openPanelByName(panelName, tab.id, { fromSidePanel: false });
      }
    } catch (error) {
      console.warn(`恢复标签页 ${tab.id} 的面板状态失败:`, error);
    }
  }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === lastTabId) {
    lastTabId = null;
    try { await chrome.storage.session.remove('__uu_assist_last_tab_id'); } catch (_) { }
  }

  // 清理已关闭标签页的面板状态
  await cleanupTabPanelState(tabId);
});

// 新标签页创建时自动应用默认面板状态
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.id) {
    // 延迟一小段时间，确保标签页完全加载
    setTimeout(async () => {
      try {
        // 新标签页使用默认面板
        await openPanelByName("pha-panel", tab.id, { fromSidePanel: false });
        // 保存新标签页的面板状态
        await saveTabPanelState(tab.id, "pha-panel");
      } catch (error) {
        console.warn(`为新标签页 ${tab.id} 设置面板失败:`, error);
      }
    }, 100);
  }
});



chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
  }

  // 创建右键菜单
  chrome.contextMenus.create({
    id: "add-to-notes",
    title: "添加到 Notes",
    contexts: ["selection", "image"],
    documentUrlPatterns: ["<all_urls>"]
  });
});

// 处理右键菜单点击事件
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "add-to-notes") {
    try {
      // 检查是否为受限制的域名
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
        console.warn('无法在受限制的域名上添加到Notes');
        // 对于受限制域名，我们不能直接在页面上显示toast，但可以记录日志并返回
        return;
      }

      // 准备要添加到笔记的数据
      let noteData = { type: 'text', text: '', imageUrl: null };

      // 添加来源信息
      noteData.url = tab.url;
      noteData.title = tab.title;

      // 处理图片
      if (info.mediaType === 'image' && info.srcUrl) {
        noteData.imageUrl = info.srcUrl;
        noteData.type = 'image';
      }

      // 处理选中文本
      if (info.selectionText) {
        noteData.text = info.selectionText;
        if (!noteData.imageUrl) {
          noteData.type = 'text';
        } else {
          noteData.type = 'text_image';
        }
      }

      // 首先尝试直接保存笔记到数据库（不依赖面板状态）
      const saveSuccess = await saveNoteDirectly(noteData);

      if (saveSuccess) {
        // 显示添加成功的toast提示
        await showToast(tab.id, '添加成功');

        // 同时尝试通知已打开的Notes面板（如果有的话）
        // 这样用户如果已经打开了面板，也能看到新添加的笔记
        try {
          await sendToNotesPanel(noteData);
        } catch (panelError) {
          // 即使通知面板失败也无所谓，因为笔记已经成功保存了
          console.log('通知面板失败，但笔记已成功保存:', panelError);
        }
      } else {
        // 如果直接保存失败，再尝试发送到Notes面板
        const panelSuccess = await sendToNotesPanel(noteData);

        if (panelSuccess) {
          // 显示添加成功的toast提示
          await showToast(tab.id, '添加成功');
        } else {
          // 如果两种方式都失败，保存到待处理队列
          await chrome.storage.local.set({
            pending_note_data: noteData
          });

          // 通知用户已保存待处理
          await showToast(tab.id, '已保存待添加到Notes');
        }
      }
    } catch (error) {
      console.error('添加到Notes失败:', error);
      await showToast(tab.id, '添加失败: ' + error.message);
    }
  }
});

// 发送数据到Notes面板
async function sendToNotesPanel(data) {
  try {
    // 在Service Worker中，我们不能直接访问视图
    // 尝试通过消息传递给所有打开的标签页和面板

    // 使用Promise来处理消息发送，设置超时时间
    return new Promise((resolve) => {
      // 标记是否收到了响应
      let responseReceived = false;

      // 尝试发送消息到Notes面板（通过runtime.sendMessage）
      chrome.runtime.sendMessage({
        type: 'add-note-from-context',
        data: data
      }, (response) => {
        // 处理响应
        responseReceived = true;

        // 检查响应是否成功
        if (response && response.ok === true) {
          resolve(true);
        } else {
          console.warn('Notes面板未成功处理消息:', response);
          resolve(false);
        }
      });

      // 处理消息发送失败的情况（如面板未打开）
      if (chrome.runtime.lastError) {
        console.warn('直接发送消息失败，可能Notes面板未打开:', chrome.runtime.lastError.message);
        resolve(false);
      }

      // 设置300毫秒超时，如果没有收到响应，视为发送失败
      setTimeout(() => {
        if (!responseReceived) {
          console.warn('发送消息到Notes面板超时，可能面板未打开');
          resolve(false);
        }
      }, 300);
    });
  } catch (error) {
    console.error('发送到Notes面板失败:', error);
    return false;
  }
}

// 直接保存笔记到数据库
async function saveNoteDirectly(data) {
  try {
    // 从存储中加载现有笔记
    const result = await chrome.storage.local.get('notes_data');
    let notes = result.notes_data || [];

    // 创建新笔记对象（与panel.js中格式保持一致）
    const newNote = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      content: data.text || '',
      isArchived: false
    };

    // 添加来源信息
    if (data.url && data.title) {
      newNote.sourceUrl = data.url;
      newNote.sourceTitle = data.title;
    }

    // 处理图片数据
    if (data.imageUrl) {
      try {
        // 尝试将图片转换为base64（简化版，实际可能需要更复杂的处理）
        const base64Data = await fetchImageAsDataURL(data.imageUrl);

        // 设置图片相关属性
        newNote.imagesData = [base64Data];
        newNote.isMultipleImages = true;
        newNote.hasImages = true;
        newNote.isImage = !data.text;
      } catch (imgError) {
        console.error('处理图片数据失败，将使用原始URL:', imgError);
        // 如果转换失败，使用原始URL
        newNote.imagesData = [data.imageUrl];
        newNote.isMultipleImages = true;
        newNote.hasImages = true;
        newNote.isImage = !data.text;
      }
    } else {
      newNote.isImage = false;
      newNote.hasImage = false;
      newNote.isMultipleImages = false;
    }

    // 添加到笔记列表开头
    notes.unshift(newNote);

    // 排序笔记（先显示未归档的，再显示归档的，按时间戳倒序）
    notes.sort((a, b) => {
      if (a.isArchived && !b.isArchived) return 1;
      if (!a.isArchived && b.isArchived) return -1;
      return b.timestamp - a.timestamp;
    });

    // 保存更新后的笔记列表
    await chrome.storage.local.set({ 'notes_data': notes });
    console.log('笔记已直接保存到数据库:', newNote);
    return true;
  } catch (error) {
    console.error('直接保存笔记失败:', error);
    return false;
  }
}

// 简化版的图片转base64函数
async function fetchImageAsDataURL(url) {
  return new Promise((resolve, reject) => {
    // 检查是否已经是data URL
    if (url.startsWith('data:image/')) {
      resolve(url);
      return;
    }

    // 对于普通URL，尝试获取图片（在Service Worker中，我们不能直接使用canvas）
    // 这里简化处理，直接返回URL，让面板在加载时处理
    resolve(url);
  });
}

// 显示toast提示
async function showToast(tabId, message) {
  try {
    // 首先获取标签页信息，检查URL是否为受限制域名
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://'))) {
      console.warn('无法在受限制的域名上显示toast');
      // 对于受限制域名，我们不能直接在页面上显示toast
      return;
    }

    // 对于非受限制域名，正常显示toast
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (msg) => {
        // 创建toast元素
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.top = '20px';
        toast.style.right = '20px';
        toast.style.padding = '12px 20px';
        toast.style.backgroundColor = msg.includes('失败') ? '#EF4444' : '#10B981';
        toast.style.color = 'white';
        toast.style.borderRadius = '8px';
        toast.style.zIndex = '9999';
        toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        toast.style.fontSize = '14px';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s ease';
        toast.textContent = msg;

        document.body.appendChild(toast);

        // 显示toast
        setTimeout(() => {
          toast.style.opacity = '1';
        }, 10);

        // 3秒后自动消失
        setTimeout(() => {
          toast.style.opacity = '0';
          setTimeout(() => {
            if (document.body.contains(toast)) {
              document.body.removeChild(toast);
            }
          }, 300);
        }, 3000);
      }
    });
  } catch (error) {
    console.error('显示toast失败:', error);
  }
}

function findInputValue(html, names) {
  for (const name of names) {
    const re = new RegExp(`<input[^>]*\\bname=["']` + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + `["'][^>]*\\bvalue=["']([^"']+)["'][^>]*>`, "i");
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}
function snippetOf(s) { return (s || "").replace(/\s+/g, " ").slice(0, 300); }

async function fetchText(url) {
  const r = await fetch(url, { credentials: "include", cache: "no-cache", redirect: "follow" });
  const t = await r.text();
  return { ok: r.ok, status: r.status, text: t };
}

// 查找所有打开的rocket-panel的标签页
async function findRocketPanelTabs() {
  const rocketPanelPath = chrome.runtime.getURL('panels/rocket/panel.html');
  const tabs = await chrome.tabs.query({});
  return tabs.filter(tab => tab.url === rocketPanelPath);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // 对于需要异步处理的消息类型，返回true以保持消息通道开放
  const asyncMessageTypes = ['fetchGerritChanges', 'fetchGerritDiff', 'rocket:statusLog', 'rocket:aiReply', 'fetchListPage', 'fetchTaskSummary', 'postComment', 'fetchGerritCommit', 'sumWorkload', 'uploadFile', 'switchPanel', 'cache:addPost', 'cache:queryByTask', 'cache:queryByTime', 'cache:deletePost', 'exportAllData', 'importAllData'];
  if (asyncMessageTypes.includes(msg.type)) {
    // 异步处理函数
    (async () => {
      try {
        // 处理Gerrit相关的fetch请求，支持变更和差异数据获取
        if (msg.type === 'fetchGerritChanges' || msg.type === 'fetchGerritDiff') {
          const r = await fetch(msg.url, {
            method: 'GET',
            credentials: 'include',           // 关键：带上 Cookie
            redirect: 'follow',
            cache: 'no-cache',
            headers: {
              'Accept': 'application/json'    // Gerrit REST 友好
            }
          });
          const text = await r.text();
          sendResponse({ ok: r.ok, status: r.status, data: text });
        }

        // 处理rocket:statusLog消息
        if (msg.type === "rocket:statusLog") {
          // 查找所有打开的rocket-panel标签页
          const rocketTabs = await findRocketPanelTabs();
          if (rocketTabs.length > 0) {
            // 向所有打开的rocket-panel发送日志消息
            rocketTabs.forEach(tab => {
              chrome.tabs.sendMessage(
                tab.id,
                { type: 'rocket:displayLog', message: msg.message }
              ).catch(() => {
                // 忽略错误，因为标签页可能已关闭或未准备好
              });
            });
          }
          sendResponse({ ok: true });
        }

        // 处理rocket:aiReply消息
        if (msg.type === "rocket:aiReply") {
          // 查找所有打开的rocket-panel标签页
          const rocketTabs = await findRocketPanelTabs();
          if (rocketTabs.length > 0) {
            // 向所有打开的rocket-panel发送AI回复内容
            rocketTabs.forEach(tab => {
              chrome.tabs.sendMessage(
                tab.id,
                { type: 'rocket:aiReply', content: msg.content }
              ).catch(() => {
                // 忽略错误，因为标签页可能已关闭或未准备好
              });
            });
          }
          sendResponse({ ok: true });
        }

        // 处理fetchListPage消息
        if (msg.type === "fetchListPage") {
          const { ok, status, text } = await fetchText(msg.url);
          sendResponse({ ok, status, text, snippet: snippetOf(text) });
          return;
        }

        // 处理guessTaskFromGerrit消息
        if (msg.type === "guessTaskFromGerrit") {
          try {
            const url = msg.url;
            const tab = await ensureTab(url);
            await waitComplete(tab.id);
            await ensureCS(tab.id);
            const r = await sendMsgWithTimeout(tab.id, { type: "extractTaskId" }, 12000);
            if (r?.ok && r.id) sendResponse({ ok: true, id: r.id });
            else sendResponse({ ok: false, error: r?.error || "not found" });
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
        }

        // 处理fetchTaskSummary消息
        if (msg.type === "fetchTaskSummary") {
          try {
            const url = msg.url;
            const r = await fetch(url, { credentials: "include", cache: "no-cache" });
            if (r.ok) {
              const text = await r.text();
              sendResponse({ ok: true, text });
            } else {
              sendResponse({ ok: false, error: `HTTP ${r.status}` });
            }
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
        }

        // 处理postComment消息
        if (msg.type === "postComment") {
          try {
            const g = await fetch(msg.taskUrl, { credentials: "include", cache: "no-cache", redirect: "follow" });
            const html = await g.text();
            if (!g.ok) { sendResponse({ ok: false, status: g.status, error: "GET 任务页失败", snippet: snippetOf(html) }); return; }
            const csrf = findInputValue(html, ["__csrf__", "_csrf_"]);
            if (!csrf) { sendResponse({ ok: false, error: "未找到CSRF令牌", snippet: snippetOf(html) }); return; }
            const draftVer = findInputValue(html, ["draft.version"]);
            const id = msg.taskId;
            const postUrl = `http://pha.tp-link.com.cn/maniphest/task/edit/${id}/comment/`;
            const form = new URLSearchParams();
            form.set("_csrf_", csrf);
            form.set("__form__", "1");
            form.set("__wflow__", "true");
            form.set("__ajax__", "true");
            form.set("__metablock__", "4");
            form.set("render", "1");
            if (draftVer) form.set("draft.version", draftVer);
            let comment = msg.content;
            if (typeof comment === "object") comment = JSON.stringify(comment);
            comment = String(comment || "").trim();
            if (!comment) { sendResponse({ ok: false, status: 400, error: "评论内容为空" }); return; }
            form.set("comment", comment);
            const r = await fetch(postUrl, {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-Requested-With": "XMLHttpRequest",         // 必须
                "X-Phabricator-Csrf": csrf,                    // 必须
                "Referer": msg.taskUrl                         // 有助于通过校验
              },
              body: form
            });
            const pr = await parseJsonResponse(r);
            if (!pr.ok) { sendResponse({ ok: false, status: pr.status, error: pr.error, snippet: pr.snippet }); return; }
            const data = pr.data || {};
            // 成功判据：error 为 null 或未给出，且出现以下任一信号
            const redirected = data?.payload?.redirect || data?.workflow?.redirectURI || data?.redirect || null;
            const logicalOk =
              (data?.error == null) && (
                redirected ||
                data?.payload?.objectPHID ||
                (Array.isArray(data?.transactions)) ||
                (Array.isArray(data?.payload?.transactions)) ||
                !!data?.markup
              );
            if (!logicalOk) {
              sendResponse({ ok: false, status: pr.status, error: "服务器未确认写入", snippet: JSON.stringify(data).slice(0, 300) });
              return;
            }
            sendResponse({ ok: true, status: pr.status, data, redirect: redirected });


          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
          }
        }

        // 处理fetchGerritCommit消息
        if (msg.type === "fetchGerritCommit") {
          try {
            async function getCommitWithRetry(url, tries = 5) {
              let last = {};
              for (let i = 0; i < tries; i++) {
                try {
                  const r = await fetch(url, { headers: { Accept: "application/json" }, credentials: "include" });
                  if (r.ok) {
                    const pr = await parseJsonResponse(r);
                    if (pr.ok) return pr.data;
                    last = { ok: false, status: pr.status, error: pr.error, snippet: pr.snippet };
                  } else {
                    last = { ok: r.ok, status: r.status, error: await r.text() };
                  }
                } catch (e) { last = { error: String(e) }; }
                if (i < tries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
              }
              throw last;
            }

            const first = await getCommitWithRetry(msg.api);
            if (first.status === 404) { sendResponse({ ok: false, status: 404 }); return; }

            // 检查是否需要获取父提交
            if (!first.commit || !first.commit.parents || first.commit.parents.length === 0) {
              sendResponse({ ok: true, commit: first, parent: null });
              return;
            }

            // 获取第一个父提交
            const parentApi = msg.api.replace(/\/\d+$/, "/" + (parseInt(msg.api.split("/")?.pop() || "1") - 1));
            const parent = await getCommitWithRetry(parentApi);
            sendResponse({ ok: true, commit: first, parent });
          } catch (e) {
            sendResponse({ ok: false, error: e?.error || e?.message || String(e) });
          }
        }

        // 处理uploadFile消息
        if (msg.type === "uploadFile") {
          try {
            function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
            async function openOrFocusPHA() {
              const tabs = await chrome.tabs.query({ url: ["http://pha.tp-link.com.cn/*"] });
              if (tabs && tabs.length) {
                const ready = tabs.find(t => t.status === "complete") || tabs[0];
                return ready.id;
              }
              const t = await chrome.tabs.create({ url: "http://pha.tp-link.com.cn/" });
              return t.id;
            }
            async function waitTabComplete(tabId, tries = 40) {
              for (let i = 0; i < tries; i++) {
                try {
                  const t = await chrome.tabs.get(tabId);
                  if (t && t.status === "complete") return true;
                } catch (_) { }
                await delay(100);
              }
              return false;
            }
            async function ensureCS(tabId) {
              try {
                const pong = await chrome.tabs.sendMessage(tabId, { cs: "fetchText", url: "http://pha.tp-link.com.cn/" });
                if (pong) return true;
              } catch (_) { }
              try {
                await chrome.scripting.executeScript({ target: { tabId }, files: ["cs.js"] });
                return true;
              } catch (e) {
                return false;
              }
            }
            async function getCsrf(tabId) {
              const r = await chrome.tabs.sendMessage(tabId, { cs: "fetchText", url: "http://pha.tp-link.com.cn/" }).catch(() => null);
              if (!r?.ok) return null;
              const m = (r.text || "").match(/name=['"](?:__csrf__|_csrf_)['"][^>]*value=['"]([^'"]+)['"]/i);
              return m ? m[1] : null;
            }

            const tabId = await openOrFocusPHA();
            await waitTabComplete(tabId);
            const csReady = await ensureCS(tabId);
            if (!csReady) { sendResponse({ ok: false, error: "内容脚本未就绪" }); return; }

            let csrf = await getCsrf(tabId);
            if (!csrf) {
              try { await chrome.tabs.reload(tabId); } catch (_) { }
              await waitTabComplete(tabId);
              await ensureCS(tabId);
              csrf = await getCsrf(tabId);
            }
            if (!csrf) { sendResponse({ ok: false, error: "无法获取CSRF" }); return; }

            const bytes = new Uint8Array(msg.bytes || []);
            const mime = msg.mime || "application/octet-stream";
            const fname = (msg.filename && msg.filename.trim()) || ("pasted_" + Date.now() + ".bin");

            const q = new URLSearchParams();
            q.set("name", fname);
            q.set("length", String(bytes.length));
            q.set("__upload__", "1");
            q.set("__ajax__", "true");
            q.set("__metablock__", "4");
            const url = "http://pha.tp-link.com.cn/file/dropupload/?" + q.toString();
            const headers = {
              "Content-Type": mime,
              "Accept": "*/*",
              "X-Phabricator-Csrf": csrf,
              "X-Requested-With": "XMLHttpRequest"
            };
            if (msg.via) headers["X-Phabricator-Via"] = msg.via;

            const res = await chrome.tabs.sendMessage(tabId, { cs: "rawUpload", url, headers, bytes: Array.from(bytes) }).catch(err => ({ ok: false, error: String(err) }));
            if (!res?.ok) { sendResponse({ ok: false, status: res?.status, error: res?.error || "rawUpload失败" }); return; }

            let t = res.text || "";
            t = stripXSSIPrefix(t);
            let monogram = null, fUrl = null, err = null;
            // 宽松解析
            let data = relaxParseJSON(t);
            if (data && data.error) { err = data.error.code + ": " + data.error.info; }
            if (data) {
              const f = (data.files && data.files[0]) || data.payload || data;
              monogram = (f && (f.objectName || f.monogram)) || (f && f.id ? ("F" + f.id) : null) || null;
              fUrl = (f && (f.uri || f.url)) || null;
            }
            // 兜底正则
            if (!monogram || !fUrl) {
              const g = grepIdAndUri(t);
              if (!monogram && g.id) monogram = "F" + g.id;
              if (!fUrl && g.uri) fUrl = g.uri;
            }
            if (monogram || fUrl) { sendResponse({ ok: true, status: res.status, monogram, url: fUrl, snippet: snippetOf(t) }); return; }
            sendResponse({ ok: false, status: res.status, error: "dropupload未返回文件ID", snippet: snippetOf(t) });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          return;
        }

        // 面板请求切换
        if (msg?.type === "switchPanel") {
          try {
            // 获取当前标签页ID
            const tabId = await spGetStableTabId(sender);

            if (tabId) {
              // 保存当前标签页的面板状态
              await saveTabPanelState(tabId, msg.name);

              // 只对当前标签页应用面板切换
              try {
                await openPanelByName(msg.name, tabId, { fromSidePanel: false });
                sendResponse({ ok: true, appliedTo: 1 });
              } catch (error) {
                console.warn(`为标签页 ${tabId} 设置面板失败:`, error);
                sendResponse({ ok: false, error: error.message });
              }
            } else {
              sendResponse({ ok: false, error: "无法获取当前标签页ID" });
            }
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          return;
        }

        // 数据库相关操作
        if (msg?.type === "cache:addPost") {
          try { const r = await dbAddPost(msg); sendResponse(r); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          return;
        }
        if (msg?.type === "cache:queryByTask") {
          try { const r = await dbQueryByTask(msg); sendResponse(r); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          return;
        }
        if (msg?.type === "cache:queryByTime") {
          try { const r = await dbQueryByTime(msg); sendResponse(r); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          return;
        }
        if (msg?.type === "cache:deletePost") {
          try { const r = await dbDeletePost(msg.id); sendResponse(r); } catch (e) { sendResponse({ ok: false, error: String(e) }); }
          return;
        }

        // 导出数据
        if (msg?.type === "exportAllData") {
          try {
            const blob = await exportAllData();
            sendResponse({ ok: true, blob });
          } catch (e) {
            sendResponse({ ok: false, error: String(e) });
          }
          return;
        }

        // 导入数据
        if (msg?.type === "importAllData") {
          try {
            const r = await importAllData(msg.payload);
            sendResponse({ ok: true, ...r });
          } catch (e) {
            sendResponse({ ok: false, error: String(e) });
          }
          return;
        }
      } catch (e) {
        console.error('onMessage 处理错误:', e);
        // 确保在错误情况下也发送响应
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();

    // 返回true保持消息通道开放，直到sendResponse被调用
    return true;
  }

  // 删除引用未定义html变量的错误代码段
  if (msg.type === "aiSummarize") {
    (async () => {
      const def = { aiCfg: null };
      const got = await chrome.storage.local.get(def).catch(() => def);
      const ai = got.aiCfg || {};
      const base = (ai.base || "https://api.deepseek.com/v1").replace(/\/+$/, "");
      const model = ai.model || "deepseek-chat";
      const key = ai.key || "";
      const sysPrompt = msg.prompt || ai.prompt || "你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁回复。以严格JSON返回：{\"title\":\"...\", \"reply\":\"...\"}";
      const userContent = msg.content || "";

      // 添加日志：显示当前使用的AI配置
      console.log("[AI Request] 使用的配置:", { base, model, key: key ? "[REDACTED]" : "未设置" });

      if (!key) { sendResponse({ ok: false, error: "缺少API Key" }); return; }
      const url = base + "/chat/completions";
      const payload = {
        model,
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: userContent }
        ]
      };

      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
          body: JSON.stringify(payload)
        });
        const txt = await r.text();

        if (!r.ok) {
          const snip = (typeof snippetOf === "function") ? snippetOf(txt) : (txt || "").slice(0, 400);
          sendResponse({ ok: false, status: r.status, error: "AI接口错误", snippet: snip });
          return;
        }

        let data = null; try { data = JSON.parse(txt); } catch (_) { if (typeof relaxParseJSON === "function") data = relaxParseJSON(txt); }
        const content = data?.choices?.[0]?.message?.content || "";
        const jsonText = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
        let obj = null; try { obj = JSON.parse(jsonText); } catch (_) { if (typeof relaxParseJSON === "function") obj = relaxParseJSON(jsonText); }

        const title = obj?.title ? String(obj.title) : "";
        const reply = obj?.reply ? String(obj.reply) : "";

        // usage 与 model 回传，便于面板统计
        const usage = data?.usage || null;           // {prompt_tokens, completion_tokens, total_tokens}
        const usedModel = data?.model || model;

        // 添加日志：显示实际使用的模型
        console.log("[AI Response] 实际使用的模型:", usedModel);

        sendResponse({ ok: true, title, reply, usage, model: usedModel });
        return;
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
        return;
      }
    })();
    return true; // 关键：保持消息通道，等待异步 sendResponse
  }

  // sumWorkload已在async函数内部处理

  return true; // 异步
});

// ==== side panel router ====
const PANEL_PATHS = {
  "pha-panel": "panels/pha/panel.html",
  "settings-panel": "panels/settings/panel.html",
  "rocket-panel": "panels/rocket/panel.html",
  "notes-panel": "panels/notes/panel.html",
  "todo-panel": "panels/todo/panel.html",
  "gerrit-panel": "panels/gerrit/panel.html"

};


async function openPanelByName(name, tabId, opts = {}) {
  const path = PANEL_PATHS[name] || PANEL_PATHS["pha-panel"];
  if (!tabId) return { ok: false, err: "no-active-tab" };

  try {
    // 获取当前标签页的面板配置
    const currentOptions = await chrome.sidePanel.getOptions({ tabId: tabId });

    // 启用侧边栏（如果尚未启用）
    if (!currentOptions.enabled) {
      await chrome.sidePanel.setOptions({ tabId, enabled: true });
    }

    // 只有当面板路径不同时才设置新路径，避免不必要的重置
    if (currentOptions.path !== path) {
      await chrome.sidePanel.setOptions({ tabId, path });
    }
  } catch (error) {
    console.warn(`设置面板选项失败:`, error);
    // 出错时仍然尝试设置路径，确保功能可用
    await chrome.sidePanel.setOptions({ tabId, enabled: true });
    await chrome.sidePanel.setOptions({ tabId, path });
  }

  // 仅非面板来源时才尝试打开，避免“需要用户手势”错误
  if (!opts.fromSidePanel) {
    try { await chrome.sidePanel.open({ tabId }); } catch (_) { }
  }
  return { ok: true, path };
}


// 点击扩展图标 → 打开当前标签页的面板
chrome.action.onClicked.addListener(async (tab) => {
  const tid = tab?.id || await spGetStableTabId();
  if (tid) {
    await spSetLastTab(tid);

    // 获取当前标签页的面板状态
    const panelName = await getCurrentTabPanelState(tab.id);

    await openPanelByName(panelName, tid, { fromSidePanel: false });
  }
});


// 标签页级别的面板状态管理
let tabPanelStates = new Map(); // tabId -> panelName

// 保存标签页面板状态到存储
async function saveTabPanelState(tabId, panelName) {
  if (!tabId) return;
  tabPanelStates.set(tabId, panelName);
  try {
    await chrome.storage.session.set({
      [`__uu_assist_tab_panel_${tabId}`]: panelName
    });
  } catch (_) { }
}

// 从存储加载标签页面板状态
async function loadTabPanelState(tabId) {
  if (!tabId) return "pha-panel";
  try {
    const o = await chrome.storage.session.get(`__uu_assist_tab_panel_${tabId}`);
    return o?.[`__uu_assist_tab_panel_${tabId}`] || "pha-panel";
  } catch (_) { return "pha-panel"; }
}

// 获取当前标签页的面板状态
async function getCurrentTabPanelState(tabId) {
  if (tabPanelStates.has(tabId)) {
    return tabPanelStates.get(tabId);
  }
  return await loadTabPanelState(tabId);
}

// 清理已关闭标签页的状态
async function cleanupTabPanelState(tabId) {
  if (tabId) {
    tabPanelStates.delete(tabId);
    try {
      await chrome.storage.session.remove(`__uu_assist_tab_panel_${tabId}`);
    } catch (_) { }
  }
}


function isFromSidePanel(sender) {
  try {
    const base = chrome.runtime.getURL('panels/');
    return (sender?.url || '').startsWith(base);
  } catch (_) { return false; }
}


//  数据库部分

/* ===== post 数据缓存 ===== */
const DB_NAME = "uu-assist-pha";
const DB_VER = 1;
const STORE = "posts"; // 记录结构：{id, panel, taskId, time, content}

function idbOpen() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        // 复合索引，便于倒序/区间查询
        os.createIndex("panel_time", ["panel", "time"], { unique: false });
        os.createIndex("panel_task_time", ["panel", "taskId", "time"], { unique: false });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function dbAddPost({ panel, taskId, content, time, aiTitle = "", aiReply = "" }) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const putReq = os.add({
      panel: String(panel || ""),
      taskId: String(taskId || ""),
      time: Number(time || Date.now()),
      content: typeof content === "string" ? content : JSON.stringify(content || ""),
      aiTitle: String(aiTitle || ""),      // ← 新增
      aiReply: String(aiReply || "")       // ← 新增
    });
    tx.oncomplete = () => res({ ok: true, id: putReq.result });
    tx.onerror = () => rej(tx.error);
  });
}


async function dbQueryByTask({ panel, taskId, start = 0, end = Number.MAX_SAFE_INTEGER, limit = 200 }) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("panel_task_time");
    const range = IDBKeyRange.bound([panel, String(taskId), start], [panel, String(taskId), end]);
    const out = [];
    idx.openCursor(range, "prev").onsuccess = e => {
      const cur = e.target.result;
      if (!cur || out.length >= limit) { res({ ok: true, items: out }); return; }
      const v = cur.value;
      out.push({
        id: v.id, panel: v.panel,
        时间: v.time, 任务号: v.taskId, 内容: v.content,
        aiTitle: v.aiTitle || "", aiReply: v.aiReply || ""   // ← 新增
      });

      cur.continue();
    };
    tx.onerror = () => rej(tx.error);
  });
}

async function dbQueryByTime({ panel, start = 0, end = Number.MAX_SAFE_INTEGER, limit = 200 }) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const idx = tx.objectStore(STORE).index("panel_time");
    const range = IDBKeyRange.bound([panel, start], [panel, end]);
    const out = [];
    idx.openCursor(range, "prev").onsuccess = e => {
      const cur = e.target.result;
      if (!cur || out.length >= limit) { res({ ok: true, items: out }); return; }
      const v = cur.value;
      out.push({
        id: v.id, panel: v.panel,
        时间: v.time, 任务号: v.taskId, 内容: v.content,
        aiTitle: v.aiTitle || "", aiReply: v.aiReply || ""      /* 新增 */
      });
      cur.continue();
    };
    tx.onerror = () => rej(tx.error);
  });
}


// 从数据库删除笔记
async function dbDeletePost(id) {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    const deleteReq = os.delete(Number(id));
    tx.oncomplete = () => res({ ok: true });
    tx.onerror = () => rej(tx.error);
  });
}

/* ===== 导出 / 导入（posts + storage） ===== */
async function dbDumpAllPosts() {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const out = [];
    const tx = db.transaction(STORE, "readonly");
    tx.objectStore(STORE).openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (!cur) return res(out);
      const v = cur.value || {};
      out.push({
        id: v.id ?? null,
        panel: String(v.panel || ""),
        时间: Number(v.time || 0),
        任务号: String(v.taskId || ""),
        内容: String(v.content || ""),
        AI标题: String(v.aiTitle || ""),          /* 新增 */
        AI内容: String(v.aiReply || "")           /* 新增 */
      });
      cur.continue();
    };
    tx.onerror = () => rej(tx.error);
  });
}

async function dbBulkImportPosts(items = []) {
  if (!Array.isArray(items) || !items.length) return { ok: true, count: 0 };
  const db = await idbOpen();
  return new Promise((res, rej) => {
    let count = 0;
    const tx = db.transaction(STORE, "readwrite");
    const st = tx.objectStore(STORE);
    for (const it of items) {
      st.add({
        panel: String(it.panel || ""),
        taskId: String(it["任务号"] ?? it.taskId ?? ""),
        time: Number(it["时间"] ?? it.time ?? Date.now()),
        content: String(it["内容"] ?? it.content ?? ""),
        aiTitle: String(it["AI标题"] ?? it.aiTitle ?? ""),   /* 新增 */
        aiReply: String(it["AI内容"] ?? it.aiReply ?? "")    /* 新增 */
      });
      count++;
    }
    tx.oncomplete = () => res({ ok: true, count });
    tx.onerror = () => rej(tx.error);
  });
}

async function exportAllData() {
  const cfg = await chrome.storage.local.get(null).catch(() => ({}));
  const posts = await dbDumpAllPosts();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    extensionId: chrome.runtime.id,
    data: { ...cfg, posts }
  };
}
async function importAllData(payload) {
  const data = payload?.data || {};
  const { aiCfg, prefs } = data;
  if (aiCfg || prefs) await chrome.storage.local.set({ ...(aiCfg ? { aiCfg } : {}), ...(prefs ? { prefs } : {}) });
  const posts = Array.isArray(data.posts) ? data.posts : [];
  const r = await dbBulkImportPosts(posts);
  return { ok: true, importedPosts: r.count };
}
