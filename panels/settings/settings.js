// settings.js —— 多供应商/多模型；向后兼容旧 aiCfg；保留导入导出逻辑
(function () {
  const $ = (sel) => document.querySelector(sel);

  /* ===== 默认与迁移 ===== */
  const builtinPrompt =
    '你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁概述。以严格JSON返回：{"title":"...", "reply":"..."}';

  // 新结构：aiCfg2
  // {
  //   activeVendorId: "v_xxx",
  //   vendors: {
  //     "v_xxx": {
  //       id, name, base, key, prompt, activeModelId,
  //       models: { "m_xxx": { id, name, model, prompt } }
  //     }
  //   }
  // }
  function makeDefaultCfg2() {
    const vid = uid("v");
    const mid = uid("m");
    return {
      activeVendorId: vid,
      vendors: {
        [vid]: {
          id: vid,
          name: "Deepseek",
          base: "https://api.deepseek.com/v1",
          key: "",
          prompt: builtinPrompt,
          activeModelId: mid,
          models: {
            [mid]: { id: mid, name: "deepseek-chat", model: "deepseek-chat", prompt: "" },
          },
        },
      },
    };
  }

  function migrateFromFlat(aiFlat) {
    const cfg2 = makeDefaultCfg2();
    const v = cfg2.vendors[cfg2.activeVendorId];
    v.base   = (aiFlat.base   || v.base).trim();
    v.key    = (aiFlat.key    || v.key ).trim();
    v.prompt = String(aiFlat.prompt || v.prompt);
    const m = v.models[v.activeModelId];
    m.name   = (aiFlat.model || m.name).trim();
    m.model  = m.name;
    return cfg2;
  }

  function flattenToLegacy(aiCfg2) {
    const v = aiCfg2.vendors[aiCfg2.activeVendorId];
    const m = v.models[v.activeModelId];
    const prompt = (m.prompt && m.prompt.trim()) || v.prompt || builtinPrompt;
    return { base: v.base, model: m.model, key: v.key, prompt };
  }

  /* ===== 状态与持久化 ===== */
  const defaultPrefs = { autoOpen: false, useAI: true };
  let aiCfg2 = null; // 工作内存
  let dirty = false;

  function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

  function setStatus(t) { const el = $("#importExportStatus"); if (el) el.textContent = t || ""; }

  async function loadAll() {
    const got = await chrome.storage.local.get({ aiCfg2: null, aiCfg: null, prefs: defaultPrefs }).catch(() => ({}));
    if (got.aiCfg2 && got.aiCfg2.vendors) {
      aiCfg2 = got.aiCfg2;
    } else if (got.aiCfg) {
      aiCfg2 = migrateFromFlat(got.aiCfg);
    } else {
      aiCfg2 = makeDefaultCfg2();
    }
    renderAll();
  }

  async function saveAll() {
    if (!aiCfg2 || !aiCfg2.vendors || !aiCfg2.activeVendorId) return;
    // 同步旧 aiCfg 以兼容现有调用处
    const flat = flattenToLegacy(aiCfg2);
    await chrome.storage.local.set({ aiCfg2, aiCfg: flat });
    dirty = false;
    setStatus("已保存");
  }

  function markDirty() { dirty = true; setStatus("有未保存修改"); }

  /* ===== 渲染与联动 ===== */
  function currentVendor() {
    const id = aiCfg2.activeVendorId;
    return aiCfg2.vendors[id];
  }
  function currentModel() {
    const v = currentVendor();
    return v.models[v.activeModelId];
  }

  function renderVendors() {
    const sel = $("#vendorSelect");
    sel.innerHTML = "";
    const entries = Object.values(aiCfg2.vendors);
    for (const v of entries) {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.name;
      sel.appendChild(opt);
    }
    sel.value = aiCfg2.activeVendorId;
  }

  function renderModels() {
    const v = currentVendor();
    const sel = $("#modelSelect");
    sel.innerHTML = "";
    for (const m of Object.values(v.models)) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
    sel.value = v.activeModelId;
  }

  function renderVendorFields() {
    const v = currentVendor();
    $("#aiBase").value = v.base || "";
    $("#aiKey").value = v.key || "";
    $("#aiVendorPrompt").value = v.prompt || "";
  }

  function renderModelFields() {
    const m = currentModel();
    $("#aiModel").value = m.model || m.name || "";
    $("#modelPrompt").value = m.prompt || "";
  }

  function renderAll() {
    renderVendors();
    renderModels();
    renderVendorFields();
    renderModelFields();
  }

  /* ===== 事件处理：供应商 ===== */
  function onVendorChanged(id) {
    if (!aiCfg2.vendors[id]) return;
    aiCfg2.activeVendorId = id;
    renderModels();
    renderVendorFields();
    renderModelFields();
    markDirty();
  }

  function addVendor() {
    const name = prompt("供应商名称", "Deepseek");
    if (!name) return;
    const vid = uid("v");
    const mid = uid("m");
    aiCfg2.vendors[vid] = {
      id: vid,
      name: name.trim(),
      base: "",
      key: "",
      prompt: builtinPrompt,
      activeModelId: mid,
      models: { [mid]: { id: mid, name: "default", model: "gpt-4o-mini", prompt: "" } },
    };
    aiCfg2.activeVendorId = vid;
    renderAll();
    markDirty();
  }

  function renameVendor() {
    const v = currentVendor();
    const name = prompt("新名称", v.name);
    if (!name) return;
    v.name = name.trim();
    renderVendors();
    markDirty();
  }

  function deleteVendor() {
    const keys = Object.keys(aiCfg2.vendors);
    if (keys.length <= 1) { alert("至少保留一个供应商"); return; }
    const v = currentVendor();
    if (!confirm(`删除供应商「${v.name}」？`)) return;
    delete aiCfg2.vendors[v.id];
    aiCfg2.activeVendorId = Object.keys(aiCfg2.vendors)[0];
    renderAll();
    markDirty();
  }

  /* ===== 事件处理：模型 ===== */
  function onModelChanged(id) {
    const v = currentVendor();
    if (!v.models[id]) return;
    v.activeModelId = id;
    renderModelFields();
    markDirty();
  }

  function addModel() {
    const v = currentVendor();
    const modelId = prompt("模型 ID（例如 deepseek-chat）", "deepseek-chat");
    if (!modelId) return;
    const name = prompt("模型显示名（可与模型ID相同）", modelId) || modelId;
    const mid = uid("m");
    v.models[mid] = { id: mid, name: name.trim(), model: modelId.trim(), prompt: "" };
    v.activeModelId = mid;
    renderModels();
    renderModelFields();
    markDirty();
  }

  function renameModel() {
    const v = currentVendor();
    const m = currentModel();
    const name = prompt("新显示名", m.name || m.model);
    if (!name) return;
    m.name = name.trim();
    renderModels();
    markDirty();
  }

  function deleteModel() {
    const v = currentVendor();
    const ids = Object.keys(v.models);
    if (ids.length <= 1) { alert("至少保留一个模型"); return; }
    const m = currentModel();
    if (!confirm(`删除模型「${m.name || m.model}」？`)) return;
    delete v.models[m.id];
    v.activeModelId = Object.keys(v.models)[0];
    renderModels();
    renderModelFields();
    markDirty();
  }

  /* ===== 表单更新写回 ===== */
  function bindFieldSync() {
    $("#aiBase").addEventListener("input", e => { currentVendor().base = e.target.value.trim(); markDirty(); });
    $("#aiKey").addEventListener("input", e => { currentVendor().key = e.target.value.trim(); markDirty(); });
    $("#aiVendorPrompt").addEventListener("input", e => { currentVendor().prompt = e.target.value; markDirty(); });

    $("#aiModel").addEventListener("input", e => { currentModel().model = e.target.value.trim(); markDirty(); });
    $("#modelPrompt").addEventListener("input", e => { currentModel().prompt = e.target.value; markDirty(); });
  }

  /* ===== 导出/导入（沿用旧实现） ===== */
  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || ("uu-assist-export-" + new Date().toISOString().replace(/[:.TZ-]/g, "").slice(0,14) + ".json");
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 100);
  }

  async function exportAll() {
    setStatus("导出中…");
    try {
      const r = await chrome.runtime.sendMessage({ type: "exportAllData" }).catch(e => ({ ok:false, error:String(e) }));
      if (!r?.ok || !r.blob) {
        const all = await chrome.storage.local.get(null);
        const payload = {
          version: 2,
          exportedAt: new Date().toISOString(),
          extensionId: chrome.runtime.id,
          data: all,
          note: "posts 缺失：sw.js 未实现 exportAllData 或调用失败"
        };
        downloadJson(payload);
        setStatus("已导出（仅配置，无 posts）");
        return;
      }
      const fname = "uu-assist-export-" + String(r.blob.exportedAt || "").slice(0,19).replace(/[:T]/g,"") + ".json";
      downloadJson(r.blob, fname);
      const postsCount = Array.isArray(r.blob?.data?.posts) ? r.blob.data.posts.length : 0;
      setStatus(`已导出，posts=${postsCount}`);
    } catch (e) { console.error(e); setStatus("导出失败"); }
  }

  async function importPayload(jsonObj) {
    const payload = (jsonObj && jsonObj.data) ? jsonObj : { version: 2, data: jsonObj };
    const r = await chrome.runtime.sendMessage({ type: "importAllData", payload }).catch(e => ({ ok:false, error:String(e) }));
    if (r?.ok) {
      const cnt = Number(r.importedPosts || 0);
      setStatus(`导入成功，posts=${cnt}`);
      await loadAll();
      try { chrome.runtime.sendMessage({ type: "settingsImported" }); } catch {}
      return;
    }
    if (!confirm("后端不支持 posts 导入。只导入配置，确定继续？")) { setStatus("已取消"); return; }
    const data = payload.data || {};
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
    await loadAll();
    setStatus("仅配置导入完成（无 posts）");
  }

  function importAllFromFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(String(reader.result || "{}"));
        await importPayload(obj);
      } catch (e) { console.error(e); setStatus("导入失败：JSON 解析错误"); }
    };
    reader.readAsText(file, "utf-8");
  }

  /* ===== 重置 ===== */
  async function resetAll() {
    aiCfg2 = makeDefaultCfg2();
    renderAll();
    markDirty();
    setStatus("已重置未保存");
  }

  /* ===== 绑定事件 ===== */
  document.addEventListener("DOMContentLoaded", () => {
    // 初始加载
    loadAll().then(() => setStatus(""));

    // 下拉切换
    $("#vendorSelect").addEventListener("change", e => onVendorChanged(e.target.value));
    $("#modelSelect").addEventListener("change", e => onModelChanged(e.target.value));

    // 供应商 CRUD
    $("#btnAddVendor").addEventListener("click", addVendor);
    $("#btnRenameVendor").addEventListener("click", renameVendor);
    $("#btnDelVendor").addEventListener("click", deleteVendor);

    // 模型 CRUD
    $("#btnAddModel").addEventListener("click", addModel);
    $("#btnRenameModel").addEventListener("click", renameModel);
    $("#btnDelModel").addEventListener("click", deleteModel);

    // 字段写回
    bindFieldSync();

    // 保存/重置
    $("#btnSave").addEventListener("click", () => void saveAll());
    $("#btnReset").addEventListener("click", () => void resetAll());

    // 导入/导出
    $("#btnExport").addEventListener("click", () => void exportAll());
    $("#btnImport").addEventListener("click", () => {
      $("#importFile").click();
    });
    $("#importFile").addEventListener("change", e => {
      const f = e.target.files?.[0];
      if (f) importAllFromFile(f);
      e.target.value = "";
    });

    // 页面卸载提醒（有未保存）
    window.addEventListener("beforeunload", (ev) => {
      if (!dirty) return;
      ev.preventDefault();
      ev.returnValue = "";
    });
  });
})();
