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
        chrome.storage.local.get({ rocketMsgLimit: 20, rocketPrompt: '' }, (got) => {
          res({ limit: Number(got.rocketMsgLimit || 20), prompt: got.rocketPrompt || '' });
        });
      } else {
        // 上下文无效，返回默认配置
        res({ limit: 20, prompt: '' });
      }
    } catch (error) {
      // 捕获Extension context invalidated等错误
      console.warn('无法访问存储，扩展上下文可能已失效:', error);
      res({ limit: 20, prompt: '' });
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
  const finalPrompt =
    (promptOverride && promptOverride.trim()) ||
    (rocketCfg.prompt && rocketCfg.prompt.trim()) ||
    // 预置 Prompt：要求 1) 主题 2) 意图 3) 回复建议（不回传到面板，仅用于生成候选）
    [
      "你是群聊助手。基于最近消息：",
      "1) 归纳当前讨论主题；",
      "2) 分析参与者的主要意图与诉求；",
      "3) 生成一条可直接发送的中文回复建议（≤120字，避免寒暄和自我描述）。",
      "输出以三段中文句子形式返回，无需 Markdown。"
    ].join('\n');

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

  try{
    const resp = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${ai.key}` },
      body: JSON.stringify(body)
    });
    if (!resp.ok) return { text:'', tokens:0 };
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    const usage = data?.usage || {};
    return { text, tokens: usage?.total_tokens || 0 };
  }catch(_){ return { text:'', tokens:0 }; }
}

// 发送日志到面板
function sendStatusLog(message) {
  try {
    chrome.runtime.sendMessage({
      type: 'rocket:statusLog',
      message: message
    });
  } catch (e) {
    // 如果消息发送失败，回退到console
    console.log('[STATUS]', message);
  }
}

// 新增：面板主动触发生成
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
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
        sendStatusLog('开始更新AI建议到候选区');
        // 确保建议容器存在
        if (ensureSuggestionContainer()) {
          // 先清空旧的候选区文案
          sendStatusLog('1. 清空旧的候选区文案');
          window.rocketSuggestion.suggestion = '';
          // 然后设置新的建议
          sendStatusLog('2. 设置新的建议内容');
          window.rocketSuggestion.suggestion = text;
          sendStatusLog('3. 建议更新完成');
        } else {
        sendStatusLog('警告: 未能找到或创建建议容器');
        // 尝试直接设置suggestion值，看是否能显示
        sendStatusLog('尝试直接设置suggestion变量...');
        suggestion = text;
        renderSuggestion();
      }
      }catch(e){ sendStatusLog('错误: 更新建议失败 - ' + e?.message); }

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
    sendStatusLog('findTextarea: 开始查找聊天输入框');
    try {
      // 首先尝试查找Rocket.Chat特定的textarea
      const specificTa = $('textarea.rc-message-box__textarea[name="msg"]');
      if (specificTa) {
        sendStatusLog('findTextarea: 找到Rocket.Chat特定的textarea');
        return specificTa;
      }
      
      // 然后尝试查找通用的textarea
      const generalTa = $('textarea[name="msg"]');
      if (generalTa) {
        sendStatusLog('findTextarea: 找到通用的textarea');
        return generalTa;
      }
      
      // 如果都没找到，尝试使用document.querySelector
      const queryTa = document.querySelector('textarea[name="msg"]');
      if (queryTa) {
        sendStatusLog('findTextarea: 找到querySelector的textarea');
        return queryTa;
      }
      
      sendStatusLog('findTextarea: 未找到任何textarea元素');
      return null;
    } catch (e) {
      sendStatusLog('findTextarea: 查找过程中出错 - ' + e?.message);
      return null;
    }
  }

  // —— 使用Rocket自带的方式显示建议
  let ta=null, suggestion='', originalPlaceholder='';
  // 将suggestion暴露到全局，以便从消息处理器访问
  window.rocketSuggestion = { 
    get suggestion() { 
      sendStatusLog('获取suggestion值');
      return suggestion; 
    }, 
    set suggestion(val) { 
      sendStatusLog('设置suggestion值');
      suggestion = val; 
      if (ta) { 
        sendStatusLog('textarea存在，调用renderSuggestion');
        renderSuggestion(); 
      } else { 
        sendStatusLog('textarea不存在，无法渲染建议');
      }
    } 
  };
  window.renderRocketGhost = () => renderSuggestion();

  // 查找或准备建议容器（改为使用placeholder方式）
  function ensureSuggestionContainer() {
    sendStatusLog('ensureSuggestionContainer: 开始执行');
    
    // 重置ta变量
    ta = null;
    
    // 查找textarea
    const foundTa = findTextarea();
    if (!foundTa) {
      sendStatusLog('ensureSuggestionContainer: 没有找到textarea，无法创建建议容器');
      return false;
    }
    
    // 保存找到的textarea
    ta = foundTa;
    sendStatusLog('ensureSuggestionContainer: 成功找到textarea，继续处理');
    
    // 保存原始placeholder以便恢复
    if (!originalPlaceholder) {
      originalPlaceholder = ta.placeholder || '';
      sendStatusLog('ensureSuggestionContainer: 保存原始placeholder');
    }
    
    // 移除之前可能存在的ghost元素
    const existingGhost = ta.nextElementSibling;
    if (existingGhost && existingGhost.classList.contains('suggestion-ghost')) {
      sendStatusLog('ensureSuggestionContainer: 移除旧的ghost元素');
      existingGhost.remove();
    }
    
    // 恢复textarea的默认样式
    if (ta.parentElement && ta.parentElement.classList.contains('suggestion-wrapper')) {
      sendStatusLog('ensureSuggestionContainer: 移除不必要的wrapper样式');
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
    sendStatusLog('renderSuggestion调用开始');
    
    if (!ta) {
      sendStatusLog('错误: textarea元素不存在');
      return;
    }
    sendStatusLog('textarea元素存在');
    
    sendStatusLog('当前textarea值: ' + (ta.value ? '有内容' : '空'));
    sendStatusLog('当前suggestion值: ' + (suggestion ? '有内容' : '空'));
    
    // 如果textarea为空且有建议，设置建议为placeholder
    if (ta.value.trim() === '' && suggestion) {
      sendStatusLog('条件满足，设置建议文本到placeholder');
      ta.placeholder = suggestion;
      // 自动调整textarea高度以适应多行placeholder
      adjustTextareaHeight();
    } else {
      // 否则恢复原始placeholder
      sendStatusLog('条件不满足，恢复原始placeholder');
      ta.placeholder = originalPlaceholder;
      // 恢复默认高度
      resetTextareaHeight();
    }
    
    sendStatusLog('renderSuggestion调用结束');
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
    
    sendStatusLog('自动调整textarea高度: ' + ta.style.height);
  }
  
  // 重置textarea高度为默认值
  function resetTextareaHeight() {
    if (!ta) return;
    ta.style.height = '';
    sendStatusLog('重置textarea高度为默认值');
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
        
        sendStatusLog('应用建议并保持textarea高度: ' + ta.style.height);
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


  const trigger = (() => {
    // 用于比较消息签名的变量，避免重复触发 - 定义在闭包中
    let lastSig = '';
    
    return debounce(async ()=>{
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
      } else {
        sendStatusLog('AI未返回内容');
      }
    } catch (e) {
      sendStatusLog('错误: AI建议生成失败 - ' + (e?.message || String(e)));
    }
    }, 400);
  })();

  (async function bootstrap(){
    // 注入必要的CSS样式
    injectSuggestionCSS();
    
    // 等待并确保找到输入框
    for(let i=0;i<60;i++){ if (ensureSuggestionContainer()) break; await sleep(250); }
    if (!ensureSuggestionContainer()) return;
    
    bindKeys(); trigger();

    // 监听DOM变化，确保能够找到新的输入框
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
      }
      trigger();    });    
    
    obs.observe(document.documentElement,{ childList:true, subtree:true });    
    ta?.addEventListener('focus', ()=>{
      renderSuggestion();
      trigger();
    });  })();
})();