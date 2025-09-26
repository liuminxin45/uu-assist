// shared/persist.js
function debounce(fn, wait=300){ 
  let t; 
  return Object.assign(
    (...a)=>{ 
      clearTimeout(t); 
      t=setTimeout(()=>fn(...a), wait); 
    },
    { 
      flush:()=>{ 
        clearTimeout(t); 
        // 安全调用fn函数
        if (typeof fn === 'function') { 
          fn(); 
        } 
      } 
    }
  );
}

function getVal(el){
  if (el.dataset?.persistAttr) return el.getAttribute(el.dataset.persistAttr) ?? "";
  if (el.dataset?.persist === "text") return el.textContent ?? "";
  if (el.dataset?.persist === "html") return el.innerHTML ?? "";
  if (el.isContentEditable) return el.innerHTML;
  if (el.type === "checkbox") return el.checked ? "1" : "";
  if (el.type === "radio")    return el.checked ? el.value : "";
  return el.value ?? "";
}
function setVal(el, v){
  if (el.dataset?.persistAttr){ el.setAttribute(el.dataset.persistAttr, v ?? ""); return; }
  if (el.dataset?.persist === "text"){ el.textContent = v ?? ""; return; }
  if (el.dataset?.persist === "html"){ el.innerHTML = v ?? ""; return; }
  if (el.isContentEditable){ el.innerHTML = v || ""; return; }
  if (el.type === "checkbox"){ el.checked = !!v; return; }
  if (el.type === "radio"){ el.checked = (el.value===v); return; }
  el.value = v ?? "";
}


export function persistField(el, key){
  if (!el || !key) return;
  
  let save;
  
  // 检查是否在Chrome扩展环境中
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get(key, obj => setVal(el, obj?.[key]));
    save = debounce(()=> chrome.storage.local.set({ [key]: getVal(el) }), 250);
  } else {
    // 如果不是Chrome扩展环境，尝试使用localStorage
    try {
      const savedValue = localStorage.getItem(key);
      if (savedValue) {
        try {
          setVal(el, JSON.parse(savedValue));
        } catch (e) {
          setVal(el, savedValue);
        }
      }
      save = debounce(() => {
        try {
          localStorage.setItem(key, JSON.stringify(getVal(el)));
        } catch (error) {
          console.warn('保存数据失败:', error);
        }
      }, 250);
    } catch (error) {
      console.warn('加载数据失败:', error);
      // 创建一个空的save函数作为回退
      save = debounce(() => {}, 250);
    }
  }
  
  if (save) {
    const evs = el.isContentEditable ? ["input","blur","keyup"] : ["input","change","blur","keyup"];
    evs.forEach(e=> el.addEventListener(e, save));
    document.addEventListener("visibilitychange", ()=>{ if (document.hidden && save.flush) save.flush(); });
  }
}

export function setAndPersist(el, key, value){
  setVal(el, value);
  
  // 检查是否在Chrome扩展环境中
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ [key]: getVal(el) });
  } else {
    // 如果不是Chrome扩展环境，尝试使用localStorage
    try {
      localStorage.setItem(key, JSON.stringify(getVal(el)));
    } catch (error) {
      console.warn('保存数据失败:', error);
    }
  }
}

function cssPath(el){
  const parts=[];
  while (el && el.nodeType===1 && el!==document.body){
    const tag = el.nodeName.toLowerCase();
    const sibs = [...el.parentNode.children].filter(n=>n.nodeName===el.nodeName);
    const idx = sibs.indexOf(el) + 1;
    parts.unshift(`${tag}:nth-of-type(${idx})`);
    el = el.parentNode;
  }
  return parts.join(">");
}

/** 默认持久化所有输入类元素；用 data-persist="off" 或父级 data-nopersist 排除 */
export async function autoPersistEverything(opts = {}) {
  const scope = document.body?.dataset?.scope ? document.body.dataset.scope + ":" : "";
  const selector = opts.selector ||
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [data-persist]';

  // 兼容 MV2/MV3 的 storage.get 以及非Chrome环境
  const storageGet = (key) => new Promise(res => {
    try {
      // 检查是否在Chrome扩展环境中
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(key, obj => res(obj || {}));
      } else {
        // 如果不是Chrome扩展环境，尝试使用localStorage
        const result = {};
        try {
          const savedValue = localStorage.getItem(key);
          if (savedValue !== null) {
            try {
              result[key] = JSON.parse(savedValue);
            } catch (e) {
              result[key] = savedValue;
            }
          }
        } catch (error) {
          console.warn('加载数据失败:', error);
        }
        res(result);
      }
    } catch {
      res({});
    }
  });

  const nodes = [...document.querySelectorAll(selector)]
    .filter(el => !el.closest("[data-nopersist]"))
    .filter(el => el.getAttribute("data-persist") !== "off")
    .filter(el => !(el.tagName === "INPUT" && /^(password|file)$/i.test(el.type)));

  const keyOf = (el) => {
    if (el.dataset.persist && el.dataset.persist !== "on") return scope + el.dataset.persist;
    if (el.type === "radio" && el.name) return scope + "radio:" + el.name;
    if (el.id) return scope + "#" + el.id;
    if (el.name) return scope + "name:" + el.name;
    return scope + "path:" + cssPath(el);
  };

  // 恢复并监听
  for (const el of nodes) {
    const key = keyOf(el);

    // 恢复
    const saved = (await storageGet(key))[key];
    setVal(el, saved);

    // 保存（去抖）
    const save = debounce(() => {
      // 单选：只在当前按钮被选中时写入，避免写入 null 覆盖
      if (el.type === "radio" && !el.checked) return;
      
      // 检查是否在Chrome扩展环境中
      if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ [key]: getVal(el) });
      } else {
        // 如果不是Chrome扩展环境，尝试使用localStorage
        try {
          localStorage.setItem(key, JSON.stringify(getVal(el)));
        } catch (error) {
          console.warn('保存数据失败:', error);
        }
      }
    }, 250);

    const evs = el.isContentEditable ? ["input", "keyup", "blur"] : ["input", "change", "blur", "keyup"];
    evs.forEach(e => el.addEventListener(e, save));

    // 失焦/页面隐藏/关闭时冲刷 - 安全调用flush
    document.addEventListener("visibilitychange", () => { if (document.hidden && save && typeof save.flush === 'function') save.flush(); });
    window.addEventListener("beforeunload", () => { if (save && typeof save.flush === 'function') save.flush(); });
  }
}
