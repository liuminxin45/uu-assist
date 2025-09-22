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
