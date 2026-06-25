// MiniMax Token Monitor - History panel
// Owns: loadHistoryData, renderWeeklyChart, renderHistoryList, expand/collapse.

(function () {
  'use strict';

  const { dom, initDom } = window.PMM;
  const { formatNumber, formatTime, formatDate, colorForPercentage, escapeHtml } = window.PMM.util;

  function groupByDay(history) {
    const grouped = {};
    history.forEach(record => {
      const dateKey = new Date(record.timestamp).toDateString();
      if (!grouped[dateKey]) {
        grouped[dateKey] = { date: new Date(record.timestamp), records: [] };
      }
      grouped[dateKey].records.push(record);
    });
    return Object.values(grouped).sort((a, b) => b.date - a.date);
  }

  function dailyDelta(day) {
    if (day.records.length < 2) return 0;
    return day.records[0].used - day.records[day.records.length - 1].used;
  }

  function renderEmpty() {
    dom.histAvg.textContent = '--%';
    dom.histMax.textContent = '--%';
    dom.histDays.textContent = '0';
    dom.weeklyChart.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">暂无数据</div>';
    dom.historyList.innerHTML = '';
  }

  function renderStats(days) {
    const avgPct = days.reduce((sum, day) => {
      const dayPct = day.records.reduce((s, r) => s + (r.total > 0 ? r.used / r.total : 0), 0) / day.records.length;
      return sum + dayPct;
    }, 0) / days.length;
    const maxPct = Math.max(...days.map(day =>
      Math.max(...day.records.map(r => r.total > 0 ? r.used / r.total : 0))
    ));
    dom.histAvg.textContent = Math.round(avgPct * 100) + '%';
    dom.histMax.textContent = Math.round(maxPct * 100) + '%';
    dom.histDays.textContent = days.length.toString();
  }

  function renderWeeklyChart(days) {
    if (days.length === 0) {
      dom.weeklyChart.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:20px;">数据不足</div>';
      return;
    }
    const maxUsed = Math.max(...days.map(d => dailyDelta(d)));
    dom.weeklyChart.innerHTML = days.map(day => {
      const used = dailyDelta(day);
      const height = maxUsed > 0 ? Math.max(4, (used / maxUsed) * 50) : 4;
      return `
        <div class="bar-col">
          <div class="bar-bar" style="height:${height}px"></div>
          <div class="bar-date">${escapeHtml(formatDate(day.date))}</div>
          <div class="bar-value">${escapeHtml(formatNumber(used))}</div>
        </div>`;
    }).join('');
  }

  function renderHistoryList(days) {
    const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dom.historyList.innerHTML = days.map((day, dayIndex) => {
      const used = dailyDelta(day);
      const weekday = weekdayNames[day.date.getDay()];
      const dateStr = formatDate(day.date);

      const details = day.records.map(record => {
        const pct = record.total > 0 ? record.used / record.total : 0;
        const colorInfo = colorForPercentage(pct);
        return `
          <div class="history-record">
            <span style="color:var(--text-muted)">${escapeHtml(formatTime(new Date(record.timestamp)))}</span>
            <span>已用 ${escapeHtml(formatNumber(record.used))}</span>
            <span>剩余 ${escapeHtml(formatNumber(record.remains))}</span>
            <span class="history-record-dot" style="background:${colorInfo.color}"></span>
          </div>`;
      }).join('');

      return `
        <div class="history-day" data-day-index="${dayIndex}">
          <div class="history-day-header">
            <div class="history-day-left">
              <span class="history-day-weekday">${escapeHtml(weekday)}</span>
              <span class="history-day-date">${escapeHtml(dateStr)}</span>
            </div>
            <div class="history-day-right">
              <span class="history-day-used">-${escapeHtml(formatNumber(used))}</span>
              <span class="history-day-records">${day.records.length}条</span>
              <span class="history-day-expand">▶</span>
            </div>
          </div>
          <div class="history-day-detail">${details}</div>
        </div>`;
    }).join('');
  }

  async function load() {
    initDom();
    const history = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
    if (!history || history.length === 0) {
      renderEmpty();
      return;
    }
    const days = groupByDay(history);
    renderStats(days);
    renderWeeklyChart(days.slice(0, 7).reverse());
    renderHistoryList(days.slice(0, 14));
  }

  function bind() {
    initDom();
    const btnBack = document.getElementById('btnBackFromHistory');
    if (btnBack) {
      btnBack.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.PMM.display && window.PMM.display.showMain) {
          window.PMM.display.showMain();
        }
      });
    }
    const btnClear = document.getElementById('btnClearHistory');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        if (confirm('确定清空所有历史记录？')) {
          await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
          load();
        }
      });
    }
    // Event delegation for day expand/collapse
    if (dom.historyList) {
      dom.historyList.addEventListener('click', (e) => {
        const header = e.target.closest('.history-day-header');
        if (!header) return;
        const detail = header.parentElement.querySelector('.history-day-detail');
        if (detail) detail.classList.toggle('show');
      });
    }
  }

  window.PMM.historyPanel = { load, bind };
})();