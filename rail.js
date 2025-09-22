// rail.js —— 侧栏导航 + 动态站点图标
(function () {
  const setBtnIcon = (btn, url) => {
    if (!btn || !url) return;
    btn.textContent = "";                   // 去掉表情
    btn.style.backgroundImage = `url("${url}")`;
    btn.style.backgroundRepeat = "no-repeat";
    btn.style.backgroundPosition = "center";
    btn.style.backgroundSize = "18px 18px"; // 与28px按钮协调
  };

  // 获取 PHA favicon（优先 tab.favIconUrl，兜底 /favicon.ico）
  async function getPhaFavicon() {
    try {
      const tabs = await chrome.tabs.query({ url: ["http://pha.tp-link.com.cn/*", "https://pha.tp-link.com.cn/*"] });
      const url = tabs[0]?.favIconUrl;
      if (url) return url;
    } catch (_) {}
    return "http://pha.tp-link.com.cn/favicon.ico";
  }

  document.addEventListener("DOMContentLoaded", async function () {
    // 切换面板
    const rail = document.querySelector(".rail");
    if (rail) {
      rail.addEventListener("click", (e) => {
        const btn = e.target.closest(".railbtn");
        if (!btn) return;
        chrome.runtime.sendMessage({ type: "switchPanel", name: btn.dataset.target });
      });
    }

    // 设置 PHA 图标
    const phaBtn = document.querySelector('.railbtn[data-target="pha-panel"]');
    if (phaBtn) {
      const ico = await getPhaFavicon().catch(() => null);
      if (ico) setBtnIcon(phaBtn, ico);
    }
  });
})();
