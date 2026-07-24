/**
 * script.js
 * -----------------------------------------------------------------------
 * Shared logic for the HTML Documentation Viewer.
 * This file is included on EVERY page (index + all content pages), so it
 * is split into two responsibilities:
 *
 *   1. Things that run on every page:
 *        - load config.json and apply the theme
 *        - inject a floating "Back to Index" button if we're not on
 *          index.html and one doesn't already exist
 *
 *   2. Things that only run on index.html:
 *        - fetch the live page list from /api/files
 *        - render cards, wire up search + sort
 *        - poll periodically so added/removed/renamed files show up
 *          automatically, with zero manual editing
 * -----------------------------------------------------------------------
 */

(function () {
  'use strict';

  const CONFIG_URL = 'config.json';
  const API_URL = 'api/files';

  const isIndexPage =
    location.pathname.endsWith('/') ||
    location.pathname.toLowerCase().endsWith('/index.html') ||
    location.pathname.toLowerCase() === '/index.html';

  /** Load and parse config.json (settings live here, no database). */
  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('config.json not found');
      return await res.json();
    } catch (err) {
      console.warn('Could not load config.json, using defaults.', err);
      return {
        title: 'HTML Library',
        theme: 'light',
        hidden: [],
        favorites: [],
        sort: 'alphabetical',
        showLastModified: true,
        pollIntervalMs: 3000,
      };
    }
  }

  /** Apply the light/dark theme to the whole document. */
  function applyTheme(theme) {
    document.documentElement.setAttribute(
      'data-theme',
      theme === 'dark' ? 'dark' : 'light'
    );
  }

  /**
   * Requirement #5 / #17: every non-index page needs a floating
   * "Back to Index" button. If the page author already added one
   * (an element with id="back-to-index"), we leave it alone.
   * Otherwise we inject one dynamically.
   */
  function ensureBackButton() {
    if (isIndexPage) return;
    if (document.getElementById('back-to-index')) return;

    const btn = document.createElement('button');
    btn.id = 'back-to-index';
    btn.className = 'back-to-index-btn';
    btn.innerHTML = '&#8592; Back to Index';
    btn.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
    document.body.appendChild(btn);
  }

  // ---- Runs on every page --------------------------------------------
  document.addEventListener('DOMContentLoaded', async () => {
    const config = await loadConfig();
    applyTheme(config.theme);
    ensureBackButton();

    if (isIndexPage) {
      initIndexPage(config);
    }
  });

  // =========================================================================
  //  Everything below only runs on index.html
  // =========================================================================

  function initIndexPage(initialConfig) {
    let config = initialConfig;
    let pages = []; // last known list from the API: {file, title, mtime}
    let lastSnapshot = '';
    let usingServerApi = true;

    const grid = document.getElementById('card-grid');
    const emptyState = document.getElementById('empty-state');
    const serverWarning = document.getElementById('server-warning');
    const statusLine = document.getElementById('status-line');
    const searchBox = document.getElementById('search-box');
    const sortSelect = document.getElementById('sort-select');
    const themeToggle = document.getElementById('theme-toggle');
    const siteTitle = document.getElementById('site-title');

    siteTitle.textContent = config.title || 'HTML Library';
    document.title = config.title || 'HTML Library';
    sortSelect.value = config.sort || 'alphabetical';
    themeToggle.textContent =
      document.documentElement.getAttribute('data-theme') === 'dark' ? '☀️' : '🌙';

    // Manual light/dark toggle (session only - config.json stays the
    // source of truth for the next full reload, per requirement #6/#14).
    themeToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      themeToggle.textContent = next === 'dark' ? '☀️' : '🌙';
    });

    searchBox.addEventListener('input', renderGrid);
    sortSelect.addEventListener('change', renderGrid);

    /** Fetch the live file list from the tiny local server. */
    async function fetchPages() {
      try {
        const res = await fetch(API_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error('API responded with ' + res.status);
        const data = await res.json();
        usingServerApi = true;
        serverWarning.hidden = true;
        return data;
      } catch (err) {
        usingServerApi = false;
        serverWarning.hidden = false;
        return [];
      }
    }

    /** Filter out anything listed as hidden in config.json. */
    function applyHiddenFilter(list) {
      const hiddenSet = new Set((config.hidden || []).map((f) => f.toLowerCase()));
      return list.filter((p) => !hiddenSet.has(p.file.toLowerCase()));
    }

    /** Sort the page list according to the active sort mode. */
    function sortPages(list) {
      const mode = sortSelect.value;
      const favorites = new Set((config.favorites || []).map((f) => f.toLowerCase()));
      const copy = [...list];

      switch (mode) {
        case 'newest':
          copy.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
          break;
        case 'oldest':
          copy.sort((a, b) => new Date(a.mtime) - new Date(b.mtime));
          break;
        case 'favorites':
          copy.sort((a, b) => {
            const favA = favorites.has(a.file.toLowerCase()) ? 0 : 1;
            const favB = favorites.has(b.file.toLowerCase()) ? 0 : 1;
            if (favA !== favB) return favA - favB;
            return a.title.localeCompare(b.title);
          });
          break;
        case 'alphabetical':
        default:
          copy.sort((a, b) => a.title.localeCompare(b.title));
          break;
      }
      return copy;
    }

    /** Filter by the live search box (matches filename OR title). */
    function searchFilter(list) {
      const query = searchBox.value.trim().toLowerCase();
      if (!query) return list;
      return list.filter(
        (p) =>
          p.file.toLowerCase().includes(query) ||
          p.title.toLowerCase().includes(query)
      );
    }

    function formatDate(iso) {
      if (!iso) return 'Unknown';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return 'Unknown';
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }

    function buildCard(page) {
      const favorites = new Set((config.favorites || []).map((f) => f.toLowerCase()));
      const isFavorite = favorites.has(page.file.toLowerCase());

      const card = document.createElement('article');
      card.className = 'card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `Open ${page.title}`);

      const title = document.createElement('h3');
      title.className = 'card-title';
      title.innerHTML =
        (isFavorite ? '<span class="favorite-star">★</span>' : '') +
        escapeHtml(page.title);

      const filename = document.createElement('div');
      filename.className = 'card-filename';
      filename.textContent = page.file;

      card.appendChild(title);
      card.appendChild(filename);

      if (config.showLastModified) {
        const modified = document.createElement('div');
        modified.className = 'card-modified';
        modified.textContent = 'Last modified: ' + formatDate(page.mtime);
        card.appendChild(modified);
      }

      const openBtn = document.createElement('button');
      openBtn.className = 'card-open-btn';
      openBtn.textContent = 'Open';
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openPage(page.file);
      });
      card.appendChild(openBtn);

      card.addEventListener('click', () => openPage(page.file));
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openPage(page.file);
        }
      });

      return card;
    }

    function openPage(file) {
      window.location.href = file;
    }

    function escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    /** Re-render the card grid from the current `pages` state. */
    function renderGrid() {
      grid.innerHTML = '';

      let visible = applyHiddenFilter(pages);
      visible = searchFilter(visible);
      visible = sortPages(visible);

      if (visible.length === 0) {
        emptyState.hidden = false;
      } else {
        emptyState.hidden = true;
        visible.forEach((page) => grid.appendChild(buildCard(page)));
      }

      const total = applyHiddenFilter(pages).length;
      statusLine.textContent = usingServerApi
        ? `${visible.length} of ${total} page(s) shown` +
          (searchBox.value ? ` for "${searchBox.value}"` : '')
        : '';
    }

    /** Poll the server so add/remove/rename events are picked up live. */
    async function refresh(isFirstLoad) {
      const freshPages = await fetchPages();
      const snapshot = JSON.stringify(freshPages);

      if (snapshot !== lastSnapshot) {
        pages = freshPages;
        lastSnapshot = snapshot;
        renderGrid();
      } else if (isFirstLoad) {
        // Even with no change, make sure the initial render happens.
        pages = freshPages;
        renderGrid();
      }
    }

    // Initial load, then poll on the interval from config.json.
    refresh(true);
    const interval = Math.max(1000, Number(config.pollIntervalMs) || 3000);
    setInterval(() => refresh(false), interval);
  }
})();
