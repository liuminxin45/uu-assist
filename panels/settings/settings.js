// settings.js —— 多供应商/多模型；向后兼容旧 aiCfg；保留导入导出逻辑
(function () {
  const $ = (sel) => document.querySelector(sel);

  /* ===== 默认与迁移 ===== */
  const builtinPrompt =
    '你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁概述。以严格JSON返回：{"title":"...", "reply":"..."}';
  
  // 主题设置键名
  const THEME_STORAGE_KEY = 'theme_preference';
  const THEME_SYSTEM = 'system';
  const THEME_LIGHT = 'light';
  const THEME_DARK = 'dark';
  
  // 默认首选项 - 合并旧的默认首选项
  const defaultPrefs = { autoOpen: false, useAI: true };
  
  // 主题设置
  let currentTheme = THEME_SYSTEM;

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
  let aiCfg2 = null; // 工作内存
  let dirty = false;

  function uid(prefix) { return prefix + "_" + Math.random().toString(36).slice(2, 9); }

  function setStatus(t) { const el = $("#importExportStatus"); if (el) el.textContent = t || ""; }

  async function loadAll() {
    // 同时加载AI配置和主题设置
    const got = await chrome.storage.local.get({ 
      aiCfg2: null, 
      aiCfg: null, 
      prefs: defaultPrefs, 
      [THEME_STORAGE_KEY]: THEME_SYSTEM 
    }).catch(() => ({}));
    
    if (got.aiCfg2 && got.aiCfg2.vendors) {
      aiCfg2 = got.aiCfg2;
    } else if (got.aiCfg) {
      aiCfg2 = migrateFromFlat(got.aiCfg);
    } else {
      aiCfg2 = makeDefaultCfg2();
    }
    
    // 加载主题设置
    currentTheme = got[THEME_STORAGE_KEY] || THEME_SYSTEM;
    
    renderAll();
    renderThemeSelect();
  }

  async function saveAll() {
    if (!aiCfg2 || !aiCfg2.vendors || !aiCfg2.activeVendorId) return;
    // 同步旧 aiCfg 以兼容现有调用处
    const flat = flattenToLegacy(aiCfg2);
    // 同时保存AI配置和主题设置
    await chrome.storage.local.set({ 
      aiCfg2, 
      aiCfg: flat, 
      [THEME_STORAGE_KEY]: currentTheme 
    });
    dirty = false;
    setStatus("已保存");
    
    // 保存后重新应用主题，确保UI立即更新
    if (window.themeManager && window.themeManager.setTheme) {
      try {
        // 确保传入正确的主题值
        const themeToApply = currentTheme === THEME_LIGHT ? THEME_LIGHT : 
                            currentTheme === THEME_DARK ? THEME_DARK : THEME_SYSTEM;
        
        await window.themeManager.setTheme(themeToApply);
        
        // 强制重新渲染文档以确保样式更新
        document.documentElement.style.display = 'none';
        setTimeout(() => {
          document.documentElement.style.display = '';
        }, 0);
      } catch (error) {
        console.error('保存后应用主题失败:', error);
        
        // 如果主题管理器失败，手动应用主题类
        try {
          // 移除所有主题相关的类
          document.documentElement.classList.remove('theme-light', 'theme-dark', 'theme-system', 'theme-effective-light', 'theme-effective-dark');
          
          // 添加当前主题类
          document.documentElement.classList.add(`theme-${currentTheme}`);
          
          // 添加有效的主题类
          let effectiveTheme = currentTheme;
          if (currentTheme === THEME_SYSTEM) {
            effectiveTheme = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? THEME_DARK : THEME_LIGHT;
          }
          document.documentElement.classList.add(`theme-effective-${effectiveTheme}`);
        } catch (manualError) {
          console.error('手动应用主题也失败:', manualError);
        }
      }
    }
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
    renderThemeSelect();
  }
  
  /**
   * 更新主题选择下拉框的显示
   */
  function renderThemeSelect() {
    const themeSelect = document.getElementById('themeSelect');
    if (themeSelect) {
      themeSelect.value = currentTheme;
    }
  }
  
  /**
   * 处理主题变更
   * @param {string} theme 新的主题值
   */
  function onThemeChanged(theme) {
    currentTheme = theme;
    markDirty();
    
    // 如果页面中有themeManager，立即应用主题变更
    if (window.themeManager && window.themeManager.setTheme) {
      window.themeManager.setTheme(theme).catch(error => {
        console.error('应用主题失败:', error);
      });
    }
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
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const obj = JSON.parse(String(reader.result || "{}"));
          await importPayload(obj);
          resolve();
        } catch (e) { 
          console.error(e); 
          setStatus("导入失败：JSON 解析错误");
          reject(e);
        }
      };
      reader.onerror = (e) => {
        console.error('文件读取失败:', e);
        setStatus("导入失败：文件读取错误");
        reject(e);
      };
      reader.readAsText(file, "utf-8");
    });
  }

  /* ===== 重置 ===== */
  async function resetAll() {
    aiCfg2 = makeDefaultCfg2();
    renderAll();
    markDirty();
    setStatus("已重置未保存");
    return Promise.resolve(); // 确保返回Promise以便链式调用
  }

  /**
   * 格式化字节数为人类可读的格式
   * @param {number} bytes 字节数
   * @returns {string} 格式化后的字符串
   */
  function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  /**
   * 计算并显示 chrome.storage.local 占用
   * 注意：不统计 IndexedDB / Cache Storage / storage.sync
   */
  async function updateStorageUsage() {
    try {
      // 统计 local 存储
      const localAll = await chrome.storage.local.get(null);
      const localBytes = await chrome.storage.local.getBytesInUse(null);

      // 渲染
      const storageUsageEl = document.getElementById('storageUsage');
      if (storageUsageEl) {
        storageUsageEl.innerHTML = 
          `已用: ${formatBytes(localBytes)}，键数: ${Object.keys(localAll).length}<br>` + 
          `<small style="color:#666;">storage.local: 无固定字节上限，主要受磁盘与实现策略影响</small>`;
      }
    } catch (error) {
      console.error('计算存储空间使用情况失败:', error);
      const storageUsageEl = document.getElementById('storageUsage');
      if (storageUsageEl) {
        storageUsageEl.textContent = '无法计算存储空间使用情况';
      }
    }
  }
  
  /* ===== 绑定事件 ===== */
  document.addEventListener("DOMContentLoaded", () => {
    // 初始加载
    loadAll().then(() => {
      setStatus("");
      // 加载完成后更新存储空间使用情况
      updateStorageUsage();
    });

    // 下拉切换
    $("#vendorSelect").addEventListener("change", e => onVendorChanged(e.target.value));
    $("#modelSelect").addEventListener("change", e => onModelChanged(e.target.value));
    
    // 主题选择
    const themeSelect = $("#themeSelect");
    if (themeSelect) {
      themeSelect.addEventListener("change", e => onThemeChanged(e.target.value));
    }

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
    $("#btnSave").addEventListener("click", () => {
      saveAll().then(() => updateStorageUsage());
    });
    $("#btnReset").addEventListener("click", () => {
      resetAll().then(() => updateStorageUsage());
    });

    // 导入/导出
    $("#btnExport").addEventListener("click", () => void exportAll());
    $("#btnImport").addEventListener("click", () => {
      $("#importFile").click();
    });
    $("#importFile").addEventListener("change", e => {
      const f = e.target.files?.[0];
      if (f) importAllFromFile(f).then(() => updateStorageUsage());
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
