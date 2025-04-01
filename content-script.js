chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "copyImageToClipboard") {
    copyImageToClipboard(message.imageUrl)
      .then(() => showSuccessNotification())
      .catch(err => showErrorNotification(err));
  }
});

async function copyImageToClipboard(imageUrl) {
  try {
    // 获取图片数据
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // 复制到剪贴板
    const clipboardItem = new ClipboardItem({ [blob.type]: blob });
    await navigator.clipboard.write([clipboardItem]);
  } catch (err) {
    throw new Error('Failed to copy image to clipboard');
  }
}

function showSuccessNotification() {
  const notification = document.createElement('div');
  notification.style = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px;
    background: #4CAF50;
    color: white;
    border-radius: 5px;
    z-index: 9999;
  `;
  notification.textContent = '✅ Image copied to clipboard!';
  document.body.appendChild(notification);
  
  setTimeout(() => {
    document.body.removeChild(notification);
  }, 3000);
}

function showErrorNotification(error) {
  const notification = document.createElement('div');
  notification.style = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px;
    background: #f44336;
    color: white;
    border-radius: 5px;
    z-index: 9999;
  `;
  notification.textContent = `❌ ${error.message}`;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    document.body.removeChild(notification);
  }, 3000);
}

// 监听页面上的下载链接点击
document.addEventListener('click', async (e) => {
  const link = e.target.closest('a[download]');
  if (link && isImageLink(link.href)) {
    e.preventDefault();
    try {
      const { url } = link;
      
      // 通过后台获取图片数据
      const response = await chrome.runtime.sendMessage({
        action: 'fetchImage',
        url
      });
      
      // 写入剪贴板
      const blob = new Blob([new Uint8Array(response.buffer)], { type: response.type });
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      
      showSuccessNotification();
    } catch (err) {
      showErrorNotification(err);
    }
  }
});

// 判断是否为图片链接
function isImageLink(url) {
  return /\.(jpe?g|png|gif|webp|bmp)(\?.*)?$/i.test(url);
}

// 监听所有下载链接的点击事件
document.addEventListener('click', (e) => {
  const downloadTrigger = e.target.closest('a[download], button[download]');
  if (downloadTrigger) {
    // 向后台报告下载事件
    chrome.runtime.sendMessage({ 
      type: 'DOWNLOAD_TRIGGERED',
      timestamp: Date.now()
    });
  }
}, true); // 使用捕获模式确保第一时间触发