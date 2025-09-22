/* sw.js v0.7.3 */
const stripXSSI = t => t.replace(/^\)\]\}'[^\n]*\n?/, "").trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const oneShot = (sendResponse)=>{ let done=false; return (p)=>{ if(!done){ done=true; try{ sendResponse(p); }catch(_){} } }; };
async function waitComplete(tabId, tries=60, interval=200){
  for(let i=0;i<tries;i++){ try{ const t=await chrome.tabs.get(tabId); if(t?.status==="complete") return; }catch(_){} await sleep(interval); }
}
async function ensureTab(url){
  const base = url.split("#")[0];
  const ts = await chrome.tabs.query({ url: base+"*" });
  return ts[0] || await chrome.tabs.create({ url, active:false });
}
async function ensureCS(tabId){
  // 先探测
  try{ await chrome.tabs.sendMessage(tabId, { type:"ping" }); return; }catch(_){}
  // 未注入则动态注入
  await chrome.scripting.executeScript({ target:{ tabId }, files:["content_script.js"] });
  // 再探测一次
  await chrome.tabs.sendMessage(tabId, { type:"ping" });
}
async function sendMsgWithTimeout(tabId, msg, timeoutMs=20000){
  return await Promise.race([
    chrome.tabs.sendMessage(tabId, msg),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error("content_script timeout")), timeoutMs))
  ]);
}


function stripXSSIPrefix(t){
  if (!t) return "";
  // trim leading whitespace and any 'for (;;);' prefix
  t = t.replace(/^\uFEFF/, "");
  t = t.replace(/^\s*for\s*\(\s*;;\s*\);\s*/i, "");
  return t;
}
function relaxParseJSON(t){
  t = stripXSSIPrefix(t);
  // try direct
  try { return JSON.parse(t); } catch(_){}
  // slice to first '{' and last '}' if exists
  const i = t.indexOf("{"); const j = t.lastIndexOf("}");
  if (i >= 0 && j > i){
    const s = t.slice(i, j+1);
    try { return JSON.parse(s); } catch(_){}
  }
  // as last resort, return null
  return null;
}
function grepIdAndUri(t){
  let id = null, uri = null;
  try {
    const mId = t.match(/"id"\s*:\s*(\d{2,})/);
    if (mId) id = mId[1];
    const mUri = t.match(/"uri"\s*:\s*"([^"]+)"/);
    if (mUri) uri = mUri[1];
  } catch(_){}
  return { id, uri };
}


// ==== track last active tab id (for sidePanel) ====
let lastTabId = null;

async function spSetLastTab(tabId){
  if (!tabId) return;
  lastTabId = tabId;
  try{ await chrome.storage.session.set({ __uu_assist_last_tab_id: tabId }); }catch(_){}
}
async function spGetLastTabFromSession(){
  try{
    const o = await chrome.storage.session.get('__uu_assist_last_tab_id');
    return o?.__uu_assist_last_tab_id || null;
  }catch(_){ return null; }
}
async function spGetStableTabId(sender){
  // side panel 页面 sender.tab 为空；content script/图标点击会带
  if (sender?.tab?.id) { await spSetLastTab(sender.tab.id); return sender.tab.id; }
  if (lastTabId) return lastTabId;
  const fromSess = await spGetLastTabFromSession();
  if (fromSess) { lastTabId = fromSess; return fromSess; }
  const [tab] = await chrome.tabs.query({ active:true, lastFocusedWindow:true });
  if (tab?.id){ await spSetLastTab(tab.id); return tab.id; }
  return null;
}

// 初始化与持续更新
chrome.tabs.onActivated.addListener(async ({ tabId }) => { await spSetLastTab(tabId); });
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active:true, windowId:winId });
  if (tab?.id) await spSetLastTab(tab.id);
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (tabId === lastTabId){
    lastTabId = null;
    try{ await chrome.storage.session.remove('__uu_assist_last_tab_id'); }catch(_){}
  }
});



chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(()=>{});
  }
});

function findInputValue(html, names){
  for (const name of names){
    const re = new RegExp(`<input[^>]*\\bname=["']` + name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + `["'][^>]*\\bvalue=["']([^"']+)["'][^>]*>`, "i");
    const m = html.match(re);
    if (m && m[1]) return m[1];
  }
  return null;
}
function snippetOf(s){ return (s||"").replace(/\s+/g," ").slice(0,300); }

async function fetchText(url){
  const r = await fetch(url, { credentials:"include", cache:"no-cache", redirect:"follow" });
  const t = await r.text();
  return { ok:r.ok, status:r.status, text:t };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async()=>{
    try{
      if (msg.type === "fetchListPage"){
        const { ok, status, text } = await fetchText(msg.url);
        sendResponse({ ok, status, text, snippet: snippetOf(text) });
        return;
      }

if (msg.type === "guessTaskFromGerrit"){
  try{
    const url = msg.url;
    const tab = await ensureTab(url);
    await waitComplete(tab.id);
    await ensureCS(tab.id);
    const r = await sendMsgWithTimeout(tab.id, { type:"extractTaskId" }, 12000);
    if (r?.ok && r.id) sendResponse({ ok:true, id: r.id });
    else sendResponse({ ok:false, error: r?.error || "not found" });
  }catch(e){
    sendResponse({ ok:false, error: e?.message || String(e) });
  }
  return;
}


if (msg.type === "fetchTaskSummary"){
  try{
    const url = msg.url;
    const r = await fetch(url, { credentials:"include", cache:"no-cache" });
    const html = await r.text();
    if (!r.ok){ sendResponse({ ok:false, status:r.status, snippet: snippetOf(html) }); return; }

    // 标题
    let title = ""; {
      const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (m) title = m[1].replace(/\s+/g," ").trim();
    }

    // 纯文本用于粗提取状态/优先级
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
      .replace(/<[^>]+>/g,"\n")
      .replace(/\u00a0/g," ")
      .replace(/[ \t]+\n/g,"\n");

    const status = (text.match(/(?:状态|Status)\s*[:：]\s*([^\n]+)/i)||[])[1] || "";
    const priority = (text.match(/(?:优先级|Priority)\s*[:：]\s*([^\n]+)/i)||[])[1] || "";

    // 解析属性列表 <dl class="phui-property-list-properties">…</dl>
    const details = [];
    const dlRe = /<dl[^>]*class=["'][^"']*phui-property-list-properties[^"']*["'][^>]*>([\s\S]*?)<\/dl>/ig;
    let dlm;
    while ((dlm = dlRe.exec(html)) !== null){
      const body = dlm[1];
      const kvRe = /<dt[^>]*class=["'][^"']*phui-property-list-key[^"']*["'][^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*class=["'][^"']*phui-property-list-value[^"']*["'][^>]*>([\s\S]*?)<\/dd>/ig;
      let m;
      while ((m = kvRe.exec(body)) !== null){
        const k = m[1].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
        const v = m[2].replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
        if (k) details.push({ k, v });
      }
    }

    sendResponse({ ok:true, title, status, priority, details });
  }catch(e){
    sendResponse({ ok:false, error: e?.message || String(e) });
  }
  return;
}



      if (msg.type === "fetchTaskSummary"){
          try{
            const url = msg.url;
            const r = await fetch(url, { credentials:"include", cache:"no-cache" });
            const html = await r.text();
            if (!r.ok){ sendResponse({ ok:false, status:r.status, snippet: snippetOf(html) }); return; }

            // 取 <title>
            let title = "";
            const mTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
            if (mTitle) title = mTitle[1].replace(/\s+/g," ").trim();

            // 去脚本与样式，转纯文本后再匹配“状态/优先级”
            const text = html
              .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,"")
              .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,"")
              .replace(/<[^>]+>/g,"\n")
              .replace(/\u00a0/g," ")
              .replace(/[ \t]+\n/g,"\n");

            function pick(reArr){
              for (const re of reArr){
                const m = text.match(re);
                if (m) return m[1].trim();
              }
              return "";
            }
            const status = pick([
              /(?:状态|Status)\s*[:：]\s*([^\n]+)/i,
              /(?:状态|Status)\s*\n\s*([^\n]+)/i
            ]);
            const priority = pick([
              /(?:优先级|Priority)\s*[:：]\s*([^\n]+)/i,
              /(?:优先级|Priority)\s*\n\s*([^\n]+)/i
            ]);

            sendResponse({ ok:true, title, status, priority });
          }catch(e){
            sendResponse({ ok:false, error: e?.message || String(e) });
          }
          return;
    }


      if (msg.type === "aiSummarize"){
        const def = { aiCfg:null };
        const got = await chrome.storage.local.get(def).catch(()=>def);
        const ai = got.aiCfg || {};
        const base = (ai.base || "https://api.deepseek.com/v1").replace(/\/+$/,"");
        const model = ai.model || "deepseek-chat";
        const key = ai.key || "";
        const prompt = msg.prompt || ai.prompt || "你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁回复。以严格JSON返回：{\"title\":\"...\", \"reply\":\"...\"}";
        if (!key){ sendResponse({ ok:false, error:"缺少API Key" }); return; }
        const url = base + "/chat/completions";
        const payload = { model, messages: [ { role:"system", content: prompt }, { role:"user", content: msg.content || "" } ] };
        try{
          const r = await fetch(url, { method:"POST", headers:{ "Content-Type":"application/json", "Authorization":"Bearer " + key }, body: JSON.stringify(payload) });
          const txt = await r.text();
          if (!r.ok){ sendResponse({ ok:false, status:r.status, error:"AI接口错误", snippet: snippetOf(txt) }); return; }
          let data = null; try{ data = JSON.parse(txt); }catch(_){ data = relaxParseJSON(txt); }
          const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "";
          let jsonText = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "");
          let obj = null; try{ obj = JSON.parse(jsonText); }catch(_){ obj = relaxParseJSON(jsonText); }
          const title = obj && obj.title ? String(obj.title) : "";
          const reply = obj && obj.reply ? String(obj.reply) : "";
          sendResponse({ ok:true, title, reply }); return;
        }catch(e){ sendResponse({ ok:false, error:e.message }); return; }
      }
if (msg.type === "postComment"){
        const g = await fetch(msg.taskUrl, { credentials:"include", cache:"no-cache", redirect:"follow" });
        const html = await g.text();
        if (!g.ok) { sendResponse({ ok:false, status:g.status, error:"GET 任务页失败", snippet: snippetOf(html) }); return; }
        const csrf = findInputValue(html, ["__csrf__", "_csrf_"]);
        if (!csrf){ sendResponse({ ok:false, error:"未找到CSRF令牌", snippet: snippetOf(html) }); return; }
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
        const r = await fetch(postUrl, { method:"POST", credentials:"include",
          headers:{ "Content-Type":"application/x-www-form-urlencoded","Accept":"*/*","X-Phabricator-Csrf": csrf },
          body: form.toString()
        });
        const rt = await r.text().catch(()=> "");
        sendResponse({ ok: r.ok, status: r.status, snippet: snippetOf(rt) });
        return;
      }
      
if (msg.type === "fetchGerritCommit"){
  async function getCommitWithRetry(url, tries=5){
    let last = {};
    for (let i=0;i<tries;i++){
      try{
        const r = await fetch(url, { headers:{Accept:"application/json"}, credentials:"include" });
        const raw = await r.text();
        const text = stripXSSI(raw);
        if (!r.ok){ last = { ok:false, status:r.status, snippet:text.slice(0,400) }; }
        else{
          try{
            const j = JSON.parse(text);
            const message = j.message || (j.commit && j.commit.message) || j.subject || "";
            if (message) return { ok:true, status:r.status, message };
            last = { ok:false, status:r.status, snippet:text.slice(0,400), error:"empty message" };
          }catch(e){ last = { ok:false, status:r.status, error:"JSON parse failed", snippet:text.slice(0,400) }; }
        }
      }catch(e){ last = { ok:false, error:e?.message||String(e) }; }
      await sleep(500 * (i+1));
    }
    return last;
  }

  const first = await getCommitWithRetry(msg.api);
  if (first.ok){ sendResponse({ ok:true, message:first.message }); return; }

  let tab;
  const urlNoHash = msg.url.split("#")[0];
  const tabs = await chrome.tabs.query({ url: urlNoHash + "*" });
  if (tabs?.length) tab = tabs[0];
  if (!tab){
    tab = await chrome.tabs.create({ url: msg.url, active:false });
    await sleep(1500);
  }
  try{
    const domRes = await chrome.tabs.sendMessage(tab.id, { type:"gerritGrabCommit" });
    if (domRes?.ok && domRes.message){
      sendResponse({ ok:true, message: domRes.message }); return;
    }
  }catch(_){}

  sendResponse({ ok:false, error: first.error || "fallback DOM grab failed", status: first.status, snippet: first.snippet });
  return;
}


// onMessage 内：
if (msg.type === "sumWorkload") {
  const reply = oneShot(sendResponse);
  const guard = setTimeout(()=>reply({ ok:false, error:"background timeout"}), 30000);

  try{
    const tab = await ensureTab(msg.url);
    await waitComplete(tab.id);
    await ensureCS(tab.id);                             // 确保注入并就绪
    const res = await sendMsgWithTimeout(tab.id, {      // 展开并统计
      type: "expandAndSumWorkload"
    }, 25000);
    clearTimeout(guard);
    reply(res && typeof res==="object" ? res : { ok:false, error:"no response" });
  }catch(e){
    clearTimeout(guard);
    reply({ ok:false, error: e?.message || String(e) });
  }
  return true; // 异步回包
}


      if (msg.type === "uploadFile"){
        function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
        async function openOrFocusPHA(){
          const tabs = await chrome.tabs.query({ url: ["http://pha.tp-link.com.cn/*"] });
          if (tabs && tabs.length){
            const ready = tabs.find(t => t.status === "complete") || tabs[0];
            return ready.id;
          }
          const t = await chrome.tabs.create({ url: "http://pha.tp-link.com.cn/" });
          return t.id;
        }
        async function waitTabComplete(tabId, tries=40){
          for (let i=0;i<tries;i++){
            try{
              const t = await chrome.tabs.get(tabId);
              if (t && t.status === "complete") return true;
            }catch(_){}
            await delay(100);
          }
          return false;
        }
        async function ensureCS(tabId){
          try{
            const pong = await chrome.tabs.sendMessage(tabId, { cs:"fetchText", url:"http://pha.tp-link.com.cn/" });
            if (pong) return true;
          }catch(_){}
          try{
            await chrome.scripting.executeScript({ target:{ tabId }, files:["cs.js"] });
            return true;
          }catch(e){
            return false;
          }
        }
        async function getCsrf(tabId){
          const r = await chrome.tabs.sendMessage(tabId, { cs:"fetchText", url:"http://pha.tp-link.com.cn/" }).catch(()=>null);
          if (!r?.ok) return null;
          const m = (r.text||"").match(/name=['"](?:__csrf__|_csrf_)['"][^>]*value=['"]([^'"]+)['"]/i);
          return m ? m[1] : null;
        }

        try{
          const tabId = await openOrFocusPHA();
          await waitTabComplete(tabId);
          const csReady = await ensureCS(tabId);
          if (!csReady){ sendResponse({ ok:false, error:"内容脚本未就绪" }); return; }

          let csrf = await getCsrf(tabId);
          if (!csrf){
            try{ await chrome.tabs.reload(tabId); }catch(_){}
            await waitTabComplete(tabId);
            await ensureCS(tabId);
            csrf = await getCsrf(tabId);
          }
          if (!csrf){ sendResponse({ ok:false, error:"无法获取CSRF" }); return; }

          const bytes = new Uint8Array(msg.bytes||[]);
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

          const res = await chrome.tabs.sendMessage(tabId, { cs:"rawUpload", url, headers, bytes: Array.from(bytes) }).catch(err=>({ ok:false, error:String(err) }));
          if (!res?.ok){ sendResponse({ ok:false, status: res?.status, error: res?.error || "rawUpload失败" }); return; }
          
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
          if (monogram || fUrl) { sendResponse({ ok:true, status: res.status, monogram, url:fUrl, snippet: snippetOf(t) }); return; }
          sendResponse({ ok:false, status: res.status, error:"dropupload未返回文件ID", snippet: snippetOf(t) });

          return;
        }catch(e){
          sendResponse({ ok:false, error: e.message }); return;
        }
      }

      sendResponse({ ok:false, error:"unknown message" });
    }catch(e){
      sendResponse({ ok:false, error: e.message });
    }
  })();
  return true;
});

// ==== side panel router ====
const PANEL_PATHS = {
  "pha-panel": "panels/pha/panel.html",
  "settings-panel": "panels/settings/panel.html"
};


async function openPanelByName(name, tabId, opts = {}) {
  const path = PANEL_PATHS[name] || PANEL_PATHS["pha-panel"];
  if (!tabId) return { ok:false, err:"no-active-tab" };

  await chrome.sidePanel.setOptions({ tabId, enabled:true });
  await chrome.sidePanel.setOptions({ tabId, path });

  // 仅非面板来源时才尝试打开，避免“需要用户手势”错误
  if (!opts.fromSidePanel) {
    try { await chrome.sidePanel.open({ tabId }); } catch(_) {}
  }
  return { ok:true, path };
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


function isFromSidePanel(sender){
  try {
    const base = chrome.runtime.getURL('panels/');
    return (sender?.url || '').startsWith(base);
  } catch(_) { return false; }
}
