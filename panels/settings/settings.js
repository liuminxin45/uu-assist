// settings.js  —— 读写 chrome.storage.local 的 aiCfg 与偏好
(function(){
  const $ = sel => document.querySelector(sel);

  const defaultAi = {
    base: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    key: "",
    prompt: "你是助手。请根据给定正文：1) 生成≤40字的小标题；2) 生成简洁概述。以严格JSON返回：{\"title\":\"...\", \"reply\":\"...\"}"
  };
  const defaultPrefs = { autoOpen:false, useAI:true };

  async function load(){
    const got = await chrome.storage.local.get({ aiCfg: defaultAi, prefs: defaultPrefs }).catch(()=>({}));
    const ai = Object.assign({}, defaultAi, got.aiCfg || {});
    const pf = Object.assign({}, defaultPrefs, got.prefs || {});
    $("#aiBase").value = ai.base;
    $("#aiModel").value = ai.model;
    $("#aiKey").value = ai.key;
    $("#aiPrompt").value = ai.prompt;
    $("#prefAutoOpen").checked = !!pf.autoOpen;
    $("#prefUseAI").checked = !!pf.useAI;
  }

  async function save(){
    const ai = {
      base: $("#aiBase").value.trim() || defaultAi.base,
      model: $("#aiModel").value.trim() || defaultAi.model,
      key: $("#aiKey").value.trim(),
      prompt: $("#aiPrompt").value
    };
    const prefs = {
      autoOpen: $("#prefAutoOpen").checked,
      useAI: $("#prefUseAI").checked
    };
    await chrome.storage.local.set({ aiCfg: ai, prefs });
  }

  async function reset(){
    $("#aiBase").value = defaultAi.base;
    $("#aiModel").value = defaultAi.model;
    $("#aiKey").value = "";
    $("#aiPrompt").value = defaultAi.prompt;
    $("#prefAutoOpen").checked = defaultPrefs.autoOpen;
    $("#prefUseAI").checked = defaultPrefs.useAI;
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    load();
    $("#btnSave")?.addEventListener("click", async ()=>{ await save(); });
    $("#btnReset")?.addEventListener("click", async ()=>{ await reset(); });
  });
})();
