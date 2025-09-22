// settings.js —— 读写 chrome.storage.local 的 aiCfg 与偏好
//           —— 导出/导入（含 IndexedDB posts，经 sw.js 统一打包）
(function () {
  const $ = (sel) => document.querySelector(sel);

  /* ===== 默认值 ===== */
  const defaultAi = {
    base: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    key: "",
    prompt:
      '你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁概述。以严格JSON返回：{"title":"...", "reply":"..."}',
  };
  const defaultPrefs = { autoOpen: false, useAI: true };

  /* ===== 状态输出 ===== */
  function setStatus(t) {
    const el = $("#importExportStatus");
    if (el) el.textContent = t;
  }

  /* ===== 表单读写 ===== */
  async function load() {
    const got =
      (await chrome.storage.local
        .get({ aiCfg: defaultAi, prefs: defaultPrefs })
        .catch(() => ({}))) || {};
    const ai = Object.assign({}, defaultAi, got.aiCfg || {});
    const pf = Object.assign({}, defaultPrefs, got.prefs || {});
    if ($("#aiBase")) $("#aiBase").value = ai.base;
    if ($("#aiModel")) $("#aiModel").value = ai.model;
    if ($("#aiKey")) $("#aiKey").value = ai.key;
    if ($("#aiPrompt")) $("#aiPrompt").value = ai.prompt;
    if ($("#prefAutoOpen")) $("#prefAutoOpen").checked = !!pf.autoOpen;
    if ($("#prefUseAI")) $("#prefUseAI").checked = !!pf.useAI;
  }

  async function save() {
    const ai = {
      base: ($("#aiBase")?.value || "").trim() || defaultAi.base,
      model: ($("#aiModel")?.value || "").trim() || defaultAi.model,
      key: ($("#aiKey")?.value || "").trim(),
      prompt: $("#aiPrompt")?.value ?? defaultAi.prompt,
    };
    const prefs = {
      autoOpen: !!$("#prefAutoOpen")?.checked,
      useAI: !!$("#prefUseAI")?.checked,
    };
    await chrome.storage.local.set({ aiCfg: ai, prefs });
    setStatus("已保存");
  }

  async function reset() {
    if ($("#aiBase")) $("#aiBase").value = defaultAi.base;
    if ($("#aiModel")) $("#aiModel").value = defaultAi.model;
    if ($("#aiKey")) $("#aiKey").value = "";
    if ($("#aiPrompt")) $("#aiPrompt").value = defaultAi.prompt;
    if ($("#prefAutoOpen")) $("#prefAutoOpen").checked = defaultPrefs.autoOpen;
    if ($("#prefUseAI")) $("#prefUseAI").checked = defaultPrefs.useAI;
    setStatus("已重置未保存");
  }

  /* ===== 下载工具（无需 downloads 权限） ===== */
  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      filename ||
      "uu-assist-export-" +
        new Date().toISOString().replace(/[:.TZ-]/g, "").slice(0, 14) +
        ".json";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 100);
  }

  /* ===== 全量导出（含 IndexedDB posts，经 sw.js 聚合） ===== */
  async function exportAll() {
    setStatus("导出中…");
    try {
      const r = await chrome.runtime
        .sendMessage({ type: "exportAllData" })
        .catch((e) => ({ ok: false, error: String(e) }));
      if (!r?.ok || !r.blob) {
        // 回退：仅导出 storage.local（无 posts）
        const all = await chrome.storage.local.get(null);
        const payload = {
          version: 1,
          exportedAt: new Date().toISOString(),
          extensionId: chrome.runtime.id,
          data: all,
          note: "posts 缺失：sw.js 未实现 exportAllData 或调用失败",
        };
        downloadJson(payload);
        setStatus("已导出（仅配置，无 posts）");
        return;
      }
      const fname =
        "uu-assist-export-" +
        String(r.blob.exportedAt || "")
          .slice(0, 19)
          .replace(/[:T]/g, "") +
        ".json";
      downloadJson(r.blob, fname);
      const postsCount = Array.isArray(r.blob?.data?.posts)
        ? r.blob.data.posts.length
        : 0;
      setStatus(`已导出，posts=${postsCount}`);
    } catch (e) {
      console.error(e);
      setStatus("导出失败");
    }
  }

  /* ===== 全量导入（含 IndexedDB posts，经 sw.js 处理） ===== */
  async function importPayload(jsonObj) {
    // 兼容纯 data 对象或完整包
    const payload =
      jsonObj && jsonObj.data ? jsonObj : { version: 1, data: jsonObj };

    // 优先经 sw.js 导入（含 posts）
    const r = await chrome.runtime
      .sendMessage({ type: "importAllData", payload })
      .catch((e) => ({ ok: false, error: String(e) }));

    if (r?.ok) {
      const cnt = Number(r.importedPosts || 0);
      setStatus(`导入成功，posts=${cnt}`);
      await load();
      try {
        chrome.runtime.sendMessage({ type: "settingsImported" });
      } catch {}
      return;
    }

    // 回退：仅导入配置到 storage.local
    if (!confirm("后端不支持 posts 导入。只导入配置，确定继续？")) {
      setStatus("已取消");
      return;
    }
    const data = payload.data || {};
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
    await load();
    setStatus("仅配置导入完成（无 posts）");
  }

  function importAllFromFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const obj = JSON.parse(String(reader.result || "{}"));
        await importPayload(obj);
      } catch (e) {
        console.error(e);
        setStatus("导入失败：JSON 解析错误");
      }
    };
    reader.readAsText(file, "utf-8");
  }

  /* ===== 事件绑定 ===== */
  document.addEventListener("DOMContentLoaded", () => {
    load();
    $("#btnSave")?.addEventListener("click", () => void save());
    $("#btnReset")?.addEventListener("click", () => void reset());

    // 导出按钮兼容两种 id
    $("#btnExportAll")?.addEventListener("click", () => void exportAll());
    $("#btnExport")?.addEventListener("click", () => void exportAll());

    // 导入：按钮触发文件选择，或直接监听文件 input
    const fileInputs = [
      $("#fileImportAll"),
      $("#importFile"), // 兼容旧 id
    ].filter(Boolean);

    $("#btnImportAll")?.addEventListener("click", () => {
      (fileInputs[0] || $("#fileImportAll") || $("#importFile"))?.click();
    });
    $("#btnImport")?.addEventListener("click", () => {
      (fileInputs[0] || $("#fileImportAll") || $("#importFile"))?.click();
    });

    for (const inp of fileInputs) {
      inp.addEventListener("change", (e) => {
        const f = e.target.files?.[0];
        if (f) importAllFromFile(f);
        e.target.value = ""; // 允许重复选择同一文件
      });
    }
  });
})();
