const PANEL_NAME = "pha-panel";

/* panel.js v0.8.3-clean */
const $ = id => document.getElementById(id);

// ----- status helpers -----
const setStatus = s => { const el = $("status"); if (el) { el.textContent = s; el.scrollTop = el.scrollHeight; } };
const log = s => { const el = $("status"); if (el) { el.textContent = (el.textContent ? el.textContent + "\n" : "") + s; el.scrollTop = el.scrollHeight; } };
window.addEventListener("error", e => { try { const s = $("status"); if (s) s.textContent = "脚本错误: " + (e.message || "unknown"); } catch (_) { } });



// ----- small utils -----
/* -------- Gerrit helpers -------- */
// 从 Gerrit 页面 URL 推导 API（优先 numeric changeId，rev 不给则用 current）
function gerritApiFromUrl(pageUrl) {
  try {
    const s = String(pageUrl || "").trim();
    const u = new URL(s);
    // 直接抓 /+/<change>[/<rev>]，不依赖前缀是否含 /gerrit 或具体 repo 路径
    const m = u.pathname.match(/\/\+\/(\d+)(?:\/(\d+))?/);
    if (!m) return null;
    const changeId = m[1];
    const rev = m[2] || "current";
    const api = `${u.origin}/gerrit/changes/${changeId}/revisions/${rev}/commit`;
    return { api, changeId, rev, canonical: s };
  } catch { return null; }
}

// 插入整理后的文本到正文
async function insertGerritCommitByUrl(inputUrl) {
  const ta = $("txtContent");
  if (!ta) { setStatus("未找到正文输入框"); return; }
  const parsed = gerritApiFromUrl(inputUrl);
  if (!parsed) { setStatus("无法解析该 Gerrit 地址： " + inputUrl); return; }

  setStatus("获取 Gerrit 提交说明中…");
  const res = await chrome.runtime.sendMessage({ type: "fetchGerritCommit", api: parsed.api, url: parsed.canonical }).catch(() => null);
  if (!res?.ok) { setStatus("获取失败: " + (res?.error || "")); return; }

  const msg = (res.message || "").trim();
  if (!msg) { setStatus("未读到提交说明"); return; }

  const block =
    `\n**[Gerrit]**\n${parsed.canonical}\n\n**提交说明**\n\`\`\` lines=10\n${msg}\n\`\`\`\n`;


  insertAtCursor(ta, block);
  setStatus("已插入 Gerrit 提交说明");
}

function setTaskLink(url) {
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
async function refreshTaskSummary(url) {
  const box = $("taskMeta"); if (!box) return;
  const cur = ++metaReqToken;
  box.style.display = "none";
  $("taskTitle").textContent = "";
  $("taskStatus").textContent = "";
  $("taskPriority").textContent = "";
  const res = await chrome.runtime.sendMessage({ type: "fetchTaskSummary", url }).catch(() => null);
  if (cur !== metaReqToken) return; // 过期请求丢弃
  if (res?.ok) { renderTaskSummary(res); }
  else { renderTaskSummary(null); }
}
function renderTaskSummary(meta) {
  const box = $("taskMeta"); if (!box) return;
  const more = $("taskMetaMore");
  if (!meta) { box.style.display = "none"; if (more) more.style.display = "none"; return; }

  $("taskTitle").textContent = meta.title || "";
  $("taskStatus").textContent = "状态: " + (meta.status || "未知");
  $("taskPriority").textContent = "优先级: " + (meta.priority || "未知");

  // 详情渲染
  if (more) {
    if (Array.isArray(meta.details) && meta.details.length) {
      const html = meta.details.map(item => {
        const k = (item.k || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const v = (item.v || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<div style="display:flex;gap:8px;margin-top:4px">
                  <div style="min-width:9em" class="muted">${k}</div>
                  <div style="flex:1">${v}</div>
                </div>`;
      }).join("");
      more.innerHTML = html;
    } else {
      more.innerHTML = `<div class="muted">无更多属性</div>`;
    }
    more.style.display = "none"; // 默认收起
  }
  box.style.display = "block";
}

async function restoreTaskBinding() {
  const sel = $("selItems");               // ★ 必须先拿到 sel
  if (!sel) return;
  try {
    const { phaPanelSelectedItem: selectedHref } =
      await chrome.storage.local.get('phaPanelSelectedItem');

    // 若切回时下拉项为空，先用缓存列表填充
    if (sel.options.length === 0) {
      const { phaPanelSelectItems: savedItems } =
        await chrome.storage.local.get('phaPanelSelectItems');
      if (Array.isArray(savedItems) && savedItems.length) {
        fillSelect(savedItems);
      }
    }

    // 选中历史项（若有）
    if (selectedHref) {
      const idx = Array.from(sel.options).findIndex(o => o.value === selectedHref);
      if (idx >= 0) sel.selectedIndex = idx;
    }

    // 无论是否命中历史项，都强制同步一次
    syncSelectToTask();
  } catch (e) {
    console.warn("恢复任务绑定失败:", e);
  }
}


// 在页面显示时调用恢复函数（处理面板切换场景）
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    restoreTaskBinding().catch(e => console.warn("恢复任务绑定过程中的错误:", e));
  }
});

// DOMContentLoaded 里追加一次性绑定
(function bindMetaToggle() {
  const btn = $("metaToggle");
  const more = $("taskMetaMore");
  if (!btn || !more) return;
  btn.onclick = () => {
    const vis = more.style.display !== "none";
    more.style.display = vis ? "none" : "block";
    btn.textContent = vis ? "▾" : "▴";
  };
})();



function pad(n) { return n < 10 ? "0" + n : String(n); }
/* 支持 YYYY MM DD HH mm ss，默认值示例：[2025-09-18 09:04:40] */
function formatDate(fmt) {
  const d = new Date();
  const map = {
    "YYYY": String(d.getFullYear()),
    "MM": pad(d.getMonth() + 1),
    "DD": pad(d.getDate()),
    "HH": pad(d.getHours()),
    "mm": pad(d.getMinutes()),
    "ss": pad(d.getSeconds())
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, m => map[m] || m);
}

async function loadConfig() {
  // 返回 {}，避免解构或属性访问报错
  const got = await chrome.storage.local.get(null).catch(() => ({}));

  // 安全读取配置
  let url = "";
  let userName = "";
  if (got && typeof got === "object" && got.cfg && typeof got.cfg === "object") {
    // 忽略配置中的listUrl，始终使用固定URL
    // const v = got.cfg.listUrl;
    // if (typeof v === "string" && v.trim() !== "") url = v.trim();

    const un = got.cfg.userName;
    if (typeof un === "string") userName = un;
  }

  // 安全写 DOM - 使用固定URL
  const elUrl = document.getElementById("listUrl");
  if (elUrl) elUrl.value = "http://pha.tp-link.com.cn/maniphest/query/ITSeQjt2W8tk/#R";

  const elUserName = document.getElementById("userName");
  if (elUserName) elUserName.value = userName;
}


async function saveAICfg(cfg) { await chrome.storage.local.set({ aiCfg: cfg }); }
async function loadAICfg() {
  const { aiCfg } = await chrome.storage.local.get({ aiCfg: null });
  return aiCfg || {
    enabled: false,
    base: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    key: "",
    prompt: '你是任务总结助手。请阅读输入正文，并完成以下要求：提炼一个≤40字的小标题，语言自然、贴近语境。1).在 "reply" 中总结输入内容的隐含价值、动机、趋势或潜在意义，可分条列出，支持markdown语法；避免口语化和模板化语气。 2).严格以 JSON 输出，格式如下：{"title":"...", "reply":"..."}'
  };
}
function substituteTemplate(tpl, vars) {
  return (tpl || "")
    .replaceAll("{{timestamp}}", vars.timestamp || "")
    .replaceAll("{{AITitle}}", vars.AITitle || "")
    .replaceAll("{{AIResponse}}", vars.AIResponse || "")
    .replaceAll("{{正文}}", vars.body || "");
}

// ----- DOM helpers -----
function insertAtCursor(textarea, text) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const before = textarea.value.slice(0, start);
  const after = textarea.value.slice(end);
  textarea.value = before + text + after;
  const pos = start + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.focus();
}
function insertAroundSelection(textarea, left, right) {
  if (!textarea) return;
  const start = textarea.selectionStart ?? 0;
  const end = textarea.selectionEnd ?? 0;
  const val = textarea.value;
  const sel = val.slice(start, end) || "";
  const before = val.slice(0, start);
  const after = val.slice(end);
  const text = left + sel + right;
  textarea.value = before + text + after;
  const pos = before.length + text.length;
  textarea.selectionStart = textarea.selectionEnd = pos;
  textarea.focus();
}
function syncSelectToTask() {
  const sel = $('selItems');
  if (!sel) return;
  const href = sel.value || '';
  const abs = href ? new URL('http://pha.tp-link.com.cn' + href).href : '';
  setTaskLink(abs);
  try { chrome.storage.local.set({ 'phaPanelSelectedItem': href }); } catch (_) { }
  
  // 更新评论持久化绑定
  updateCommentPersistence().catch(e => console.warn('更新评论持久化失败:', e));
}


// ----- list / upload -----
function fillSelect(items) {
  const sel = $("selItems"); if (!sel) return;
  sel.innerHTML = "";
  for (const it of items) {
    const opt = document.createElement("option");
    opt.value = it.href;
    opt.textContent = it.title;
    sel.appendChild(opt);
  }
  setStatus(`已载入 ${items.length} 项`);
  // 仅保存列表，不自动绑定第一项，避免覆盖已选
  try { chrome.storage.local.set({ 'phaPanelSelectItems': items }); } catch (_) { }
}

async function fetchList(url) {
  const resp = await chrome.runtime.sendMessage({ type: "fetchListPage", url });
  if (!resp?.ok) throw new Error("抓取失败 HTTP " + (resp?.status || "") + (resp?.snippet ? ("\n" + resp.snippet) : ""));
  const html = resp.text || "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  let links = doc.querySelectorAll('span[data-sigil="slippery"] a.phui-oi-link[href^="/T"]');
  if (!links || links.length === 0) {
    links = doc.querySelectorAll('a.phui-oi-link[href^="/T"]');
  }
  const items = Array.from(links).map(a => ({
    href: a.getAttribute("href"),
    title: a.textContent.trim()
  })).filter(x => x.href && x.title);
  return items;
}
async function uploadBlob(name, mime, arrayBuffer) {
  const msg = {
    type: "uploadFile",
    filename: name,
    mime: mime || "application/octet-stream",
    bytes: Array.from(new Uint8Array(arrayBuffer)),
    via: ($("selItems")?.value || "")
  };
  const upl = await chrome.runtime.sendMessage(msg);
  if (upl?.ok) {
    return upl.monogram ? `{${upl.monogram}, size=full, layout=center}` : (upl.url || "");
  }
  throw new Error((upl?.error || "上传失败") + (upl?.snippet ? ("\n" + upl.snippet) : ""));
}

// ----- markdown bar -----
function bindMarkdownBar() {
  const ta = $("txtContent");
  const bar = $("mdBar");
  if (!bar || !ta) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest("button.mdbtn");
    if (!btn) return;
    const type = btn.getAttribute("data-md");
    switch (type) {
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
// 自动调整textarea高度的函数
function adjustTextareaHeight(textarea) {
  if (!textarea) return;
  
  // 重置高度以获取正确的滚动高度
  textarea.style.height = 'auto';
  
  // 获取内容所需的实际高度
  const scrollHeight = textarea.scrollHeight;
  
  // 设置最大高度
  const maxHeight = 280; // 与CSS中的max-height保持一致
  
  // 根据内容调整高度，但不超过最大高度
  if (scrollHeight > maxHeight) {
    textarea.style.height = maxHeight + 'px';
    textarea.style.overflowY = 'auto'; // 显示滚动条
  } else {
    textarea.style.height = scrollHeight + 'px';
    textarea.style.overflowY = 'hidden'; // 隐藏滚动条
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  // 初始配置
  try { await loadConfig(); } catch (e) { setStatus("配置加载失败: " + (e?.message || e)); }
  
  // 初始化txtContent的自动高度调整
  const txtContent = $("txtContent");
  if (txtContent) {
    // 初始调整高度
    adjustTextareaHeight(txtContent);
    
    // 添加输入事件监听器，实现输入时自动调整高度
    txtContent.addEventListener('input', () => {
      adjustTextareaHeight(txtContent);
    });
  }

  // 尝试从localStorage恢复下拉框选项
  try {
    const result = await chrome.storage.local.get('phaPanelSelectItems');
    const savedItems = result.phaPanelSelectItems;
    if (savedItems && Array.isArray(savedItems) && savedItems.length > 0) {
      // 只在当前下拉框为空时恢复选项，避免覆盖已有的数据
      const sel = $("selItems");

      if (sel) { sel.onchange = syncSelectToTask; }


      if (sel && sel.options.length === 0) {
        fillSelect(savedItems);

        try {
          const { phaPanelSelectedItem: selectedHref } =
            await chrome.storage.local.get('phaPanelSelectedItem');
          if (selectedHref) {
            const i = Array.from(sel.options).findIndex(o => o.value === selectedHref);
            if (i >= 0) sel.selectedIndex = i;
          }
          syncSelectToTask();  // ★ 统一强制同步
        } catch (e) {
          console.warn("恢复选中项失败:", e);
        }

      }
    }
  } catch (e) {
    console.warn("恢复下拉框选项失败:", e);
  }

  // 抓取 + 清空 + 下拉变化
  try {
    const btnLoad = $("btnLoad");
    const btnClear = $("btnClear");
    const sel = $("selItems");
    const link = $("taskLink");
    
    // 始终使用固定的URL
    const FIXED_LIST_URL = "http://pha.tp-link.com.cn/maniphest/query/ITSeQjt2W8tk/#R";

    if (btnLoad) {
      btnLoad.onclick = async () => {
        try {
          setStatus("抓取中…");
          const items = await fetchList(FIXED_LIST_URL);
          if (!items || items.length === 0) {
            setStatus("未解析到任务，检查是否已登录或查询URL是否正确");
          } else {
            fillSelect(items);
            if (sel && sel.options.length) syncSelectToTask();

          }
        } catch (e) {
          setStatus((e && e.message) || "抓取异常");
        }
      };
    }
    if (btnClear) {
      btnClear.onclick = () => {
        if (sel) sel.innerHTML = "";
        setStatus("已清空");
      };
    }

  } catch (e) { console.warn("list binds fail:", e); }

  // 粘贴上传
  try {
    const ta = $("txtContent");
    if (ta) {
      ta.addEventListener("paste", async (e) => {
        const items = e.clipboardData?.items || [];
        for (const it of items) {
          if (it.kind === "file") {
            e.preventDefault();
            const file = it.getAsFile(); if (!file) continue;
            setStatus("粘贴文件上传中… " + (file.name || "clipboard.bin"));
            try {
              const buf = await file.arrayBuffer();
              const tag = await uploadBlob(file.name || "clipboard.bin", file.type, buf);
              insertAtCursor(ta, tag ? ("\n" + tag + "\n") : "");
              setStatus("粘贴上传完成");
            } catch (err) {
              setStatus("粘贴上传失败: " + (err?.message || err));
            }
          }
        }
      });
      ta.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
      ta.addEventListener("drop", async (e) => {
        e.preventDefault();
        const files = e.dataTransfer?.files || [];
        for (const file of files) {
          setStatus("拖拽文件上传中… " + (file.name || "file.bin"));
          try {
            const buf = await file.arrayBuffer();
            const tag = await uploadBlob(file.name || "file.bin", file.type, buf);
            insertAtCursor(ta, tag ? ("\n" + tag + "\n") : "");
            setStatus("拖拽上传完成");
          } catch (err) {
            setStatus("拖拽上传失败: " + (err?.message || err));
          }
        }
      });
    }
  } catch (e) { console.warn("paste/drop bind fail:", e); }

  // Markdown 工具条
  try { bindMarkdownBar(); } catch (e) { console.warn("md bar bind fail:", e); }

  // DDDD 工作量弹窗（选择即确认）
  try {
    const dlg = $("dlgEffort");
    const sel = $("effortSelect");
    const cancel = $("effortCancel");
    const ta = $("txtContent");
    if (dlg && sel && ta) {
      const close = () => { try { dlg.close(); } catch (_) { dlg.open = false; } };

      // 选择即确认；插入后把 select 重置，确保下次同值也会触发 onchange
      sel.onchange = () => {
        const v = sel.value || "";
        if (v) {
          insertAtCursor(ta, "\n(工作耗时：" + v + "）");
        }
        sel.selectedIndex = -1; // 关键：重置选中项
        close();
      };
      if (cancel) cancel.onclick = close;

      ta.addEventListener("input", (e) => {
        if (e.isComposing) return;                        // 兼容中文输入法
        const v = ta.value || "";
        const m = v.match(/(DDDD|dddd)\s*$/);             // 忽略结尾空白
        if (m) {
          ta.value = v.replace(/(DDDD|dddd)\s*$/, "");    // 去掉触发标记
          try { dlg.close(); } catch (_) { dlg.open = false; }  // 先重置状态
          try { dlg.showModal(); } catch (_) { dlg.open = true; }
        }
      });
    }
  } catch (e) { console.warn("effort bind fail:", e); }


  // POST 模板对话框
  try {
    const btnTpl = $("btnTpl");
    const dlgTpl = $("dlgTpl");
    const taTpl = $("tplArea");
    if (taTpl && !taTpl.value.trim()) {
      taTpl.value = "> {{timestamp}}\n(NOTE) {{AITitle}}\n\n{{AIResponse}}\n\n--------\n\n{{正文}}";
    }
    if (btnTpl && dlgTpl) {
      const closeTpl = () => { try { dlgTpl.close(); } catch (_) { dlgTpl.open = false; } };
      $("tplCancel")?.addEventListener("click", closeTpl);
      $("tplSave")?.addEventListener("click", closeTpl);
      btnTpl.onclick = () => { try { dlgTpl.showModal(); } catch (_) { dlgTpl.open = true; } };
    }
  } catch (e) { console.warn("tpl bind fail:", e); }

  // 统计耗时
  try {
    const btn = $("btnSumWL");
    if (btn) {
      btn.onclick = async () => {
        const a = $("taskLink");
        const url = a?.href || "";
        if (!url) { setStatus("未找到任务链接"); return; }
        setStatus("统计耗时中…");
        const res = await chrome.runtime.sendMessage({ type: "sumWorkload", url });
        if (res?.ok) {
          const ta = $("txtContent");
          if (ta) {
            const text = "\n截止目前总计耗时：" + res.days + "D";
            insertAtCursor(ta, text);
          }
          setStatus("统计完成：" + res.days + "D");
        } else {
          setStatus("统计失败: " + (res?.error || ""));
        }
      };
    }
  } catch (e) { console.warn("sum workload bind fail:", e); }

  async function getActiveTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    return tab?.url || "";
  }

  try {
    const btn = $("btnGerrit");
    if (btn) {
      btn.onclick = async () => {
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
  } catch (e) { console.warn("gerrit bind fail:", e); }


  // 自动保存（无按钮）
  try {
    const saveCfg = async (k, v) => {
      const got = await chrome.storage.local.get({ cfg: {} });
      const cfg = got.cfg || {};
      cfg[k] = v;
      await chrome.storage.local.set({ cfg });
    };
    // const listUrl = $("listUrl"); // 不再需要，使用固定URL
    const tplArea = $("tplArea");
    const userName = $("userName");
    // listUrl?.addEventListener("input", () => saveCfg("listUrl", listUrl.value.trim())); // 不再需要
    tplArea?.addEventListener("input", () => saveCfg("tmpl", tplArea.value));
    userName?.addEventListener("input", () => saveCfg("userName", userName.value.trim()));
  } catch (e) { console.warn("autosave bind fail:", e); }

  // AI 配置与预设
  try {
    const cfg = await loadAICfg().catch(err => {
      console.warn("加载AI配置失败:", err);
      return { enabled: false };
    });
    const chk = $("chkAI");
    const tpl = $("tplArea");
    if (chk) {
      chk.checked = !!cfg.enabled;

      // 勾选变化即存
      chk.addEventListener("change", async () => {
        try {
          const cur = await loadAICfg().catch(() => ({}));
          cur.enabled = !!chk.checked;
          await saveAICfg(cur);
        } catch (e) {
          console.warn("保存AI启用状态失败:", e);
        }
      });
    }
    if (tpl && !tpl.value.trim()) tpl.value = "> {{timestamp}}\n(NOTE) {{AITitle}}\n\n{{AIResponse}}\n\n--------\n\n{{正文}}";

    const btnEdit = $("btnEditPrompt");
    const dlg = $("dlgAI");
    if (btnEdit && dlg) {
      const aiBase = $("aiBase");
      const aiModel = $("aiModel");
      const aiKey = $("aiKey");
      const aiPrompt = $("aiPrompt");
      btnEdit.onclick = async () => {
        const cur = await loadAICfg().catch(() => ({}));
        if (aiBase) aiBase.value = cur.base || "https://api.deepseek.com/v1";
        if (aiModel) aiModel.value = cur.model || "deepseek-chat";
        if (aiKey) aiKey.value = cur.key || "";
        if (aiPrompt) aiPrompt.value = cur.prompt || "";
        try { dlg.showModal(); } catch (_) { dlg.open = true; }
      };
      const closeDlg = () => { try { dlg.close(); } catch (_) { dlg.open = false; } };
      $("aiCancel")?.addEventListener("click", closeDlg);
      $("aiSave")?.addEventListener("click", async () => {
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
      // 事件监听器已在前面添加，这里不再重复绑定
    }
  } catch (e) {
    console.warn("AI init fail:", e);
    setStatus("配置加载失败: " + (e?.message || e));
  }

  // 提交评论
  try {
    const btnSend = $("btnSend");
    if (btnSend) {
      btnSend.onclick = async () => {
        const sel = $("selItems");
        const href = sel?.value || "";
        if (!href) { setStatus("未选择任务"); return; }
        const abs = new URL("http://pha.tp-link.com.cn" + href).href;
        const id = (href.match(/\/T(\d+)/) || [])[1];
        if (!id) { setStatus("解析任务ID失败"); return; }

        let bodyContent = $("txtContent")?.value || "";
        let content = bodyContent;

        let AITitle = "", AIResponse = "";

        // AI summarize + 模板渲染
        try {
          const cfgNow = await loadAICfg();
          // 弹窗让用户选择是否使用AI辅助分析
          const useAI = confirm('是否使用AI辅助分析？');
          const timestamp = formatDate("[YYYY-MM-DD HH:mm:ss]");
          if (useAI) {
            const ask = { type: "aiSummarize", content: bodyContent, prompt: cfgNow.prompt || "" };
            setStatus("AI 预处理中…");
            const ai = await chrome.runtime.sendMessage(ask);
            if (ai?.ok) { AITitle = ai.title || ""; AIResponse = ai.reply || ""; setStatus("AI 处理完成"); }
            else { setStatus("AI 处理失败: " + (ai?.error || "")); }
          }
          const tpl = $("tplArea")?.value || "> {{timestamp}}\n(NOTE) {{AITitle}}\n\n{{AIResponse}}\n\n--------\n\n{{正文}}";
          content = substituteTemplate(tpl, { timestamp, AITitle, AIResponse, body: bodyContent });
        } catch (e) { console.warn("AI/template compose fail:", e); }

        setStatus("提交评论中…");
        const resp = await chrome.runtime.sendMessage({ type: "postComment", taskId: id, taskUrl: abs, content });
        if (resp?.ok) {
          await chrome.runtime.sendMessage({
            type: "cache:addPost",
            panel: PANEL_NAME,
            taskId: String(id),
            content: typeof content === "string" ? content : JSON.stringify(content),
            aiTitle: String(AITitle || ""),
            aiReply: String(AIResponse || ""),
            time: Date.now()
          });
          setStatus("提交成功，状态码 " + resp.status);
        } else {
          setStatus("提交失败: " + (resp?.error || ("HTTP " + (resp?.status || ""))) + (resp?.snippet ? ("\n" + resp.snippet) : ""));
        }
      };
    }
  } catch (e) { console.warn("send bind fail:", e); }


  // ---- 绑定当前任务页 ----
  function isTaskUrl(u) { return /^https?:\/\/pha\.tp-link\.com\.cn\/T(\d+)(?:[/?#]|$)/i.test(u || ""); }
  function extractTaskId(u) { const m = (u || "").match(/\/T(\d+)(?:[/?#]|$)/i); return m ? m[1] : ""; }
  function ensureSelectHasTask(id) {
    const sel = $("selItems"); if (!sel) return;
    const v = "/T" + id;
    let opt = Array.from(sel.options).find(o => o.value === v);
    if (!opt) {
      opt = document.createElement("option");
      opt.value = v;
      opt.textContent = "[绑定] T" + id;
      sel.insertBefore(opt, sel.firstChild);
    }
    sel.value = v;             // 选中
  }

  async function getActiveTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    return tab?.url || "";
  }

  function isTaskUrl(u) { return /^https?:\/\/pha\.tp-link\.com\.cn\/T(\d+)(?:[/?#]|$)/i.test(u || ""); }
  function extractTaskId(u) { const m = (u || "").match(/\/T(\d+)(?:[/?#]|$)/i); return m ? m[1] : ""; }
  async function getActiveTabUrl() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    return tab?.url || "";
  }

  async function refreshBindButton() {
    const btn = $("btnBind"); if (!btn) return;
    const cur = await getActiveTabUrl();
    let target = "";

    if (isTaskUrl(cur)) {
      target = cur.split("#")[0];
    } else if (/^https?:\/\/review\.tp-link\.net\//i.test(cur || "")) {
      const r = await chrome.runtime.sendMessage({ type: "guessTaskFromGerrit", url: cur }).catch(() => null);
      if (r?.ok && r.id) target = "http://pha.tp-link.com.cn/T" + r.id;
    }

    btn.style.display = target ? "inline-flex" : "none";
    btn.dataset.curUrl = target || "";
  }

  // 初始与轮询
  (function bindCurrentPageInit() {
    const btn = $("btnBind"); if (!btn) return;
    btn.onclick = async () => {
      const url = btn.dataset.curUrl || "";
      if (!url) return;
      const id = extractTaskId(url);
      setTaskLink(url);
      if (id) ensureSelectHasTask(id);
      setStatus("已绑定：" + (id ? "T" + id : url));
    };
    refreshBindButton();
    setInterval(refreshBindButton, 2000);
  })();



});

// 初始化评论持久化
setTimeout(() => {
  updateCommentPersistence().catch(e => console.warn('初始化评论持久化失败:', e));
}, 500);

// 在 DOMReady 之前的 loadConfig 兜底（若需要）
if (document.readyState !== "loading") { loadConfig().catch(() => { }); }

// 竖条按钮 → 通知 SW 切换到目标 panel.html
(function () {
  document.addEventListener('DOMContentLoaded', () => {
    const rail = document.querySelector('.rail');
    if (!rail) return;
    rail.addEventListener('click', (e) => {
      const btn = e.target.closest('.railbtn');
      if (!btn) return;
      chrome.runtime.sendMessage({ type: "switchPanel", name: btn.getAttribute('data-target') });
    });
  });
})();


// === 周报 ===
(function () {
  const PANEL_NAME = "pha-panel";
  const $ = (s) => document.querySelector(s);
  const logEl = $("#status");

  // 日志工具
  function ts() { const d = new Date(); return d.toISOString().slice(11, 19); } // HH:MM:SS
  function ensureLogArea() {
    if (!logEl) return;
    logEl.style.maxHeight = "none";         // 允许完整显示
    logEl.style.overflowY = "auto";
  }
  function logLine(line) {
    if (!logEl) return;
    logEl.textContent += `[${ts()}] ${line}\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  function logBlock(title, objOrStr) {
    logLine(title);
    const s = typeof objOrStr === "string" ? objOrStr :
      JSON.stringify(objOrStr, null, 2);
    for (const ln of String(s).split(/\r?\n/)) logLine("  " + ln);
  }
  function clearLog() { if (logEl) logEl.textContent = ""; }

  // 时间与工具
  function ymd(d) { const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0"); return `${y}${m}${dd}`; }
  function lastWorkWeek(now = new Date()) {
    const day = now.getDay();                   // 0..6
    const diffFri = ((day - 5 + 7) % 7) || 7;   // 上一个周五；周五也回退一周
    const fri = new Date(now); fri.setHours(23, 59, 59, 999); fri.setDate(fri.getDate() - diffFri);
    const mon = new Date(fri); mon.setHours(0, 0, 0, 0); mon.setDate(mon.getDate() - 4);
    return { mon, fri };
  }
  function normTaskId(x) { return String(x || "").trim().replace(/^T/i, ""); }
  function clip(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n) + "…" : s; }

  function isDone(status) {
    const s = String(status || "").trim();
    // 中文：必须带“已”，避免把“未完成”命中
    const zh = /(已完成|已完成(不加入统计))/;
    // 英文：词边界，避免 "undone"
    const en = /\b(resolved|closed|done|fixed|merged)\b/i;
    return zh.test(s) || en.test(s.toLowerCase());
  }


  async function fetchTaskMeta(taskIdNum) {
    const url = `http://pha.tp-link.com.cn/T${taskIdNum}`;
    try {
      const r = await chrome.runtime.sendMessage({ type: "fetchTaskSummary", url });
      logBlock(`任务 T${taskIdNum} 元信息`, { url, title: r?.title || "", status: r?.status || "", priority: r?.priority || "" });
      return { status: r?.status || "", title: r?.title || "" };
    } catch (e) {
      logBlock(`任务 T${taskIdNum} 元信息失败`, String(e));
      return { status: "", title: "" };
    }
  }


  function buildAiPrompt(done) {
    return [
      "你将获得同一任务在本工作周的多条「AI 标题」（每条为一句话小标题）。",
      "请：",
      "1) 以≤22字输出该任务的“简要描述”（不用任务号）。",
      done
        ? "2) 根据这些标题提炼2-3条值得关注的细节，短句，动宾结构。"
        : "2) 用≤40字概述“剩余内容”（仍未完成的部分）。",
      '只返回严格JSON：{"title":"简要描述","reply":"多行文本"}',
      done
        ? '其中 reply 为每行一个“细节”项目，最多3行，不要前缀符号。'
        : '其中 reply 只包含一行，以“剩余：”开头。'
    ].join("\n");
  }


  function parseAiReplyLines(reply) {
    const lines = String(reply || "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return lines.slice(0, 3);
  }


  async function genWeekly() {
    ensureLogArea();
    clearLog();
    logLine("开始生成周报…");

    const { mon, fri } = lastWorkWeek(new Date());
    const start = mon.getTime(), end = fri.getTime();
    const rangeInfo = { 开始: mon.toISOString(), 结束: fri.toISOString(), 开始YMD: ymd(mon), 结束YMD: ymd(fri) };
    logBlock("时间范围（最近工作周一~周五）", rangeInfo);

    // 取缓存数据
    logLine("查询缓存数据库…");
    const q = await chrome.runtime.sendMessage({
      type: "cache:queryByTime", panel: PANEL_NAME, start, end, limit: 5000
    }).catch(e => ({ ok: false, error: String(e) }));
    logBlock("缓存查询结果头", { ok: q?.ok, count: q?.items?.length || 0, error: q?.error });

    const rows = Array.isArray(q?.items) ? q.items : [];
    if (!rows.length) {
      logLine("本周无缓存数据，输出空模板。");
      const title = `【工作周报】${ymd(mon)}-${ymd(fri)}`;
      const md = `${title}\n\n### 本周已完成任务\n\n（无）\n\n\n### 本周仍未完成任务\n\n（无）\n`;
      logBlock("最终周报", md);
      $("#txtContent").value = md;
      return;
    }
    // 展示原始数据（具体内容）
    logBlock("本周缓存原始数据（完整）", rows);

    // 按任务归并
    logLine("按任务归并片段…");
    const byTask = new Map();
    for (const it of rows) {
      const idNum = normTaskId(it["任务号"]);
      if (!idNum) continue;
      const arr = byTask.get(idNum) || [];
      arr.push(it);
      byTask.set(idNum, arr);
    }
    const tasks = [...byTask.entries()].map(([idNum, arr]) => ({ idNum, posts: arr.sort((a, b) => a["时间"] - b["时间"]) }));
    logBlock("任务归并结果（每任务条数）", tasks.map(t => ({ task: `T${t.idNum}`, count: t.posts.length })));

    // 拉取任务元信息
    logLine("获取任务状态与标题，并按状态分组…");
    const enriched = await Promise.all(
      tasks.map(async (t) => {
        const url = `http://pha.tp-link.com.cn/T${t.idNum}`;
        const meta = await fetchTaskMeta(t.idNum); // 会去抓取 url
        const done = isDone(meta.status);
        logLine(`T${t.idNum} → ${url} | 状态=${meta.status || "未知"} → ${done ? "已完成" : "未完成"}`);
        return { ...t, meta: { ...meta, url }, done };
      })
    );



    // 仅用每条 post 的 AI 标题（缺失则回退到正文首行）喂给 AI
    async function summarizeTask(t) {
      // 收集并去重 AI 标题；为空时用正文首行片段回退
      const titlesArr = t.posts.map(p => {
        const at = (p.aiTitle ?? p["AI标题"] ?? "").toString().trim();
        if (at) return at;
        const raw = (p["内容"] ?? p.content ?? "").toString();
        const firstLine = raw.split(/\r?\n/).map(s => s.trim()).find(Boolean) || "";
        return firstLine ? clip(firstLine, 22) : "";
      }).filter(Boolean);
      const uniqTitles = [...new Set(titlesArr)];

      const prompt = buildAiPrompt(t.done);
      const content = `任务: T${t.idNum}\n状态: ${t.meta.status || "未知"}\n本周标题:\n- ${uniqTitles.join("\n- ")}`;

      // 日志：仅输出标题清单
      logBlock(`AI 请求 → T${t.idNum}`, { prompt, titles: uniqTitles });

      // 调 AI
      let title = "", lines = [];
      try {
        const r = await chrome.runtime.sendMessage({ type: "aiSummarize", prompt, content });
        logBlock(`AI 返回原文 ← T${t.idNum}`, r);
        title = (r?.title || "").trim();
        lines = parseAiReplyLines(r?.reply);
      } catch (e) {
        logBlock(`AI 调用失败 ← T${t.idNum}`, String(e));
      }

      // 回退策略
      if (!title && !lines.length) {
        const first = titlesArr[0] || (t.posts[0]?.["内容"] || t.meta.title || "");
        title = clip(first, 22) || `T${t.idNum}`;
        lines = t.done ? [clip(first, 40)] : ["剩余：待补充"];
        logBlock(`AI 回退策略输出 ← T${t.idNum}`, { title, lines });
      }

      // 结构化返回
      if (t.done) {
        const bullets = lines.length ? lines : ["无特别风险或阻塞"];
        return { idNum: t.idNum, done: true, brief: title, highlights: bullets };
      } else {
        const remain = lines.find(s => /^剩余：/.test(s)) || "剩余：待补充";
        return { idNum: t.idNum, done: false, brief: title, remain };
      }
    }



    const summaries = await Promise.all(enriched.map(summarizeTask));

    // 组装周报
    const doneList = [], todoList = [];
    for (const s of summaries) {
      if (s.done) {
        doneList.push(
          `- 任务号：{T${s.idNum}}：${s.brief}
          - ${s.highlights[0] || "无"}
          ${s.highlights[1] ? `- ${s.highlights[1]}` : ""}
          ${s.highlights[2] ? `- ${s.highlights[2]}` : ""}`.replace(/\n\s+\n/g, "\n")
        );
      } else {
        todoList.push(
          `- 任务号：{T${s.idNum}}：${s.brief}
          - ${s.remain || "剩余：待补充"}`
        );
      }
    }

    const title = `【工作周报】${ymd(mon)}-${ymd(fri)}`;
    const md =
      `${title}

### 本周已完成任务

${doneList.length ? doneList.join("\n\n") : "（无）"}

### 本周仍未完成任务

${todoList.length ? todoList.join("\n\n") : "（无）"}

`;

    // 输出
    logBlock("最终周报", md);
    $("#txtContent").value = md;

    logLine("周报生成完成。");
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("btnWeekly")?.addEventListener("click", genWeekly);
  });
})();


// ----- 评论内容与任务号联动的持久化功能 -----
let currentTaskId = '';

// 保存当前任务的评论内容
async function saveCommentForCurrentTask() {
  try {
    const ta = $('txtContent');
    if (!ta || !currentTaskId) return;
    
    const commentsByTask = await getCommentsByTask();
    commentsByTask[currentTaskId] = ta.value;
    await chrome.storage.local.set({ 'phaPanelCommentsByTask': commentsByTask });
  } catch (e) {
    console.warn('保存评论内容失败:', e);
  }
}

// 获取所有任务的评论内容
async function getCommentsByTask() {
  try {
    const result = await chrome.storage.local.get('phaPanelCommentsByTask');
    return result.phaPanelCommentsByTask || {};
  } catch (e) {
    console.warn('获取评论内容失败:', e);
    return {};
  }
}

// 加载指定任务的评论内容
async function loadCommentForTask(taskId) {
  try {
    const ta = $('txtContent');
    if (!ta || !taskId) return;
    
    const commentsByTask = await getCommentsByTask();
    ta.value = commentsByTask[taskId] || '';
    currentTaskId = taskId;
  } catch (e) {
    console.warn('加载评论内容失败:', e);
  }
}

// 更新任务评论持久化绑定
async function updateCommentPersistence() {
  const sel = $('selItems');
  if (!sel) return;
  
  // 获取当前选中的任务ID
  const href = sel.value || '';
  const taskId = (href.match(/\/T(\d+)/) || [])[1];
  
  // 如果任务ID发生变化，先保存当前评论，再加载新任务的评论
  if (taskId && taskId !== currentTaskId) {
    await saveCommentForCurrentTask();
    await loadCommentForTask(taskId);
  } else if (taskId) {
    // 如果任务ID相同但currentTaskId未设置，设置它
    currentTaskId = taskId;
  }
}

// 在页面隐藏或关闭前保存评论内容
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) {
    await saveCommentForCurrentTask();
  }
});

window.addEventListener('beforeunload', async () => {
  await saveCommentForCurrentTask();
});
