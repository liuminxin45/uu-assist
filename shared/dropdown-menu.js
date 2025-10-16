// 下拉菜单交互逻辑 - 公共组件
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    const panelSwitchBtn = document.getElementById('panelSwitchBtn');
    const panelDropdown = document.getElementById('panelDropdown');
    const dropdownItems = document.querySelectorAll('.dropdown-item');
    
    // 检查必要元素是否存在
    if (!panelSwitchBtn || !panelDropdown) {
      return; // 如果元素不存在，不执行后续逻辑
    }
    
    // 切换下拉菜单显示状态
    panelSwitchBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      panelDropdown.parentElement.classList.toggle('active');
    });
    
    // 点击下拉菜单项时切换面板
    dropdownItems.forEach(item => {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        
        // 关闭下拉菜单
        panelDropdown.parentElement.classList.remove('active');
        
        // 获取目标面板
        const targetPanel = this.getAttribute('data-target');
        
        // 只有当data-target属性存在时才进行面板切换
        if (targetPanel) {
          // 强制使用window.switchToPanel进行面板切换，这是最可靠的方式
          if (window.switchToPanel) {
            window.switchToPanel(targetPanel);
          } else {
            // 如果switchToPanel函数不可用，尝试直接使用chrome.runtime.sendMessage
            try {
              chrome.runtime.sendMessage({ type: "switchPanel", name: targetPanel });
            } catch (e) {
              console.error("无法切换面板:", e);
            }
          }
          
          // 更新下拉菜单中选中项的状态
          dropdownItems.forEach(i => i.classList.remove('active'));
          this.classList.add('active');
        }
      });
    });
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', function(e) {
      // 避免与panel.js中的事件监听器冲突
      // 如果事件来自panel.js中处理的下拉菜单，则不执行操作
      if (e.target.closest('.todo-filters')) {
        return;
      }
      
      if (panelDropdown.parentElement.classList.contains('active')) {
        panelDropdown.parentElement.classList.remove('active');
      }
    });
    
    // 防止下拉菜单内部的点击事件冒泡
    panelDropdown.addEventListener('click', function(e) {
      e.stopPropagation();
    });
  });
})();