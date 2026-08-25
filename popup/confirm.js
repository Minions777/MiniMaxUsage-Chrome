// MiniMax Token Monitor - Themed confirmation dialog
// Replaces the blocking native window.confirm() (which is unthemeable and can
// close an MV3 popup by stealing focus). PMM.confirm(title, message) returns
// a Promise<boolean>: true on confirm, false on cancel / Esc / backdrop click.

(function () {
  'use strict';

  const PMM = window.PMM || (window.PMM = {});

  let modal, titleEl, bodyEl, okBtn, cancelBtn;
  let resolveCurrent = null;
  let lastFocused = null;

  function init() {
    if (modal) return;
    modal = document.getElementById('confirmModal');
    titleEl = document.getElementById('confirmModalTitle');
    bodyEl = document.getElementById('confirmModalBody');
    okBtn = document.getElementById('btnConfirmOk');
    cancelBtn = document.getElementById('btnConfirmCancel');
    if (!modal || !okBtn || !cancelBtn) { modal = null; return; }

    okBtn.addEventListener('click', () => close(true));
    cancelBtn.addEventListener('click', () => close(false));
    // Clicking the backdrop (not the card) cancels.
    modal.addEventListener('mousedown', (e) => {
      if (e.target === modal) close(false);
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter' && document.activeElement !== cancelBtn) {
        e.preventDefault();
        close(true);
      } else if (e.key === 'Tab') {
        // Simple focus trap between cancel and ok.
        const f = [cancelBtn, okBtn];
        const i = f.indexOf(document.activeElement);
        if (i === -1) return;
        e.preventDefault();
        const next = (i + (e.shiftKey ? -1 : 1) + f.length) % f.length;
        f[next].focus();
      }
    });
  }

  function close(result) {
    if (!modal || resolveCurrent === null) return;
    modal.style.display = 'none';
    const r = resolveCurrent;
    resolveCurrent = null;
    if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    r(result);
  }

  /**
   * Show a themed confirmation dialog.
   * @param {string} title
   * @param {string} message
   * @returns {Promise<boolean>} true on confirm, false on cancel
   */
  function confirm(title, message) {
    init();
    // Graceful fallback if the modal markup is absent.
    if (!modal) return Promise.resolve(window.confirm(message || title));
    return new Promise((resolve) => {
      resolveCurrent = resolve;
      lastFocused = document.activeElement;
      titleEl.textContent = title || '确认操作';
      bodyEl.textContent = message || '确定？';
      modal.style.display = 'flex';
      // Safer default for destructive actions: focus Cancel.
      cancelBtn.focus();
    });
  }

  PMM.confirm = confirm;
})();
