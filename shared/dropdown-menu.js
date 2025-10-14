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
          // 如果rail.js存在并且有switchToPanel函数，则使用它
          if (window.switchToPanel) {
            window.switchToPanel(targetPanel);
          } else {
            // 更新下拉菜单中选中项的状态
            dropdownItems.forEach(i => i.classList.remove('active'));
            this.classList.add('active');
            
            // 简单的页面跳转
            let panelUrl;
            switch(targetPanel) {
              case 'pha-panel':
                panelUrl = '../pha/panel.html';
                break;
              case 'rocket-panel':
                panelUrl = '../rocket/panel.html';
                break;
              case 'notes-panel':
                panelUrl = '../notes/panel.html';
                break;
              case 'settings-panel':
                panelUrl = '../settings/panel.html';
                break;
              case 'todo-panel':
                panelUrl = '../todo/panel.html';
                break;
              case 'gerrit-panel':
                panelUrl = '../gerrit/panel.html';
                break;
              default:
                panelUrl = '../pha/panel.html';
            }
            
            // 跳转到相应的面板
            window.location.href = panelUrl;
          }
        }
      });
    });
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', function() {
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