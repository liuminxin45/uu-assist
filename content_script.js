// content_script.js 仅运行在页面上下文
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function collectAllElementsWithShadow(root=document){
  const out = []; const q = [root];
  while(q.length){
    const n = q.shift(); out.push(n);
    if (n.shadowRoot) q.push(n.shadowRoot);
    if (n.querySelectorAll){
      n.querySelectorAll("*").forEach(el=>{
        out.push(el);
        if (el.shadowRoot) q.push(el.shadowRoot);
      });
    }
  }
  return out;
}

async function waitForCommitMessage(timeoutMs=8000){
  const t0 = performance.now();
  while (performance.now() - t0 < timeoutMs){
    const nodes = collectAllElementsWithShadow();
    for (const el of nodes){
      if (!el || !el.tagName) continue;
      const tag = el.tagName.toLowerCase();
      if (tag === "gr-commit-message"){
        const s = el.textContent?.trim() || "";
        if (s) return s;
      }
      if (tag === "pre" || tag === "div"){
        const cls = (el.className||"")+"";
        if ((/commit/i.test(cls) || /message/i.test(cls))){
          const s = el.textContent?.trim() || "";
          if (s) return s;
        }
      }
    }
    await sleep(300);
  }
  return "";
}

// 展开全部“更早的改动”
async function expandAllOlderTransactions(maxRounds=20){
  for(let i=0;i<maxRounds;i++){
    const block = document.querySelector('div.phui-timeline-older-transactions-are-hidden[data-sigil="show-older-block"]');
    if(!block) return { ok:true, rounds:i };
    const a = block.querySelector('a[data-sigil="show-older-link"]');
    if(!a) return { ok:true, rounds:i };
    a.click();
    await sleep(600);
  }
  return { ok:false, error:"expand rounds exceeded" };
}

// 汇总 “工作耗时：xD”
function sumWorkloadDaysFromPage(){
  const text = document.body.innerText || "";
  const re = /工作耗时：\s*([\d.]+)\s*D/gi;
  let m, total = 0;
  while((m=re.exec(text))!==null){
    const v = parseFloat(m[1]);
    if (!isNaN(v)) total += v;
  }
  return Number(total.toFixed(3));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async ()=>{
    if (msg?.type === "ping"){ sendResponse({ ok:true }); return; }

    if (msg?.type === "gerritGrabCommit"){
      try{
        const message = await waitForCommitMessage();
        if (message) sendResponse({ ok:true, message });
        else sendResponse({ ok:false, error:"timeout waiting commit message" });
      }catch(e){
        sendResponse({ ok:false, error:e?.message||String(e) });
      }
      return;
    }

    if (msg?.type === "expandAndSumWorkload"){
      try{
        const ex = await expandAllOlderTransactions();
        if (!ex.ok){
          const still = document.querySelector('div.phui-timeline-older-transactions-are-hidden[data-sigil="show-older-block"]');
          if (still){ sendResponse({ ok:false, error: ex.error }); return; }
        }
        const days = sumWorkloadDaysFromPage();
        sendResponse({ ok:true, days });
      }catch(e){
        sendResponse({ ok:false, error: e?.message || String(e) });
      }
      return;
    }
  })();
  return true;
});

// 提取 commit message 中的任务号
function extractTaskIdFromText(t){
  const m = String(t||"").match(/T(\d{4,})/i);
  return m ? m[1] : "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async ()=>{
    // …你原有的 ping / gerritGrabCommit / expandAndSumWorkload 分支保持…
    if (msg?.type === "extractTaskId"){
      try{
        // 优先等 commit message
        const cm = await waitForCommitMessage(8000);
        let id = extractTaskIdFromText(cm);
        if (!id){
          // 兜底：整页文本
          id = extractTaskIdFromText(document.body?.innerText || "");
        }
        if (id) sendResponse({ ok:true, id });
        else    sendResponse({ ok:false, error:"not found" });
      }catch(e){
        sendResponse({ ok:false, error:e?.message||String(e) });
      }
      return;
    }
  })();
  return true;
});


/* =========================
 * Rocket.Chat Copilot 增强
 * - 灰色候选叠加到 <textarea name="msg">
 * - Tab 接受候选；Esc 清空候选
 * - 自动扫描最近消息，用 DeepSeek 生成候选
 * ========================= */

(function RocketCopilot(){
  const isRocket = /:\/\/chat\.rd\.tp\-link\.com\.cn\//i.test(location.href) || /:\/\/[^/]*tp\-link\.com\.cn\//i.test(location.href);
  if (!isRocket) return;

  function loadRocketCfg() {
  return new Promise(res => {
    try {
      // 检查扩展上下文是否有效
      if (chrome.runtime && chrome.runtime.id) {
        chrome.storage.local.get({ rocketMsgLimit: 5, rocketPrompt: '', rocketAutoListen: true }, (got) => {
          res({ 
            limit: Number(got.rocketMsgLimit || 5), 
            prompt: got.rocketPrompt || '',
            autoListen: got.rocketAutoListen !== false
          });
        });
      } else {
        // 上下文无效，返回默认配置
        res({ limit: 5, prompt: '', autoListen: true });
      }
    } catch (error) {
      // 捕获Extension context invalidated等错误
      console.warn('无法访问存储，扩展上下文可能已失效:', error);
      res({ limit: 5, prompt: '', autoListen: true });
    }
  });
}

  const $ = (s, root=document)=>root.querySelector(s);
  const $$ = (s, root=document)=>Array.from(root.querySelectorAll(s));
  const debounce = (fn, ms=200)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };
  const escHTML = (s)=>String(s||"").replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

  // —— 抓取最近消息
function extractMessagesInOrder(limit){
  const nodes = document.querySelectorAll('.rcx-message');
  const list=[]; let lastUser=null;
  nodes.forEach(n=>{
    const nameEl = n.querySelector('.rcx-message-header__name');
    if (nameEl){ const u = nameEl.textContent?.trim(); if (u) lastUser=u; }
    const bodyEl = n.querySelector('.rcx-message-body');
    const content = bodyEl?.innerText?.trim();
    if (lastUser && content) list.push({ user:lastUser, message:content });
  });
  return limit ? list.slice(-limit) : list;
}

async function genSuggestionWithDeepSeek(messages, promptOverride){
  const ai = await new Promise(res => {
    try {
      // 检查扩展上下文是否有效
      if (chrome.runtime && chrome.runtime.id) {
        chrome.storage.local.get({ aiCfg:null }, r => res(r.aiCfg || null));
      } else {
        // 上下文无效，直接返回null
        res(null);
      }
    } catch (error) {
      // 捕获Extension context invalidated等错误
      console.warn('无法访问存储，扩展上下文可能已失效:', error);
      res(null);
    }
  });
  if (!ai || !ai.base || !ai.model || !ai.key) return { text:'', tokens:0 };

  const rocketCfg = await loadRocketCfg();
  
  // 先确定基础Prompt（可以是自定义的或预置的）
  let basePrompt = 
    (promptOverride && promptOverride.trim()) ||
    (rocketCfg.prompt && rocketCfg.prompt.trim()) ||
    // 预置 Prompt：生成可直接回复的文案
    [
      "你是群聊助手，任务是根据最近的聊天内容，生成一条可直接作为回复发送的中文消息。",
      "请仔细阅读聊天记录，理解上下文，生成一条符合对话情境、自然流畅的回复。",
      "回复应当简洁明了，避免多余的解释和自我介绍，直接针对讨论内容给出回应。",
      "请只输出回复内容本身，不要包含任何前缀或后缀说明。"
    ].filter(line => line.trim()).join('\n'); // 过滤掉空行
  
  const finalPrompt = basePrompt;

  const convText = messages.map(m => `${m.user}: ${m.message}`).join('\n');
  const url = `${ai.base.replace(/\/+$/,'')}/chat/completions`;
  const body = {
    model: ai.model,
    messages: [
      { role: "system", content: finalPrompt },
      { role: "user",   content: `以下是最近的群聊消息（按时间先后）：\n${convText}\n\n请按照要求输出。` }
    ],
    temperature: 0.3,
    max_tokens: 240,
    stream: false
  };

  // 添加日志：显示当前使用的AI配置
  console.log("[Rocket AI Request] 使用的配置:", { 
    base: ai.base, 
    model: ai.model, 
    key: ai.key ? "[REDACTED]" : "未设置" 
  });

  try{
    // 将AI请求内容打印到status区域
    sendStatusLog(`发送AI请求：\n- 提示词：${finalPrompt}\n- 聊天内容：${convText}`);
    
    const resp = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${ai.key}` },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return { text:'', tokens:0 };
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const usage = data?.usage || {};
    
    // 添加日志：显示实际使用的模型
    const usedModel = data?.model || ai.model;
    console.log("[Rocket AI Response] 实际使用的模型:", usedModel);
    
    return { text, tokens: usage?.total_tokens || 0 };
  }catch(_){ return { text:'', tokens:0 }; }
}

// 发送日志到面板
function sendStatusLog(message) {
  try {
    // 打印完整消息到控制台，用于调试
    console.log('[ROCKET STATUS FULL]', message);
    
    // 直接发送完整消息，不做任何截断处理
    chrome.runtime.sendMessage({
      type: 'rocket:statusLog',
      message: message
    });
  } catch (e) {
    // 如果消息发送失败，回退到console
    console.log('[STATUS]', message);
  }
}

// 发送AI回复内容到Rocket面板
function sendAIReplyToPanel(content) {
  try {
    // 打印AI回复内容到控制台，用于调试
    console.log('[ROCKET AI REPLY]', content);
    
    // 向扩展发送AI回复内容
    chrome.runtime.sendMessage({
      type: 'rocket:aiReply',
      content: content
    });
  } catch (e) {
    // 如果消息发送失败，回退到console
    console.log('[ROCKET AI REPLY FAILED]', e);
  }
}

// 新增：面板主动触发生成和配置更新
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      // 配置更新消息
      if (msg?.type === 'rocket:updateConfig') {
        sendResponse({ ok: true });
        // 重新加载配置
        rocketCfg = await loadRocketCfg();
        return;
      }
      
      if (msg?.type !== 'rocket:generate') return;
    try{
      // 读取消息上限
      const limit = Math.max(1, Math.min(200, Number(msg.limit || (await loadRocketCfg()).limit || 20)));
      // 抓取最近消息
      const msgs = extractMessagesInOrder(limit);
      if (!msgs.length) { sendResponse({ ok:false, error:'未检测到聊天消息' }); return; }

      // 生成
      const { text, tokens } = await genSuggestionWithDeepSeek(msgs, msg.promptOverride || '');
      if (!text) { sendResponse({ ok:false, error:'AI 未返回内容' }); return; }

      // 将 AI 建议写入“灰色候选”
      try{
        // 确保建议容器存在
        if (ensureSuggestionContainer()) {
          // 先清空旧的候选区文案
          window.rocketSuggestion.suggestion = '';
          // 然后设置新的建议
          window.rocketSuggestion.suggestion = text;
        } else {
        // 尝试直接设置suggestion值，看是否能显示
        suggestion = text;
        renderSuggestion();
      }
      // 发送AI回复内容到Rocket面板
      sendAIReplyToPanel(text);
      }catch(e){ }

      sendResponse({ ok:true, tokens });
    }catch(e){
      sendStatusLog('错误: 生成失败 - ' + (e?.message || String(e)));
      sendResponse({ ok:false, error: e?.message || String(e) });
    }
  })();
  return true;
});

  // —— 锁定输入框
  // 查找聊天输入框
  function findTextarea(){
    try {
      // 首先尝试查找Rocket.Chat特定的textarea
      const specificTa = $('textarea.rc-message-box__textarea[name="msg"]');
      if (specificTa) {
        return specificTa;
      }
      
      // 然后尝试查找通用的textarea
      const generalTa = $('textarea[name="msg"]');
      if (generalTa) {
        return generalTa;
      }
      
      // 如果都没找到，尝试使用document.querySelector
      const queryTa = document.querySelector('textarea[name="msg"]');
      if (queryTa) {
        return queryTa;
      }
      
      return null;
    } catch (e) {
      console.error('findTextarea: 查找过程中出错 - ' + e?.message);
      return null;
    }
  }

  // —— 使用Rocket自带的方式显示建议
  let ta=null, suggestion='', originalPlaceholder='';
  // 将suggestion暴露到全局，以便从消息处理器访问
  window.rocketSuggestion = { 
    get suggestion() { 
      return suggestion; 
    }, 
    set suggestion(val) { 
      suggestion = val; 
      if (ta) { 
        renderSuggestion(); 
      } 
    } 
  };
  window.renderRocketGhost = () => renderSuggestion();

  // 查找或准备建议容器（改为使用placeholder方式）
  function ensureSuggestionContainer() {
    // 重置ta变量
    ta = null;
    
    // 查找textarea
    const foundTa = findTextarea();
    if (!foundTa) {
      return false;
    }
    
    // 保存找到的textarea
    ta = foundTa;
    
    // 保存原始placeholder以便恢复
    if (!originalPlaceholder) {
      originalPlaceholder = ta.placeholder || '';
    }
    
    // 移除之前可能存在的ghost元素
    const existingGhost = ta.nextElementSibling;
    if (existingGhost && existingGhost.classList.contains('suggestion-ghost')) {
      existingGhost.remove();
    }
    
    // 恢复textarea的默认样式
    if (ta.parentElement && ta.parentElement.classList.contains('suggestion-wrapper')) {
      Object.assign(ta.style, {
        background: '',
        position: '',
        zIndex: ''
      });
    }
    
    return true;
  }
  
  // 渲染建议（使用placeholder方式）
  function renderSuggestion() {
    if (!ta) {
      return;
    }
    
    // 如果textarea为空且有建议，设置建议为placeholder
    if (ta.value.trim() === '' && suggestion) {
      ta.placeholder = suggestion;
      // 自动调整textarea高度以适应多行placeholder
      adjustTextareaHeight();
    } else {
      // 否则恢复原始placeholder
      ta.placeholder = originalPlaceholder;
      // 恢复默认高度
      resetTextareaHeight();
    }
  }
  
  // 自动调整textarea高度以适应placeholder内容
  function adjustTextareaHeight() {
    if (!ta || !suggestion) return;
    
    // 保存当前样式
    const currentHeight = ta.style.height;
    const currentOverflow = ta.style.overflow;
    const currentResize = ta.style.resize;
    
    // 设置临时样式以测量内容高度
    ta.style.overflow = 'hidden';
    ta.style.resize = 'none';
    
    // 创建一个隐藏的div来测量文本高度
    const tempDiv = document.createElement('div');
    tempDiv.style.visibility = 'hidden';
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = ta.clientWidth + 'px';
    tempDiv.style.fontFamily = window.getComputedStyle(ta).fontFamily;
    tempDiv.style.fontSize = window.getComputedStyle(ta).fontSize;
    tempDiv.style.lineHeight = window.getComputedStyle(ta).lineHeight;
    tempDiv.style.whiteSpace = 'pre-wrap';
    tempDiv.style.wordWrap = 'break-word';
    tempDiv.textContent = suggestion;
    
    document.body.appendChild(tempDiv);
    
    // 设置textarea高度为测量的高度，但至少保留一行高度
    const measuredHeight = tempDiv.offsetHeight;
    const minHeight = parseInt(window.getComputedStyle(ta).lineHeight) || 20;
    ta.style.height = Math.max(measuredHeight, minHeight) + 'px';
    
    // 移除临时div
    document.body.removeChild(tempDiv);
  }
  
  // 重置textarea高度为默认值
  function resetTextareaHeight() {
    if (!ta) return;
    ta.style.height = '';
  }
  
  // 绑定Tab接受建议和Esc清除建议的快捷键
  function bindKeys() {
    if (!ta) return;
    
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && suggestion && ta.value.trim() === '') {
        e.preventDefault();
        ta.value = suggestion;
        // 创建一个临时div来测量设置值后的文本高度
        const tempDiv = document.createElement('div');
        tempDiv.style.visibility = 'hidden';
        tempDiv.style.position = 'absolute';
        tempDiv.style.left = '-9999px';
        tempDiv.style.top = '0';
        tempDiv.style.width = ta.clientWidth + 'px';
        tempDiv.style.fontFamily = window.getComputedStyle(ta).fontFamily;
        tempDiv.style.fontSize = window.getComputedStyle(ta).fontSize;
        tempDiv.style.lineHeight = window.getComputedStyle(ta).lineHeight;
        tempDiv.style.whiteSpace = 'pre-wrap';
        tempDiv.style.wordWrap = 'break-word';
        tempDiv.textContent = suggestion;
        
        document.body.appendChild(tempDiv);
        
        // 设置textarea高度为测量的高度，但至少保留一行高度
        const measuredHeight = tempDiv.offsetHeight;
        const minHeight = parseInt(window.getComputedStyle(ta).lineHeight) || 20;
        ta.style.height = Math.max(measuredHeight, minHeight) + 'px';
        
        // 移除临时div
        document.body.removeChild(tempDiv);
        
        // 清空建议但不调用renderSuggestion，避免重置高度
        suggestion = '';
        
        ta.focus();
      } else if (e.key === 'Escape' && suggestion) {
        suggestion = '';
        renderSuggestion();
      }
    });
    
    // 监听输入事件，当用户开始输入时清除建议
    ta.addEventListener('input', () => {
      if (suggestion && ta.value.trim() !== '') {
        suggestion = '';
        renderSuggestion();
      }
    });
    
    ta.addEventListener('focus', renderSuggestion);
    ta.addEventListener('blur', () => {
      // 失焦时保存当前建议状态
      setTimeout(() => {
        if (ta && ta.value.trim() === '' && suggestion) {
          renderSuggestion();
        }
      }, 100);
    });
  }
  
  // 添加必要的CSS样式
  function injectSuggestionCSS() {
    // 检查是否已经注入了CSS
    if (document.getElementById('rocket-suggestion-css')) return;
    
    const style = document.createElement('style');
    style.id = 'rocket-suggestion-css';
    style.textContent = `
      /* 确保textarea能够自动调整高度显示多行placeholder */
      .js-input-message[placeholder] {
        overflow-y: hidden !important;
        resize: none !important;
        transition: height 0.2s ease-in-out;
      }
      
      /* 增强placeholder的可读性 */
      .js-input-message::placeholder {
        color: #9ca3af;
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // —— DeepSeek
  function loadAiCfg(){
    return new Promise(res=>{
      try {
        // 检查扩展上下文是否有效
        if (chrome.runtime && chrome.runtime.id) {
          chrome.storage.local.get({ aiCfg:null }, got=>res(got.aiCfg||null));
        } else {
          // 上下文无效，直接返回null
          res(null);
        }
      } catch (error) {
        // 捕获Extension context invalidated等错误
        console.warn('无法访问存储，扩展上下文可能已失效:', error);
        res(null);
      }
    });
  }


  // 全局配置变量
  let rocketCfg = { limit: 5, prompt: '', autoListen: true, userName: '' };
  
  // 加载初始配置
  (async () => {
    rocketCfg = await loadRocketCfg();
  })();
  
  const trigger = (() => {
    // 用于比较消息签名的变量，避免重复触发 - 定义在闭包中
    let lastSig = '';
    
    return debounce(async ()=>{
    // 检查是否启用了自动监听
    if (!rocketCfg.autoListen) return;
    
    if (!ensureSuggestionContainer()) return;
    const msgs = extractMessagesInOrder(40);
    if (msgs.length===0) return;
    const sig = msgs.slice(-8).map(m=>m.user+'|'+m.message).join('\n');
    if (sig===lastSig) return;
    lastSig = sig;
    
    try {
      sendStatusLog('开始生成AI建议');
      const { text } = await genSuggestionWithDeepSeek(msgs, '');
      if (text){
        sendStatusLog('AI建议生成成功');
        const cur = (ta?.value||'').trim();
        if (!cur || cur.length<6){ suggestion = text; renderSuggestion(); }
        // 发送AI回复内容到Rocket面板
        sendAIReplyToPanel(text);
      } else {
        sendStatusLog('AI未返回内容');
      }
    } catch (e) {
      sendStatusLog('错误: AI建议生成失败 - ' + (e?.message || String(e)));
    }
    }, 400);
  })();

  (async function bootstrap(){    // 注入必要的CSS样式
    injectSuggestionCSS();
    
    // 尝试提取用户名并更新配置
    try {
      const currentCfg = await loadRocketCfg();
      
      // 已移除用户名提取和保存逻辑
    } catch (e) {
      console.warn('自动提取用户名并保存失败:', e);
    }
    
    // 等待并确保找到输入框
    for(let i=0;i<60;i++){ if (ensureSuggestionContainer()) break; await sleep(250); }
    if (!ensureSuggestionContainer()) return;
    
    bindKeys(); trigger();

    // 监听DOM变化，确保能够找到新的输入框和检测新消息
    // 改进的MutationObserver，添加节流控制
    let lastTriggerTime = 0;
    const TRIGGER_INTERVAL = 2000; // 2秒内最多触发一次
    let isTextareaFocused = false;
    
    const obs = new MutationObserver(()=>{      
      const cur = findTextarea();      
      if (cur && cur!==ta){        
        ta = cur;        
        ensureSuggestionContainer(); 
        bindKeys();
        // 如果有建议，重新渲染
        if (suggestion) {
          renderSuggestion();
        }
        // 自动监听模式下，即使没有焦点也触发一次
        if (rocketCfg.autoListen) {
          trigger();
        }
      } else if (rocketCfg.autoListen) {
        // 自动监听模式下，检测到新消息就触发AI请求，不依赖于textarea焦点状态
        // 添加时间间隔限制，避免过于频繁触发
        const now = Date.now();
        if (now - lastTriggerTime > TRIGGER_INTERVAL) {
          lastTriggerTime = now;
          trigger();
        }
      }
    });    
    
    obs.observe(document.documentElement,{ childList:true, subtree:true });    
    
    // 监听textarea焦点事件，确保点击输入框时自动触发AI请求
    ta?.addEventListener('focus', ()=>{
      isTextareaFocused = true;
      renderSuggestion();
      // 强制触发一次AI请求，不依赖于任何条件
      trigger();
    });
    
    ta?.addEventListener('blur', ()=>{
      isTextareaFocused = false;
      // 失焦时保存当前建议状态
      setTimeout(() => {
        if (ta && ta.value.trim() === '' && suggestion) {
          renderSuggestion();
        }
      }, 100);
    });  })();
})();