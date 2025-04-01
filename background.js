// background.js

console.log('[启动] 服务工作者已初始化'); // 服务工作者启动验证

// 初始化下载来源映射表
const downloadSourceMap = new Map();
console.debug('[追踪] 下载来源映射表已创建');

// 心跳检测机制
let keepAliveTimer = setInterval(() => {
  console.log('[心跳] 服务工作者保持活跃'); 
}, 1000 * 20); // 每20秒触发

// ================= 事件监听注册 =================
chrome.downloads.onCreated.addListener(onDownloadCreated);
console.log('[事件] 下载监听器已注册');

// ================= 核心逻辑 =================
async function onDownloadCreated(downloadItem) {
  try {
    console.groupCollapsed(`[事件] 捕获下载 #${downloadItem.id}`);
    console.table({
      id: downloadItem.id,
      url: downloadItem.url,
      filename: downloadItem.filename,
      tabId: downloadItem.tabId,
      mime: downloadItem.mime
    });

    // 来源追踪
    const sourceTabId = await traceDownloadSource(downloadItem);
    console.log('[追踪] 确定来源标签页:', sourceTabId);

    // 拦截决策
    if (!(await shouldIntercept(downloadItem))) {
      console.warn('[决策] 跳过非图片下载');
      return;
    }

    // 执行拦截
    await performInterception(downloadItem, sourceTabId);
    console.groupEnd();
  } catch (err) {
    console.error('[错误] 拦截流程异常:', err);
    console.groupEnd();
  }
}

// ================= 工具函数 =================
async function traceDownloadSource(downloadItem) {
  console.log('[追踪] 开始追踪下载来源...');
  
  // 直接关联的tabId
  if (downloadItem.tabId > 0) {
    console.log('[追踪] 使用下载项自带tabId:', downloadItem.tabId);
    return downloadItem.tabId;
  }

  // 查找映射表记录
  const validEntries = Array.from(downloadSourceMap.entries())
    .filter(([_, timestamp]) => Date.now() - timestamp < 5000);
  
  console.log('[追踪] 有效映射条目:', validEntries.length);
  
  const [nearestTabId] = validEntries
    .sort((a, b) => b[1] - a[1])[0] || [];
  
  return nearestTabId || -1;
}

async function shouldIntercept(downloadItem) {
  console.log('[决策] 检查下载类型...');
  const isImage = [
    /\.(jpe?g|png|gif|webp|bmp)$/i.test(downloadItem.filename),
    downloadItem.mime?.startsWith('image/')
  ].some(Boolean);

  console.log('[决策] 是否图片文件:', isImage);
  return isImage;
}

async function performInterception(downloadItem, tabId) {
  try {
    // 添加开始提示
    await showToastInTab(tabId, '开始下载图片...', 'info');
    
    await chrome.downloads.cancel(downloadItem.id);
    console.log('[拦截] 下载已取消');

    console.log('[网络] 开始获取图片数据...');
    const startTime = Date.now();
    const response = await fetch(downloadItem.url);
    
    // 添加下载进度提示
    await showToastInTab(tabId, '正在处理图片数据...', 'loading');

    const blob = await response.blob();
    
    // 更新提示状态
    await showToastInTab(tabId, '正在写入剪贴板...', 'loading');

    await executeClipboardAction(tabId, blob);
    
    // 成功提示
    await showToastInTab(tabId, '✅ 下载完成，已保存到剪贴板', 'success');
    
  } catch (err) {
    // 失败提示
    await showToastInTab(tabId, `❌ 下载失败: ${err.message}`, 'error');
    throw err;
  }
}

async function executeClipboardAction(tabId, blob) {
  const buffer = await blob.arrayBuffer();

  const scriptConfig = {
    func: (blobData) => {
      // 新增提示函数
      const showToast = (message, type = 'info') => {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
          <div class="spinner ${type === 'loading' ? 'visible' : ''}"></div>
          <span>${message}</span>
        `;
        
        // 样式定义
        const style = document.createElement('style');
        style.textContent = `
          .toast {
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            opacity: 0;
            transform: translateY(-20px);
            animation: slideIn 0.3s ease-out forwards;
          }
          @keyframes slideIn {
            to { opacity: 1; transform: translateY(0); }
          }
          .toast.success { background: #4CAF50; }
          .toast.error { background: #f44336; }
          .toast.info { background: #2196F3; }
          .toast.loading { background: #FF9800; }
          .spinner {
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s linear infinite;
            display: none;
          }
          .spinner.visible { display: block; }
          @keyframes spin { to { transform: rotate(360deg); } }
        `;
        
        document.body.append(style, toast);
        setTimeout(() => toast.remove(), type === 'error' ? 5000 : 3000);
      };

      try {
        // 执行复制前显示加载状态
        showToast('正在保存到剪贴板...', 'loading');
        
        const blob = new Blob([new Uint8Array(blobData.buffer)], { 
          type: blobData.type 
        });
        navigator.clipboard.write([new ClipboardItem({ 
          [blob.type]: blob 
        })]);
        
        // 成功提示由外层调用
      } catch (err) {
        showToast(`保存失败: ${err.message}`, 'error');
        throw err;
      }
    },
    args: [{
      type: blob.type,
      buffer: Array.from(new Uint8Array(buffer))
    }]
  };

  if (tabId > 0) {
    console.log('[剪贴板] 尝试通过来源标签页执行');
    await chrome.scripting.executeScript({
      target: { tabId },
      ...scriptConfig
    });
    return;
  }

  console.log('[剪贴板] 降级到活动标签页执行');
  const [activeTab] = await chrome.tabs.query({ 
    active: true, 
    currentWindow: true 
  });
  
  if (activeTab?.id) {
    await chrome.scripting.executeScript({
      target: { tabId: activeTab.id },
      ...scriptConfig
    });
  } else {
    console.warn('[剪贴板] 无可用标签页执行操作');
  }
}

// 新增的toast提示增强版
async function showToastInTab(tabId, message, type) {
  // 添加时间戳防止重复提示
  const toastId = `${Date.now()}-${type}`;

  // 改进标签页有效性验证
  if (!tabId || tabId === -1 || !(await isTabValid(tabId))) {
    return showBrowserNotification(message, type);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (msg, t, id) => {
        // 创建唯一ID的toast容器
        const toast = document.getElementById(id) || document.createElement('div');
        toast.id = id;
        toast.className = `toast ${t} ${id}`;

        toast.innerHTML = `
          <div class="toast-content">
            <div class="spinner ${t === 'loading' ? 'visible' : ''}"></div>
            <span>${msg}</span>
          </div>
        `;

        document.body.append(toast);
        setTimeout(() => toast.remove(), 5000);

        return () => toast.remove();
      },
      args: [message, type, toastId]
    });
  } catch (error) {
    console.warn('[提示] 降级到浏览器通知:', error);
    showBrowserNotification(message, type);
  }
}

// 新增浏览器通知备用方案
function showBrowserNotification(message, type) {
  const options = {
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: type === 'success' ? '操作成功' : '操作失败',
    message: message
  };

  chrome.notifications.create(options, (notificationId) => {
    // 自动清理通知
    setTimeout(() => {
      chrome.notifications.clear(notificationId);
    }, 5000);
  });
}

// 新增标签页有效性检查
async function isTabValid(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return tab && tab.discarded === false;
  } catch (error) {
    return false;
  }
}