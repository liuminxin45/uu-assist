/* cs.js v0.7.3 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    try{
      if (!msg || !msg.cs) return;
      if (msg.cs === "rawUpload"){
        const bytes = new Uint8Array(msg.bytes||[]);
        const headers = new Headers(msg.headers||{});
        if (!headers.has("X-Requested-With")) headers.set("X-Requested-With", "XMLHttpRequest");
        const r = await fetch(msg.url, { method:"POST", credentials:"include", headers, body: bytes });
        const text = await r.text();
        sendResponse({ ok:r.ok, status:r.status, text });
        return;
      }
      if (msg.cs === "fetchText"){
        const r = await fetch(msg.url, { credentials:"include" });
        const t = await r.text();
        sendResponse({ ok:r.ok, status:r.status, text:t });
        return;
      }
    }catch(e){
      sendResponse({ ok:false, error:e.message });
    }
  })();
  return true;
});
