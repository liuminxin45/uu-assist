/**
 * 主题处理模块
 * 负责检测系统主题设置并应用到扩展程序
 */
(function() {
  // 主题设置键名
  const THEME_STORAGE_KEY = 'theme_preference';
  const THEME_SYSTEM = 'system';
  const THEME_LIGHT = 'light';
  const THEME_DARK = 'dark';
  
  // 当前主题
  let currentTheme = null;
  
  /**
   * 获取系统的主题偏好设置
   * @returns {string} 'dark' 或 'light'
   */
  function getSystemTheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return THEME_DARK;
    }
    return THEME_LIGHT;
  }
  
  /**
   * 从存储中加载主题偏好设置
   * @returns {Promise<string>} 主题设置
   */
  async function loadThemeFromStorage() {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        const result = await chrome.storage.local.get([THEME_STORAGE_KEY]);
        return result[THEME_STORAGE_KEY] || THEME_SYSTEM;
      } catch (error) {
        console.error('加载主题设置失败:', error);
        return THEME_SYSTEM;
      }
    } else {
      // 回退到 localStorage
      return localStorage.getItem(THEME_STORAGE_KEY) || THEME_SYSTEM;
    }
  }
  
  /**
   * 保存主题偏好设置到存储
   * @param {string} theme 主题设置
   * @returns {Promise<void>}
   */
  async function saveThemeToStorage(theme) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      try {
        await chrome.storage.local.set({ [THEME_STORAGE_KEY]: theme });
      } catch (error) {
        console.error('保存主题设置失败:', error);
      }
    } else {
      // 回退到 localStorage
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }
  
  /**
   * 应用主题到文档
   * @param {string} theme 主题名称
   */
  function applyTheme(theme) {
    // 移除所有主题相关的类
    document.documentElement.classList.remove('theme-light', 'theme-dark', 'theme-system');
    
    let effectiveTheme = theme;
    if (theme === THEME_SYSTEM) {
      effectiveTheme = getSystemTheme();
    }
    
    // 添加相应的主题类
    document.documentElement.classList.add(`theme-${theme}`);
    document.documentElement.classList.add(`theme-effective-${effectiveTheme}`);
    
    currentTheme = theme;
  }
  
  /**
   * 初始化主题系统
   * @returns {Promise<void>}
   */
  async function initTheme() {
    const savedTheme = await loadThemeFromStorage();
    applyTheme(savedTheme);
    
    // 添加系统主题变化监听
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      
      const handleThemeChange = (e) => {
        if (currentTheme === THEME_SYSTEM) {
          applyTheme(THEME_SYSTEM);
        }
      };
      
      mediaQuery.addEventListener('change', handleThemeChange);
      
      // 清理函数
      window.addEventListener('beforeunload', () => {
        mediaQuery.removeEventListener('change', handleThemeChange);
      });
    }
  }
  
  /**
   * 设置主题
   * @param {string} theme 主题名称: 'system', 'light', 'dark'
   * @returns {Promise<void>}
   */
  async function setTheme(theme) {
    if (![THEME_SYSTEM, THEME_LIGHT, THEME_DARK].includes(theme)) {
      throw new Error(`无效的主题值: ${theme}`);
    }
    
    await saveThemeToStorage(theme);
    applyTheme(theme);
  }
  
  /**
   * 获取当前主题设置
   * @returns {string} 当前主题
   */
  function getCurrentTheme() {
    return currentTheme;
  }
  
  /**
   * 获取当前有效的主题
   * @returns {string} 'dark' 或 'light'
   */
  function getEffectiveTheme() {
    if (currentTheme === THEME_SYSTEM) {
      return getSystemTheme();
    }
    return currentTheme;
  }
  
  // 导出公共API
  window.themeManager = {
    init: initTheme,
    setTheme: setTheme,
    getCurrentTheme: getCurrentTheme,
    getEffectiveTheme: getEffectiveTheme,
    THEME_SYSTEM: THEME_SYSTEM,
    THEME_LIGHT: THEME_LIGHT,
    THEME_DARK: THEME_DARK
  };
  
  // 自动初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTheme().catch(error => {
        console.error('主题初始化失败:', error);
      });
    });
  } else {
    initTheme().catch(error => {
      console.error('主题初始化失败:', error);
    });
  }
})();