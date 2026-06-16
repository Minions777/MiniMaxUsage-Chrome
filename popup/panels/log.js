// MiniMax Token Monitor - Log panel
// Owns: loadLogData, clear-logs handler.

(function () {
  'use strict';

  const { dom, initDom } = window.PMM;
  const { formatTimeSeconds, escapeHtml } = window.PMM.util;

  const TYPE_CLASS = {
    error: 'log-type-error',
    success: 'log-type-success',
    warn: 'log-type-warn',
    info: 'log-type-info',
  };
  const TYPE_LABEL = {
    error: '错误',
    success: '成功',
    warn: '警告',
    info: '信息',
  };

  async function load() {
    initDom();
    const logs = await chrome.runtime.sendMessage({ type: 'GET_LOGS' });
    if (!logs || logs.length === 0) {
      dom.logList.innerHTML = '<div class="log-empty">暂无日志记录</div>';
      return;
    }
    const recent = logs.slice(0, 100);
    dom.logList.innerHTML = recent.map(log => {
      const timeStr = formatTimeSeconds(new Date(log.timestamp));
      const typeClass = TYPE_CLASS[log.type] || TYPE_CLASS.info;
      const typeLabel = TYPE_LABEL[log.type] || TYPE_LABEL.info;
      return `
        <div class="log-item">
          <div class="log-item-header">
            <span class="log-entry-time">${escapeHtml(timeStr)}</span>
            <span class="log-entry-type ${typeClass}">${typeLabel}</span>
          </div>
          <div class="log-entry-msg">${escapeHtml(log.message)}</div>
        </div>`;
    }).join('');
  }

  function bind() {
    initDom();
    document.getElementById('btnBackFromLog').addEventListener('click', () => {
      window.PMM.display.showMain();
    });
    document.getElementById('btnClearLog').addEventListener('click', async () => {
      if (confirm('确定清空所有日志？')) {
        await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
        load();
      }
    });
  }

  window.PMM.logPanel = { load, bind };
})();