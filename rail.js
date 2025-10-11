// rail.js —— 侧栏导航
(function () {
  document.addEventListener("DOMContentLoaded", function () {
    // 切换面板
    const rail = document.querySelector(".rail");
    if (rail) {
      rail.addEventListener("click", (e) => {
        const btn = e.target.closest(".railbtn");
        if (!btn) return;
        chrome.runtime.sendMessage({ type: "switchPanel", name: btn.dataset.target });
      });
    }
  });
  
  // 定义全局的 switchToPanel 函数，供下拉菜单使用
  window.switchToPanel = function(panelName) {
    // 使用 Service Worker 的消息机制切换面板
    chrome.runtime.sendMessage({ type: "switchPanel", name: panelName });
  };
})();
