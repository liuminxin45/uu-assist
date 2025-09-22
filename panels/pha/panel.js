/* panel.js v0.8.3-clean */
const $ = id => document.getElementById(id);

// ----- status helpers -----
const setStatus = s => { const el = $("status"); if (el) { el.textContent = s; el.scrollTop = el.scrollHeight; } };
const log = s => { const el = $("status"); if (el) { el.textContent = (el.textContent ? el.textContent + "\n" : "") + s; el.scrollTop = el.scrollHeight; } };
window.addEventListener("error", e => { try{ const s=$("status"); if(s) s.textContent = "脚本错误: " + (e.message||"unknown"); }catch(_){} });

// ----- small utils -----
/* -------- Gerrit helpers -------- */
// 从 Gerrit 页面 URL 推导 API（优先 numeric changeId，rev 不给则用 current）
function gerritApiFromUrl(pageUrl){
  try{
    const s = String(pageUrl || "").trim();
    const u = new URL(s);
    // 直接抓 /+/<change>[/<rev>]，不依赖前缀是否含 /gerrit 或具体 repo 路径
    const m = u.pathname.match(/\/\+\/(\d+)(?:\/(\d+))?/);
    if (!m) return null;
    const changeId = m[1];
    const rev = m[2] || "current";
    const api = `${u.origin}/gerrit/changes/${changeId}/revisions/${rev}/commit`;
    return { api, changeId, rev, canonical: s };
  }catch{ return null; }
}

// 插入整理后的文本到正文
async function insertGerritCommitByUrl(inputUrl){
  const ta = $("txtContent");
  if (!ta) { setStatus("未找到正文输入框"); return; }
  const parsed = gerritApiFromUrl(inputUrl);
  if (!parsed){ setStatus("无法解析该 Gerrit 地址： " + inputUrl); return; }

  setStatus("获取 Gerrit 提交说明中…");
  const res = await chrome.runtime.sendMessage({ type:"fetchGerritCommit", api: parsed.api, url: parsed.canonical }).catch(()=>null);
  if (!res?.ok){ setStatus("获取失败: " + (res?.error||"")); return; }

  const msg = (res.message || "").trim();
  if (!msg){ setStatus("未读到提交说明"); return; }

    const block =
        `\n**[Gerrit]**\n${parsed.canonical}\n\n**提交说明**\n\`\`\`\n${msg}\n\`\`\`\n`;


  insertAtCursor(ta, block);
  setStatus("已插入 Gerrit 提交说明");
}

function setTaskLink(url){
  const a = $("taskLink");
  if (!a) return;
  a.href = url || "#";
  const m = (url || "").match(/\/(T\d+)(?:[/?#]|$)/i);
  a.textContent = m ? m[1] : "";
  a.style.display = a.textContent ? "inline" : "none";
  // 拉取摘要
  if (a.textContent) refreshTaskSummary(url);
  else renderTaskSummary(null);
}

// ---- 任务摘要 ----
let metaReqToken = 0;
async function refreshTaskSummary(url){
  const box = $("taskMeta"); if (!box) return;
  const cur = ++metaReqToken;
  box.style.display = "none";
  $("taskTitle").textContent = "";
  $("taskStatus").textContent = "";
  $("taskPriority").textContent = "";
  const res = await chrome.runtime.sendMessage({ type:"fetchTaskSummary", url }).catch(()=>null);
  if (cur !== metaReqToken) return; // 过期请求丢弃
  if (res?.ok){ renderTaskSummary(res); }
  else { renderTaskSummary(null); }
}
function renderTaskSummary(meta){
  const box = $("taskMeta"); if (!box) return;
  const more = $("taskMetaMore");
  if (!meta){ box.style.display = "none"; if (more) more.style.display="none"; return; }

  $("taskTitle").textContent = meta.title || "";
  $("taskStatus").textContent = "状态: " + (meta.status || "未知");
  $("taskPriority").textContent = "优先级: " + (meta.priority || "未知");

  // 详情渲染
  if (more){
    if (Array.isArray(meta.details) && meta.details.length){
      const html = meta.details.map(item => {
        const k = (item.k || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        const v = (item.v || "").replace(/</g,"&lt;").replace(/>/g,"&gt;");
        return `<div style="display:flex;gap:8px;margin-top:4px">
                  <div style="min-width:9em" class="muted">${k}</div>
                  <div style="flex:1">${v}</div>
                </div>`;
      }).join("");
      more.innerHTML = html;
    }else{
      more.innerHTML = `<div class="muted">无更多属性</div>`;
    }
    more.style.display = "none"; // 默认收起
  }
  box.style.display = "block";
}

// DOMContentLoaded 里追加一次性绑定
(function bindMetaToggle(){
  const btn = $("metaToggle");
  const more = $("taskMetaMore");
  if (!btn || !more) return;
  btn.onclick = ()=>{
    const vis = more.style.display !== "none";
    more.style.display = vis ? "none" : "block";
    btn.textContent = vis ? "▾" : "▴";
  };
})();



function pad(n){ return n < 10 ? "0"+n : String(n); }
/* 支持 YYYY MM DD HH mm ss，默认值示例：[2025-09-18 09:04:40] */
function formatDate(fmt){
  const d = new Date();
  const map = {
    "YYYY": String(d.getFullYear()),
    "MM": pad(d.getMonth()+1),
    "DD": pad(d.getDate()),
    "HH": pad(d.getHours()),
    "mm": pad(d.getMinutes()),
    "ss": pad(d.getSeconds())
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, m => map[m] || m);
}

async function loadConfig(){
  // 返回 {}，避免解构或属性访问报错
  const got = await chrome.storage.local.get(null).catch(()=> ({}));

  // 安全读取 listUrl
  let url = "";
  if (got && typeof got === "object" && got.cfg && typeof got.cfg === "object") {
    const v = got.cfg.listUrl;
    if (typeof v === "string" && v.trim() !== "") url = v.trim();
  }

  // 安全写 DOM
  const elUrl = document.getElementById("listUrl");
  if (elUrl && url) elUrl.value = url;
}

  
async function saveAICfg(cfg){ await chrome.storage.local.set({ aiCfg: cfg }); }
async function loadAICfg(){
  const { aiCfg } = await chrome.storage.local.get({ aiCfg:null });
  return aiCfg || {
    enabled:false,
    base:"https://api.deepseek.com/v1",
    model:"deepseek-chat",
    key:"",
    prompt:'你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁回复。以严格JSON返回：{"title":"...", "reply":"..."}'
  };
}
function substituteTemplate(tpl, vars){
  return (tpl || "")
    .replaceAll("{{timestamp}}", vars.timestamp || "")
    .replaceAll("{{AITitle}}", vars.AITitle || "")
    .replaceAll("{{AIResponse}}", vars.AIResponse || "")
    .replaceAll("{{正文}}", vars.body || "");
}

// ----- DOM helpers -----
function insertAtCursor(textarea, text){
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after  = textarea.value.slice(end);
  textarea.value = before + text + after;
  const pos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.focus();
}
function insertAroundSelection(textarea, left, right){
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end   = textarea.selectionEnd ?? 0;
  const val = textarea.value;
  const sel = val.slice(start, end) || "";
  const before = val.slice(0, start);
  const after  = val.slice(end);
  const text = left + sel + right;
  textarea.value = before + text + after;
  const pos = before.length + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.focus();
}

// ----- list / upload -----
function fillSelect(items){
  const sel = $("selItems"); if (!sel) return;
  sel.innerHTML = "";
  for (const it of items){
    const opt = document.createElement("option");
    opt.value = it.href;
    opt.textContent = it.title;
    sel.appendChild(opt);
  }
  setStatus(`已载入 ${items.length} 项`);
  if (items.length){
    const href = new URL("http://pha.tp-link.com.cn" + items[0].href).href;
    setTaskLink(href);
  }
}
async function fetchList(url){
  const resp = await chrome.runtime.sendMessage({ type:"fetchListPage", url });
  if (!resp?.ok) throw new Error("抓取失败 HTTP " + (resp?.status||"") + (resp?.snippet?("\n"+resp.snippet):""));
  const html = resp.text || "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  let links = doc.querySelectorAll('span[data-sigil="slippery"] a.phui-oi-link[href^="/T"]');
  if (!links || links.length === 0){
    links = doc.querySelectorAll('a.phui-oi-link[href^="/T"]');
  }
  const items = Array.from(links).map(a => ({
    href: a.getAttribute("href"),
    title: a.textContent.trim()
  })).filter(x => x.href && x.title);
  return items;
}
async function uploadBlob(name, mime, arrayBuffer){
  const msg = {
    type:"uploadFile",
    filename: name,
    mime: mime || "application/octet-stream",
    bytes: Array.from(new Uint8Array(arrayBuffer)),
    via: ($("selItems")?.value || "")
  };
  const upl = await chrome.runtime.sendMessage(msg);
  if (upl?.ok){
    return upl.monogram ? `{${upl.monogram}, size=full, layout=center}` : (upl.url || "");
  }
  throw new Error((upl?.error || "上传失败") + (upl?.snippet?("\n"+upl.snippet):""));
}

// ----- markdown bar -----
function bindMarkdownBar(){
  const ta = $("txtContent");
  const bar = $("mdBar");
  if (!bar || !ta) return;
  bar.addEventListener("click", (e)=>{
    const btn = e.target.closest("button.mdbtn");
    if (!btn) return;
    const type = btn.getAttribute("data-md");
    switch(type){
      case "h1": insertAtCursor(ta, "\n# "); break;
      case "h2": insertAtCursor(ta, "\n## "); break;
      case "h3": insertAtCursor(ta, "\n### "); break;
      case "bold": insertAroundSelection(ta, "**", "**"); break;
      case "italic": insertAroundSelection(ta, "//", "//"); break;
      case "link": insertAtCursor(ta, "[描述](http://example.com)"); break;
      case "ul": insertAtCursor(ta, "\n- 项目1\n- 项目2\n"); break;
      case "ol": insertAtCursor(ta, "\n1. 项目1\n2. 项目2\n"); break;
      case "quote": insertAtCursor(ta, "\n> 引用\n"); break;
      case "code": insertAroundSelection(ta, "`", "`"); break;
      case "codeblock": insertAtCursor(ta, "\n```\ncode\n```\n"); break;
      case "checkbox": insertAtCursor(ta, "\n- [ ] 待办项\n"); break;
      case "table": insertAtCursor(ta, "\n| 列1 | 列2 |\n| --- | --- |\n| 值1 | 值2 |\n"); break;
      case "note": insertAtCursor(ta, "\n(NOTE): "); break;
      case "warning": insertAtCursor(ta, "\n(WARNING): "); break;
      case "important": insertAtCursor(ta, "\n(IMPORTANT): "); break;
    }
  });
}

// ========================= main bindings =========================
document.addEventListener("DOMContentLoaded", async ()=>{
  // 初始配置
  try{ await loadConfig(); }catch(e){ setStatus("配置加载失败: " + (e?.message||e)); }

  // 抓取 + 清空 + 下拉变化
  try{
    const btnLoad = $("btnLoad");
    const btnClear = $("btnClear");
    const listUrlEl = $("listUrl");
    const sel = $("selItems");
    const link = $("taskLink");

    if (btnLoad){
      btnLoad.onclick = async ()=>{
        try{
          setStatus("抓取中…");
          const items = await fetchList(listUrlEl ? listUrlEl.value.trim() : "");
          if (!items || items.length === 0){
            setStatus("未解析到任务，检查是否已登录或查询URL是否正确");
          }else{
            fillSelect(items);
          }
        }catch(e){
          setStatus((e && e.message) || "抓取异常");
        }
      };
    }
    if (btnClear){
      btnClear.onclick = ()=>{
        if (sel) sel.innerHTML = "";
        setStatus("已清空");
      };
    }
    if (sel){
      sel.onchange = ()=>{
        const href = sel.value;
        const abs = href ? new URL("http://pha.tp-link.com.cn" + href).href : "";
        setTaskLink(abs || "");
      };
    }
  }catch(e){ console.warn("list binds fail:", e); }

  // 粘贴上传
  try{
    const ta = $("txtContent");
    if (ta){
      ta.addEventListener("paste", async (e)=>{
        const items = e.clipboardData?.items || [];
        for (const it of items){
          if (it.kind === "file"){
            e.preventDefault();
            const file = it.getAsFile(); if (!file) continue;
            setStatus("粘贴文件上传中… " + (file.name || "clipboard.bin"));
            try{
              const buf = await file.arrayBuffer();
              const tag = await uploadBlob(file.name || "clipboard.bin", file.type, buf);
              insertAtCursor(ta, tag ? ("\n" + tag + "\n") : "");
              setStatus("粘贴上传完成");
            }catch(err){
              setStatus("粘贴上传失败: " + (err?.message||err));
            }
          }
        }
      });
      ta.addEventListener("dragover", e=>{ e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
      ta.addEventListener("drop", async (e)=>{
        e.preventDefault();
        const files = e.dataTransfer?.files || [];
        for (const file of files){
          setStatus("拖拽文件上传中… " + (file.name || "file.bin"));
          try{
            const buf = await file.arrayBuffer();
            const tag = await uploadBlob(file.name || "file.bin", file.type, buf);
            insertAtCursor(ta, tag ? ("\n" + tag + "\n") : "");
            setStatus("拖拽上传完成");
          }catch(err){
            setStatus("拖拽上传失败: " + (err?.message||err));
          }
        }
      });
    }
  }catch(e){ console.warn("paste/drop bind fail:", e); }

  // Markdown 工具条
  try{ bindMarkdownBar(); }catch(e){ console.warn("md bar bind fail:", e); }

// DDDD 工作量弹窗（选择即确认）
try{
  const dlg = $("dlgEffort");
  const sel = $("effortSelect");
  const cancel = $("effortCancel");
  const ta = $("txtContent");
  if (dlg && sel && ta){
    const close = ()=>{ try{ dlg.close(); }catch(_){ dlg.open=false; } };

    // 选择即确认；插入后把 select 重置，确保下次同值也会触发 onchange
    sel.onchange = ()=>{
      const v = sel.value || "";
      if (v){
        insertAtCursor(ta, "\n(工作耗时：" + v + "）");
      }
      sel.selectedIndex = -1; // 关键：重置选中项
      close();
    };
    if (cancel) cancel.onclick = close;

    ta.addEventListener("input", (e)=>{
      if (e.isComposing) return;                        // 兼容中文输入法
      const v = ta.value || "";
      const m = v.match(/(DDDD|dddd)\s*$/);             // 忽略结尾空白
      if (m){
        ta.value = v.replace(/(DDDD|dddd)\s*$/, "");    // 去掉触发标记
        try{ dlg.close(); }catch(_){ dlg.open=false; }  // 先重置状态
        try{ dlg.showModal(); }catch(_){ dlg.open = true; }
      }
    });
  }
}catch(e){ console.warn("effort bind fail:", e); }


  // POST 模板对话框
  try{
    const btnTpl = $("btnTpl");
    const dlgTpl = $("dlgTpl");
    const taTpl  = $("tplArea");
    if (taTpl && !taTpl.value.trim()){
      taTpl.value = "> {{timestamp}}\n# {{AITitle}}\n\n{{AIResponse}}\n\n--------\n\n{{正文}}";
    }
    if (btnTpl && dlgTpl){
      const closeTpl = ()=>{ try{ dlgTpl.close(); }catch(_){ dlgTpl.open=false; } };
      $("tplCancel")?.addEventListener("click", closeTpl);
      $("tplSave")?.addEventListener("click", closeTpl);
      btnTpl.onclick = ()=>{ try{ dlgTpl.showModal(); }catch(_){ dlgTpl.open=true; } };
    }
  }catch(e){ console.warn("tpl bind fail:", e); }

  // 统计耗时
  try{
    const btn = $("btnSumWL");
    if (btn){
      btn.onclick = async ()=>{
        const a = $("taskLink");
        const url = a?.href || "";
        if (!url){ setStatus("未找到任务链接"); return; }
        setStatus("统计耗时中…");
        const res = await chrome.runtime.sendMessage({ type:"sumWorkload", url });
        if (res?.ok){
          const ta = $("txtContent");
          if (ta){
            const text = "\n截止目前总计耗时：" + res.days + "D";
            insertAtCursor(ta, text);
          }
          setStatus("统计完成：" + res.days + "D");
        }else{
          setStatus("统计失败: " + (res?.error || ""));
        }
      };
    }
  }catch(e){ console.warn("sum workload bind fail:", e); }

async function getActiveTabUrl(){
  const [tab] = await chrome.tabs.query({ active:true, lastFocusedWindow:true }).catch(()=>[]);
  return tab?.url || "";
}

try{
  const btn = $("btnGerrit");
  if (btn){
    btn.onclick = async ()=>{
      // 1) 先尝试当前活动页
      let url = await getActiveTabUrl();
      if (!gerritApiFromUrl(url)) {
        // 2) 当前页不是 Gerrit 才提示输入
        const u = prompt("输入 Gerrit 页面地址");
        if (!u) return;
        url = u.trim();
      }
      await insertGerritCommitByUrl(url);
    };
  }
}catch(e){ console.warn("gerrit bind fail:", e); }


  // 自动保存（无按钮）
  try{
    const saveCfg = async (k, v)=>{
      const got = await chrome.storage.local.get({ cfg:{} });
      const cfg = got.cfg || {};
      cfg[k] = v;
      await chrome.storage.local.set({ cfg });
    };
    const listUrl = $("listUrl");
    const tplArea = $("tplArea");
    listUrl?.addEventListener("input", ()=> saveCfg("listUrl", listUrl.value.trim()));
    tplArea?.addEventListener("input", ()=> saveCfg("tmpl", tplArea.value));
  }catch(e){ console.warn("autosave bind fail:", e); }

  // AI 配置与预设
  try{
    const cfg = await loadAICfg().catch(()=>({enabled:false}));
    const chk = $("chkAI");
    const tpl = $("tplArea");
    if (chk) chk.checked = !!cfg.enabled;
    if (tpl && !tpl.value.trim()) tpl.value = "{{timestamp}}\n# {{AITitle}}\n\n{{AIResponse}}\n\n{{正文}}";

    const btnEdit = $("btnEditPrompt");
    const dlg = $("dlgAI");
    if (btnEdit && dlg){
      const aiBase = $("aiBase");
      const aiModel = $("aiModel");
      const aiKey = $("aiKey");
      const aiPrompt = $("aiPrompt");
      btnEdit.onclick = async ()=>{
        const cur = await loadAICfg().catch(()=>({}));
        if (aiBase) aiBase.value = cur.base || "https://api.deepseek.com/v1";
        if (aiModel) aiModel.value = cur.model || "deepseek-chat";
        if (aiKey) aiKey.value = cur.key || "";
        if (aiPrompt) aiPrompt.value = cur.prompt || "";
        try{ dlg.showModal(); }catch(_){ dlg.open = true; }
      };
      const closeDlg = ()=>{ try{ dlg.close(); }catch(_){ dlg.open=false; } };
      $("aiCancel")?.addEventListener("click", closeDlg);
      $("aiSave")?.addEventListener("click", async ()=>{
        const updated = {
          enabled: !!$("chkAI")?.checked,
          base: aiBase?.value?.trim() || "https://api.deepseek.com/v1",
          model: aiModel?.value?.trim() || "deepseek-chat",
          key: aiKey?.value?.trim() || "",
          prompt: aiPrompt?.value?.trim() || ""
        };
        await saveAICfg(updated);
        closeDlg();
      });
      // 勾选变化即存
      chk?.addEventListener("change", async ()=>{
        const cur = await loadAICfg().catch(()=>({}));
        cur.enabled = !!chk.checked;
        await saveAICfg(cur);
      });
    }
  }catch(e){
    console.warn("AI init fail:", e);
    setStatus("配置加载失败: " + (e?.message || e));
  }

  // 提交评论
  try{
    const btnSend = $("btnSend");
    if (btnSend){
      btnSend.onclick = async ()=>{
        const sel = $("selItems");
        const href = sel?.value || "";
        if (!href){ setStatus("未选择任务"); return; }
        const abs = new URL("http://pha.tp-link.com.cn" + href).href;
        const id = (href.match(/\/T(\d+)/) || [])[1];
        if (!id){ setStatus("解析任务ID失败"); return; }

        let bodyContent = $("txtContent")?.value || "";
        let content = bodyContent;

        // AI summarize + 模板渲染
        try{
          const cfgNow = await loadAICfg();
          const aiEnabled = !!$("chkAI")?.checked || !!cfgNow?.enabled;
          const timestamp = formatDate("[YYYY-MM-DD HH:mm:ss]");
          let AITitle = "", AIResponse = "";
          if (aiEnabled){
            const ask = { type:"aiSummarize", content: bodyContent, prompt: cfgNow.prompt || "" };
            setStatus("AI 总结中…");
            const ai = await chrome.runtime.sendMessage(ask);
            if (ai?.ok){ AITitle = ai.title || ""; AIResponse = ai.reply || ""; setStatus("AI 总结完成"); }
            else { setStatus("AI 总结失败: " + (ai?.error || "")); }
          }
          const tpl = $("tplArea")?.value || "{{timestamp}}\n# {{AITitle}}\n\n{{AIResponse}}\n\n{{正文}}";
          content = substituteTemplate(tpl, { timestamp, AITitle, AIResponse, body: bodyContent });
        }catch(e){ console.warn("AI/template compose fail:", e); }

        setStatus("提交评论中…");
        const resp = await chrome.runtime.sendMessage({ type:"postComment", taskId: id, taskUrl: abs, content });
        if (resp?.ok){
          setStatus("提交成功，状态码 " + resp.status);
        }else{
          setStatus("提交失败: " + (resp?.error || ("HTTP " + (resp?.status||""))) + (resp?.snippet?("\n"+resp.snippet):""));
        }
      };
    }
  }catch(e){ console.warn("send bind fail:", e); }
  
  
  // ---- 绑定当前任务页 ----
function isTaskUrl(u){ return /^https?:\/\/pha\.tp-link\.com\.cn\/T(\d+)(?:[/?#]|$)/i.test(u||""); }
function extractTaskId(u){ const m=(u||"").match(/\/T(\d+)(?:[/?#]|$)/i); return m?m[1]:""; }
function ensureSelectHasTask(id){
  const sel = $("selItems"); if (!sel) return;
  const v = "/T" + id;
  let opt = Array.from(sel.options).find(o => o.value === v);
  if (!opt){
    opt = document.createElement("option");
    opt.value = v;
    opt.textContent = "[绑定] T" + id;
    sel.insertBefore(opt, sel.firstChild);
  }
  sel.value = v;             // 选中
}

async function getActiveTabUrl(){
  const [tab] = await chrome.tabs.query({ active:true, lastFocusedWindow:true }).catch(()=>[]);
  return tab?.url || "";
}

function isTaskUrl(u){ return /^https?:\/\/pha\.tp-link\.com\.cn\/T(\d+)(?:[/?#]|$)/i.test(u||""); }
function extractTaskId(u){ const m=(u||"").match(/\/T(\d+)(?:[/?#]|$)/i); return m?m[1]:""; }
async function getActiveTabUrl(){
  const [tab] = await chrome.tabs.query({ active:true, lastFocusedWindow:true }).catch(()=>[]);
  return tab?.url || "";
}

async function refreshBindButton(){
  const btn = $("btnBind"); if (!btn) return;
  const cur = await getActiveTabUrl();
  let target = "";

  if (isTaskUrl(cur)) {
    target = cur.split("#")[0];
  } else if (/^https?:\/\/review\.tp-link\.net\//i.test(cur||"")) {
    const r = await chrome.runtime.sendMessage({ type:"guessTaskFromGerrit", url: cur }).catch(()=>null);
    if (r?.ok && r.id) target = "http://pha.tp-link.com.cn/T" + r.id;
  }

  btn.style.display = target ? "inline-flex" : "none";
  btn.dataset.curUrl = target || "";
}

// 初始与轮询
(function bindCurrentPageInit(){
  const btn = $("btnBind"); if (!btn) return;
  btn.onclick = async ()=>{
    const url = btn.dataset.curUrl || "";
    if (!url) return;
    const id = extractTaskId(url);
    setTaskLink(url);
    if (id) ensureSelectHasTask(id);
    setStatus("已绑定：" + (id ? "T"+id : url));
  };
  refreshBindButton();
  setInterval(refreshBindButton, 2000);
})();


  
});

// 在 DOMReady 之前的 loadConfig 兜底（若需要）
if (document.readyState !== "loading"){ loadConfig().catch(()=>{}); }
