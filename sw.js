/* sw.js v0.7.3 */
const stripXSSI = t => t.replace(/^\)\]\}'[^\n]*\n?/, "").trim();
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
chrome.tabs.onActivated.addListener(async ({ tabId }) => { await spSetLastTab(tabId); });
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId: winId });
  if (tab?.id) await spSetLastTab(tab.id);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === lastTabId) {
    lastTabId = null;
    try { await chrome.storage.session.remove('__uu_assist_last_tab_id'); } catch (_) { }
  }
});



chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });
  }
});

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
  (async () => {
    try {
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
        return;
      }

      if (msg.type === "fetchListPage") {
        const { ok, status, text } = await fetchText(msg.url);
        sendResponse({ ok, status, text, snippet: snippetOf(text) });
        return;
      }

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
        return;
      }


      if (msg.type === "fetchTaskSummary") {
        try {
          const url = msg.url;
          const r = await fetch(url, { credentials: "include", cache: "no-cache" });
          const html = await r.text();
          if (!r.ok) { sendResponse({ ok: false, status: r.status, snippet: snippetOf(html) }); return; }

          // 标题
          let title = "";
          const mTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (mTitle) title = mTitle[1].replace(/\s+/g, " ").trim();

          const strip = s => String(s || "")
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          let status = "", priority = "";

          // ① 页眉副标题（权威）
          const mSub = html.match(/<div[^>]*class=["'][^"']*phui-header-subheader[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
          if (mSub) {
            // 取第一个 phui-tag-core 的文本
            let coreText = "";
            const coreRe = /<span[^>]*class=["'][^"']*phui-tag-core[^"']*["'][^>]*>([\s\S]*?)<\/span>/ig;
            let mm;
            while ((mm = coreRe.exec(mSub[1])) !== null) {
              const t = strip(mm[1]);
              if (t) { coreText = t; break; }
            }
            const headerText = coreText || strip(mSub[1]);

            // 分段后分别提取状态/优先级
            const parts = headerText.split(/[，,]/).map(s => s.trim()).filter(Boolean);
            const statusRe = /(进行中(?:\(不加入统计\))?|已完成(?:\(不加入统计\))?|已解决|已关闭|开放|待办|已指派|已验证|已取消|已暂停|未开始|in\s*progress|open|resolved|closed)/i;

            // 状态：从右往左找，优先采用最后出现的状态词
            for (const seg of parts.slice().reverse()) {
              const m = seg.match(statusRe);
              if (m) { status = m[1].replace(/\s+/g, ""); break; }
            }
            // 优先级：找到第一个 P\d
            if (!priority) {
              for (const seg of parts) {
                const mp = seg.match(/\bP\d\b/i);
                if (mp) { priority = mp[0].toUpperCase(); break; }
              }
            }
          }



          // ② 任务图“只针对当前TID”的兜底（防止误取父/兄弟任务）
          if (!status) {
            const tidMatch = url.match(/\/T(\d+)\b/i);
            const tid = tidMatch && tidMatch[1];
            if (tid) {
              // 找到包含 <span class="object-name">T{tid}</span> 的那一行
              const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/ig;
              let tr;
              while ((tr = trRe.exec(html)) !== null) {
                if (new RegExp(`<span[^>]*class=["'][^"']*object-name[^"']*["'][^>]*>\\s*T${tid}\\s*<\\/span>`, "i").test(tr[1])) {
                  const mGraph = tr[1].match(/<td[^>]*class=["'][^"']*graph-status[^"']*["'][^>]*>([\s\S]*?)<\/td>/i);
                  if (mGraph) {
                    const t = strip(mGraph[1]);
                    const ms = t.match(/(已完成(?:\(不加入统计\))?|进行中(?:\(不加入统计\))?|暂停|未开始)/);
                    if (ms) { status = ms[1]; }
                  }
                  break;
                }
              }
            }
          }

          // ③ 时间线兜底：优先找“将此任务关闭为 …”，否则找“修改为 …”的最后一条
          if (!status) {
            let lastClose = "";
            const closeRe = /<div[^>]*class=["'][^"']*phui-timeline-title[^"']*["'][^>]*>[\s\S]*?将此任务关闭为[\s\S]*?<span[^>]*class=["'][^"']*phui-timeline-value[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/div>/ig;
            let m;
            while ((m = closeRe.exec(html)) !== null) { lastClose = strip(m[1]); }
            if (lastClose) status = lastClose;
            else {
              // 最近一次“修改为 …”的目标状态
              let lastChange = "";
              const changeRe = /<div[^>]*class=["'][^"']*phui-timeline-title[^"']*["'][^>]*>[\s\S]*?修改为[\s\S]*?<span[^>]*class=["'][^"']*phui-timeline-value[^"']*["'][^>]*>([\s\S]*?)<\/span>[\s\S]*?<\/div>/ig;
              while ((m = changeRe.exec(html)) !== null) { lastChange = strip(m[1]); }
              if (lastChange) status = lastChange;
            }
          }

          // ④ 解析属性列表 <dl>（补充 details / 末位兜底）
          const details = [];
          const dlRe = /<dl[^>]*class=["'][^"']*phui-property-list-properties[^"']*["'][^>]*>([\s\S]*?)<\/dl>/ig;
          let dlm;
          while ((dlm = dlRe.exec(html)) !== null) {
            const body = dlm[1];
            const kvRe = /<dt[^>]*class=["'][^"']*phui-property-list-key[^"']*["'][^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*class=["'][^"']*phui-property-list-value[^"']*["'][^>]*>([\s\S]*?)<\/dd>/ig;
            let m;
            while ((m = kvRe.exec(body)) !== null) {
              details.push({ k: strip(m[1]), v: strip(m[2]) });
            }
          }

          // 先从 details 里兜底
          if (!status) {
            const kv = details.find(d => /^(状态|Status)$/i.test(d.k));
            if (kv) status = kv.v.replace(/\s+/g, "");
          }
          if (!priority) {
            const kv = details.find(d => /^(优先级|Priority)$/i.test(d.k));
            if (kv) priority = (kv.v.match(/\bP\d\b/i)?.[0] || kv.v).toUpperCase();
          }

          // 最末从纯文本兜底一次（只匹配“状态/优先级：”或独立的 Pn）
          if (!status || !priority) {
            const text = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
              .replace(/<[^>]+>/g, "\n")
              .replace(/\u00a0/g, " ")
              .replace(/[ \t]+\n/g, "\n");

            if (!status) {
              const ms = text.match(/(?:^|\n)\s*(?:状态|Status)\s*[:：]\s*([^\n\r]+)/i);
              if (ms) status = ms[1].trim().replace(/\s+/g, "");
            }
            if (!priority) {
              const mp = text.match(/(?:^|\n)\s*(?:优先级|Priority)\s*[:：]\s*([^\n\r]+)/i) || text.match(/(?:^|\n)\s*(P\d)\b/i);
              if (mp) priority = (mp[1] || mp[0]).toUpperCase().trim();
            }
          }


          sendResponse({ ok: true, title, status, priority, details });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message || String(e) });
        }
        return;
      }





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

            sendResponse({ ok: true, title, reply, usage, model: usedModel });
            return;
          } catch (e) {
            sendResponse({ ok: false, error: e?.message || String(e) });
            return;
          }
        })();
        return true; // 关键：保持消息通道，等待异步 sendResponse
      }



      if (msg.type === "postComment") {
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
        if (draftVer) form.set("draft.version", draftVer);
        let comment = msg.content;
        if (typeof comment === "object") comment = JSON.stringify(comment);
        form.set("comment", comment);
        const r = await fetch(postUrl, {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "*/*", "X-Phabricator-Csrf": csrf },
          body: form.toString()
        });
        const rt = await r.text().catch(() => "");
        sendResponse({ ok: r.ok, status: r.status, snippet: snippetOf(rt) });
        return;
      }

      if (msg.type === "fetchGerritCommit") {
        async function getCommitWithRetry(url, tries = 5) {
          let last = {};
          for (let i = 0; i < tries; i++) {
            try {
              const r = await fetch(url, { headers: { Accept: "application/json" }, credentials: "include" });
              const raw = await r.text();
              const text = stripXSSI(raw);
              if (!r.ok) { last = { ok: false, status: r.status, snippet: text.slice(0, 400) }; }
              else {
                try {
                  const j = JSON.parse(text);
                  const message = j.message || (j.commit && j.commit.message) || j.subject || "";
                  if (message) return { ok: true, status: r.status, message };
                  last = { ok: false, status: r.status, snippet: text.slice(0, 400), error: "empty message" };
                } catch (e) { last = { ok: false, status: r.status, error: "JSON parse failed", snippet: text.slice(0, 400) }; }
              }
            } catch (e) { last = { ok: false, error: e?.message || String(e) }; }
            await sleep(500 * (i + 1));
          }
          return last;
        }

        const first = await getCommitWithRetry(msg.api);
        if (first.ok) { sendResponse({ ok: true, message: first.message }); return; }

        let tab;
        const urlNoHash = msg.url.split("#")[0];
        const tabs = await chrome.tabs.query({ url: urlNoHash + "*" });
        if (tabs?.length) tab = tabs[0];
        if (!tab) {
          tab = await chrome.tabs.create({ url: msg.url, active: false });
          await sleep(1500);
        }
        try {
          const domRes = await chrome.tabs.sendMessage(tab.id, { type: "gerritGrabCommit" });
          if (domRes?.ok && domRes.message) {
            sendResponse({ ok: true, message: domRes.message }); return;
          }
        } catch (_) { }

        sendResponse({ ok: false, error: first.error || "fallback DOM grab failed", status: first.status, snippet: first.snippet });
        return;
      }


      // onMessage 内：
      if (msg.type === "sumWorkload") {
        const reply = oneShot(sendResponse);
        const guard = setTimeout(() => reply({ ok: false, error: "background timeout" }), 30000);

        try {
          const tab = await ensureTab(msg.url);
          await waitComplete(tab.id);
          await ensureCS(tab.id);                             // 确保注入并就绪
          const res = await sendMsgWithTimeout(tab.id, {      // 展开并统计
            type: "expandAndSumWorkload"
          }, 25000);
          clearTimeout(guard);
          reply(res && typeof res === "object" ? res : { ok: false, error: "no response" });
        } catch (e) {
          clearTimeout(guard);
          reply({ ok: false, error: e?.message || String(e) });
        }
        return true; // 异步回包
      }


      if (msg.type === "uploadFile") {
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

        try {
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

          return;
        } catch (e) {
          sendResponse({ ok: false, error: e.message }); return;
        }
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true;
});

// ==== side panel router ====
const PANEL_PATHS = {
  "pha-panel": "panels/pha/panel.html",
  "settings-panel": "panels/settings/panel.html",
  "rocket-panel": "panels/rocket/panel.html",
  "notes-panel": "panels/notes/panel.html"

};


async function openPanelByName(name, tabId, opts = {}) {
  const path = PANEL_PATHS[name] || PANEL_PATHS["pha-panel"];
  if (!tabId) return { ok: false, err: "no-active-tab" };

  await chrome.sidePanel.setOptions({ tabId, enabled: true });
  await chrome.sidePanel.setOptions({ tabId, path });

  // 仅非面板来源时才尝试打开，避免“需要用户手势”错误
  if (!opts.fromSidePanel) {
    try { await chrome.sidePanel.open({ tabId }); } catch (_) { }
  }
  return { ok: true, path };
}


// 点击扩展图标 → 打开默认面板
chrome.action.onClicked.addListener(async (tab) => {
  const tid = tab?.id || await spGetStableTabId();
  if (tid) await spSetLastTab(tid);
  await openPanelByName("pha-panel", tid, { fromSidePanel: false });
});


// 面板请求切换
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "switchPanel") {
      const tid = await spGetStableTabId(sender);
      const ret = await openPanelByName(msg.name, tid, { fromSidePanel: isFromSidePanel(sender) });
      sendResponse(ret);
    }
  })();
  return true;
});


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

// 消息路由
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
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
  })();
  return true; // 异步
});

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




chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      // ……这里是你原有的一堆 if (msg.type === "...") 分支……

      // === 新增：导出 / 导入 ===
      if (msg?.type === "exportAllData") {
        try {
          const blob = await exportAllData();
          sendResponse({ ok: true, blob });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return;
      }
      if (msg?.type === "importAllData") {
        try {
          const r = await importAllData(msg.payload);
          sendResponse({ ok: true, ...r });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        return;
      }

      return;

    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // 异步
});
