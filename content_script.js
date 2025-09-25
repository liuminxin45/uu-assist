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
    chrome.storage.local.get({ rocketMsgLimit: 20, rocketPrompt: '' }, (got) => {
      res({ limit: Number(got.rocketMsgLimit || 20), prompt: got.rocketPrompt || '' });
    });
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
  const ai = await new Promise(res => chrome.storage.local.get({ aiCfg:null }, r => res(r.aiCfg || null)));
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

      // 将 AI 建议写入“灰色候选”，不回传正文到面板
      if (window.__UU_ROCKET__) {
        // 若你在前面的实现中有全局对象承载，可直接复用
      }
      // 直接覆盖为新的候选
      try{
        // 下面两行需与你现有变量名对齐（如果不同，请替换为你的变量）
        window.suggestion = text;                          // 你的候选变量名
        (typeof window.renderGhost === 'function') && window.renderGhost();
      }catch(_){ /* 忽略渲染异常 */ }

      sendResponse({ ok:true, tokens });
    }catch(e){
      sendResponse({ ok:false, error: e?.message || String(e) });
    }
  })();
  return true;
});

  // —— 锁定输入框
  function findTextarea(){
    return $('textarea.rc-message-box__textarea[name="msg"]') || $('textarea[name="msg"]');
  }

  // —— 覆盖层
  let ta=null, ghost=null, suggestion='', lastSig='';
  function ensureGhost(){
    ta = findTextarea();
    if (!ta) return false;
    const host = ta.parentElement || ta;
    if (getComputedStyle(host).position === 'static'){ host.style.position='relative'; }
    if (!ghost){
      ghost = document.createElement('div');
      ghost.className='uu-ghost-suggest';
      const cs = getComputedStyle(ta);
      Object.assign(ghost.style,{
        position:'absolute', left: ta.offsetLeft+'px', top: ta.offsetTop+'px', right:'0',
        pointerEvents:'none', color:'#9ca3af', whiteSpace:'pre-wrap', overflowWrap:'break-word',
        wordBreak:'normal', padding: cs.padding, lineHeight: cs.lineHeight,
        fontFamily: cs.fontFamily, fontSize: cs.fontSize, width: cs.width, minHeight: cs.height,
      });
      host.appendChild(ghost);
      ta.addEventListener('scroll', ()=>{ ghost.scrollTop = ta.scrollTop; }, { passive:true });
      const sync = ()=>{ const c=getComputedStyle(ta);
        ghost.style.left=ta.offsetLeft+'px'; ghost.style.top=ta.offsetTop+'px';
        ghost.style.width=c.width; ghost.style.minHeight=c.height;
        ghost.style.padding=c.padding; ghost.style.lineHeight=c.lineHeight;
        ghost.style.fontFamily=c.fontFamily; ghost.style.fontSize=c.fontSize;
      };
      window.addEventListener('resize', debounce(sync,100));
      new ResizeObserver(debounce(sync,60)).observe(ta);
    }
    return true;
  }
  function renderGhost(){
    if (!ta || !ghost) return;
    const base = escHTML(ta.value||'');
    const sug  = escHTML(suggestion||'');
    ghost.innerHTML = (base + (sug?`<span style="color:#9ca3af">${sug}</span>`:'' )).replace(/\n/g,'<br>');
  }
  function bindKeys(){
    if (!ta) return;
    ta.addEventListener('keydown', (e)=>{
      if (e.key === 'Tab' && suggestion){
        e.preventDefault();
        ta.value = (ta.value||'') + suggestion;
        suggestion=''; renderGhost();
      } else if (e.key === 'Escape' && suggestion){
        suggestion=''; renderGhost();
      }
    });
    ta.addEventListener('input', ()=>renderGhost());
    ta.addEventListener('focus', ()=>renderGhost());
  }

  // —— DeepSeek
  function loadAiCfg(){
    return new Promise(res=>{
      chrome.storage.local.get({ aiCfg:null }, got=>res(got.aiCfg||null));
    });
  }
  async function genSuggestion(messages){
    const ai = await loadAiCfg();
    if (!ai || !ai.base || !ai.model || !ai.key) return '';
    const system = (ai.prompt||'').trim() || '你是消息助手。基于最近的聊天上下文生成一句到三句以内、可直接发送的中文回复。避免寒暄和自我描述，直接切题。';
    const conv = messages.map(m=>`${m.user}: ${m.message}`).join('\n');
    const user = `对话内容如下：\n${conv}\n\n请给出对最新一条消息的简洁、可直接发送的中文回复。不要 Markdown 或表情。不超过120字。`;
    const url = `${ai.base.replace(/\/+$/,'')}/chat/completions`;
    try{
      const resp = await fetch(url,{
        method:'POST',
        headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${ai.key}` },
        body: JSON.stringify({ model: ai.model, messages:[{role:'system',content:system},{role:'user',content:user}], temperature:0.3, max_tokens:180 })
      });
      if (!resp.ok) return '';
      const data = await resp.json();
      return (data?.choices?.[0]?.message?.content||'').replace(/```[\s\S]*?```/g,'').trim();
    }catch(_){ return ''; }
  }

  const trigger = debounce(async ()=>{
    if (!ensureGhost()) return;
    const msgs = extractMessagesInOrder(40);
    if (msgs.length===0) return;
    const sig = msgs.slice(-8).map(m=>m.user+'|'+m.message).join('\n');
    if (sig===lastSig) return;
    lastSig = sig;
    const txt = await genSuggestion(msgs);
    if (txt){
      const cur = (ta?.value||'').trim();
      if (!cur || cur.length<6){ suggestion = txt; renderGhost(); }
    }
  }, 400);

  (async function bootstrap(){
    for(let i=0;i<60;i++){ if (ensureGhost()) break; await sleep(250); }
    if (!ensureGhost()) return;
    bindKeys(); renderGhost(); trigger();

    const obs = new MutationObserver(()=>{
      const cur = findTextarea();
      if (cur && cur!==ta){
        ta = cur; ghost?.remove(); ghost=null;
        ensureGhost(); bindKeys();
      }
      trigger();
    });
    obs.observe(document.documentElement,{ childList:true, subtree:true });
    ta?.addEventListener('focus', ()=>trigger());
  })();
})();