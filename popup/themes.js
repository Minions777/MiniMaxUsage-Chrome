// MiniMax Token Monitor - Theme Definitions & Application
// All theme logic is consolidated under PMM.theme namespace.
// No more scattered globals on window — clean module boundary.

(function () {
  'use strict';

  const PMM = window.PMM || (window.PMM = {});

  const THEMES = {
    neon: {
      id: 'neon',
      name: '🌿 Neon Green',
      description: '霓虹绿 · 默认主题',
      colors: {
        '--bg-deep': '#0a0a14',
        '--bg-primary': '#12121f',
        '--bg-secondary': '#1a1a2e',
        '--bg-card': 'rgba(255, 255, 255, 0.03)',
        '--accent': '#00d09c',
        '--accent-dim': 'rgba(0, 208, 156, 0.15)',
        '--accent-secondary': '#4facfe',
        '--accent-glow': 'rgba(0, 208, 156, 0.4)',
        '--accent-glow-strong': 'rgba(0, 208, 156, 0.6)',
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.65)',
        '--text-muted': 'rgba(255, 255, 255, 0.6)',
        '--border-subtle': 'rgba(255, 255, 255, 0.06)',
        '--glass-bg': 'rgba(255, 255, 255, 0.025)',
        '--shadow-glow': '0 8px 32px rgba(0, 208, 156, 0.2)',
        '--ring-gradient-start': '#00d09c',
        '--ring-gradient-end': '#00b894',
      },
      weeklyGradient: { start: '#4facfe', end: '#00f2fe' },
    },
    ocean: {
      id: 'ocean',
      name: '🌊 Ocean Blue',
      description: '海洋蓝 · 清新沉浸',
      colors: {
        '--bg-deep': '#04091a',
        '--bg-primary': '#0a1628',
        '--bg-secondary': '#0f2847',
        '--bg-card': 'rgba(255, 255, 255, 0.025)',
        '--accent': '#00b4ff',
        '--accent-dim': 'rgba(0, 180, 255, 0.12)',
        '--accent-secondary': '#7c3aed',
        '--accent-glow': 'rgba(0, 180, 255, 0.4)',
        '--accent-glow-strong': 'rgba(0, 180, 255, 0.6)',
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.6)',
        '--text-muted': 'rgba(255, 255, 255, 0.6)',
        '--border-subtle': 'rgba(255, 255, 255, 0.05)',
        '--glass-bg': 'rgba(0, 180, 255, 0.03)',
        '--shadow-glow': '0 8px 32px rgba(0, 180, 255, 0.2)',
        '--ring-gradient-start': '#00b4ff',
        '--ring-gradient-end': '#0066cc',
      },
      weeklyGradient: { start: '#a855f7', end: '#7c3aed' },
    },
    sunset: {
      id: 'sunset',
      name: '🌅 Sunset Orange',
      description: '日落橙 · 温暖活力',
      colors: {
        '--bg-deep': '#1a0a00',
        '--bg-primary': '#281200',
        '--bg-secondary': '#3d1e00',
        '--bg-card': 'rgba(255, 255, 255, 0.02)',
        '--accent': '#ff8c42',
        '--accent-dim': 'rgba(255, 140, 66, 0.12)',
        '--accent-secondary': '#ff5252',
        '--accent-glow': 'rgba(255, 140, 66, 0.4)',
        '--accent-glow-strong': 'rgba(255, 140, 66, 0.6)',
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.6)',
        '--text-muted': 'rgba(255, 255, 255, 0.6)',
        '--border-subtle': 'rgba(255, 255, 255, 0.05)',
        '--glass-bg': 'rgba(255, 140, 66, 0.03)',
        '--shadow-glow': '0 8px 32px rgba(255, 140, 66, 0.2)',
        '--ring-gradient-start': '#ff8c42',
        '--ring-gradient-end': '#ff5252',
      },
      weeklyGradient: { start: '#ff6b6b', end: '#ff8c42' },
    },
    purple: {
      id: 'purple',
      name: '💜 Purple Haze',
      description: '紫色迷幻 · 神秘优雅',
      colors: {
        '--bg-deep': '#0d0815',
        '--bg-primary': '#1a0f2e',
        '--bg-secondary': '#2a1a47',
        '--bg-card': 'rgba(255, 255, 255, 0.02)',
        '--accent': '#a855f7',
        '--accent-dim': 'rgba(168, 85, 247, 0.12)',
        '--accent-secondary': '#ec4899',
        '--accent-glow': 'rgba(168, 85, 247, 0.4)',
        '--accent-glow-strong': 'rgba(168, 85, 247, 0.6)',
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.6)',
        '--text-muted': 'rgba(255, 255, 255, 0.6)',
        '--border-subtle': 'rgba(255, 255, 255, 0.05)',
        '--glass-bg': 'rgba(168, 85, 247, 0.03)',
        '--shadow-glow': '0 8px 32px rgba(168, 85, 247, 0.2)',
        '--ring-gradient-start': '#a855f7',
        '--ring-gradient-end': '#7c3aed',
      },
      weeklyGradient: { start: '#ec4899', end: '#a855f7' },
    },
    mono: {
      id: 'mono',
      name: '🖥️ Mono Minimal',
      description: '简约黑白 · 极简纯粹',
      colors: {
        '--bg-deep': '#0a0a0a',
        '--bg-primary': '#141414',
        '--bg-secondary': '#1e1e1e',
        '--bg-card': 'rgba(255, 255, 255, 0.02)',
        '--accent': '#e0e0e0',
        '--accent-dim': 'rgba(224, 224, 224, 0.08)',
        '--accent-secondary': '#888888',
        '--accent-glow': 'rgba(224, 224, 224, 0.3)',
        '--accent-glow-strong': 'rgba(224, 224, 224, 0.5)',
        '--text-primary': '#ffffff',
        '--text-secondary': 'rgba(255, 255, 255, 0.55)',
        '--text-muted': 'rgba(255, 255, 255, 0.6)',
        '--border-subtle': 'rgba(255, 255, 255, 0.07)',
        '--glass-bg': 'rgba(255, 255, 255, 0.02)',
        '--shadow-glow': '0 8px 32px rgba(224, 224, 224, 0.08)',
        '--ring-gradient-start': '#e0e0e0',
        '--ring-gradient-end': '#888888',
      },
      weeklyGradient: { start: '#888888', end: '#666666' },
    },
  };
  const DEFAULT_RING_GRADIENT = { start: '#00d09c', end: '#00b894' };
  const DEFAULT_WEEKLY_GRADIENT = { start: '#4facfe', end: '#00f2fe' };

  function applyTheme(themeId) {
    const theme = THEMES[themeId] || THEMES.neon;
    const root = document.documentElement;

    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    updateSVGGradients(theme);
    document.body.dataset.theme = themeId;
  }

  function updateSVGGradients(theme) {
    const allDefs = document.querySelectorAll('.theme-gradients');
    if (allDefs.length === 0) return;

    const ringStart = theme.colors['--ring-gradient-start'] || DEFAULT_RING_GRADIENT.start;
    const ringEnd = theme.colors['--ring-gradient-end'] || DEFAULT_RING_GRADIENT.end;
    const weekly = theme.weeklyGradient || DEFAULT_WEEKLY_GRADIENT;

    const svgContent = `
      <linearGradient id="greenGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${ringStart}"/>
        <stop offset="100%" stop-color="${ringEnd}"/>
      </linearGradient>
      <linearGradient id="weeklyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${weekly.start}"/>
        <stop offset="100%" stop-color="${weekly.end}"/>
      </linearGradient>
      <linearGradient id="orangeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#f5a623"/>
        <stop offset="100%" stop-color="#e17055"/>
      </linearGradient>
      <linearGradient id="redGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#ff6b6b"/>
        <stop offset="100%" stop-color="#d63031"/>
      </linearGradient>
    `;

    allDefs.forEach(defs => { defs.innerHTML = svgContent; });
  }

  function updateThemeUI(themeId) {
    document.querySelectorAll('.theme-option').forEach(opt => {
      const selected = opt.dataset.theme === themeId;
      opt.classList.toggle('selected', selected);
      opt.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  async function getTheme() {
    const result = await chrome.storage.sync.get('minimax_theme');
    return result['minimax_theme'] || 'neon';
  }

  async function saveTheme(themeId) {
    await chrome.storage.sync.set({ 'minimax_theme': themeId });
  }

  // ─── Expose under PMM.theme namespace ─────────────────────────────────
  PMM.theme = {
    THEMES,
    DEFAULT_RING_GRADIENT,
    DEFAULT_WEEKLY_GRADIENT,
    applyTheme,
    updateSVGGradients,
    updateThemeUI,
    getTheme,
    saveTheme,
  };
})();