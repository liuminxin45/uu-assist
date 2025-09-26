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
})();
