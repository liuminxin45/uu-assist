// 读取Chrome存储中的AI配置
chrome.storage.local.get(['aiCfg2'], function(result) {
    console.log('AI配置:', result);
    
    if (result.aiCfg2) {
        console.log('AI配置详情:');
        console.log('  当前供应商ID:', result.aiCfg2.activeVendorId);
        console.log('  供应商列表:', Object.keys(result.aiCfg2.vendors));
        
        const activeVendor = result.aiCfg2.vendors[result.aiCfg2.activeVendorId];
        if (activeVendor) {
            console.log('  当前供应商名称:', activeVendor.name);
            console.log('  当前供应商API地址:', activeVendor.base);
            console.log('  当前供应商API密钥:', activeVendor.key ? '[已设置]' : '[未设置]');
            console.log('  当前模型ID:', activeVendor.activeModelId);
            
            const activeModel = activeVendor.models[activeVendor.activeModelId];
            if (activeModel) {
                console.log('  当前模型名称:', activeModel.name);
                console.log('  当前模型ID:', activeModel.model);
            }
        }
    } else {
        console.log('未找到AI配置');
    }
});