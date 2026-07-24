(function () {
  'use strict';

  var CACHE_KEY = 'gh-pages-tree-cache';
  var CACHE_TTL_MS = 300000;
  var TITLE_FETCH_CONCURRENCY = 5;
  var THEME_KEY = 'gh-pages-theme';
  var TOKEN_KEY = 'gh-pages-token';
  var SEARCH_DEBOUNCE_MS = 200;
  var FETCH_TIMEOUT_MS = 15000;
  var RAW_TIMEOUT_MS = 10000;

  var isIndexPage =
    location.pathname.endsWith('/') ||
    location.pathname.toLowerCase().endsWith('/index.html') ||
    location.pathname.toLowerCase() === '/index.html';

  function detectRepo() {
    try {
      var searchParams = new URLSearchParams(window.location.search);
      var paramOwner = searchParams.get('owner');
      var paramRepo = searchParams.get('repo');
      if (paramOwner && paramRepo) {
        return { owner: paramOwner, repo: paramRepo };
      }
    } catch (e) {}

    var hostname = window.location.hostname;
    var pathname = window.location.pathname;
    var match = hostname.match(/^([^.]+)\.github\.io$/);
    if (!match) return null;
    var owner = match[1];
    var parts = pathname.replace(/^\/|\/$/g, '').split('/');
    var repo = parts[0] || owner + '.github.io';
    return { owner: owner, repo: repo };
  }

  function fetchWithTimeout(url, options, timeoutMs) {
    options = options || {};
    timeoutMs = timeoutMs || FETCH_TIMEOUT_MS;
    var controller = new AbortController();
    var id = setTimeout(function () { controller.abort(); }, timeoutMs);
    return fetch(url, Object.assign({}, options, { signal: controller.signal }))
      .finally(function () { clearTimeout(id); });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function stripHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }

  function fetchFileTree(owner, repo) {
    var url = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/git/trees/HEAD?recursive=1&_t=' + Date.now();
    var headers = { 'Accept': 'application/vnd.github.v3+json', 'Cache-Control': 'no-cache' };
    var token = getToken();
    if (token) headers['Authorization'] = 'token ' + token;
    return fetchWithTimeout(url, { headers: headers, cache: 'no-store' }).then(function (res) {
      if (res.status === 403) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (data.message && data.message.toLowerCase().includes('rate limit')) {
            throw new Error('RATE_LIMIT');
          }
          throw new Error('PRIVATE_OR_FORBIDDEN');
        });
      }
      if (res.status === 404) {
        throw new Error('NOT_FOUND');
      }
      if (!res.ok) {
        throw new Error('API_ERROR');
      }
      return res.json();
    }).then(function (data) {
      return data.tree || [];
    });
  }

  function filterHtmlFiles(tree) {
    return tree
      .filter(function (item) {
        return item.type === 'blob' && item.path.toLowerCase().endsWith('.html');
      })
      .filter(function (item) {
        var base = item.path.split('/').pop().toLowerCase();
        return base !== 'index.html' && base !== '404.html';
      });
  }

  function extractTitleFromHtml(html) {
    var match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match && match[1]) {
      var text = match[1].replace(/\s+/g, ' ').trim();
      if (text.length > 0) return text;
    }
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var h1 = doc.querySelector('h1');
    if (h1 && h1.textContent.trim().length > 0) {
      return h1.textContent.trim();
    }
    return null;
  }

  function fetchRawContent(owner, repo, path) {
    var encodedPath = path.split('/').map(encodeURIComponent).join('/');
    var url = 'https://raw.githubusercontent.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/HEAD/' + encodedPath;
    return fetchWithTimeout(url, {}, RAW_TIMEOUT_MS).then(function (res) {
      if (!res.ok) return null;
      return res.text();
    }).catch(function () {
      return null;
    });
  }

  function batchFetchWithConcurrency(tasks, limit) {
    var results = new Array(tasks.length);
    var index = 0;
    function worker() {
      function next() {
        if (index >= tasks.length) return Promise.resolve();
        var i = index++;
        return tasks[i]().then(function (result) {
          results[i] = result;
          return next();
        });
      }
      return next();
    }
    var workers = [];
    for (var i = 0; i < Math.min(limit, tasks.length); i++) {
      workers.push(worker());
    }
    return Promise.allSettled(workers).then(function () { return results; });
  }

  function getTheme() {
    return localStorage.getItem(THEME_KEY) || 'dark';
  }

  function setTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.setAttribute('data-theme', theme);
  }

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
  }

  function errorMessageFor(error) {
    switch (error.message) {
      case 'RATE_LIMIT':
        return 'GitHub API rate limit exceeded (60 requests/hour for unauthenticated requests). Click Refresh to use cached data, or wait a few minutes.';
      case 'PRIVATE_OR_FORBIDDEN':
        return 'This repository is private or access is forbidden. Make sure the repository is public.';
      case 'NOT_FOUND':
        return 'Repository not found. Check that the owner and repo name are correct.';
      case 'API_ERROR':
        return 'GitHub API returned an unexpected error. Please try again later.';
      default:
        if (error.name === 'AbortError') {
          return 'Request timed out. Please check your network connection and try again.';
        }
        return 'A network error occurred. Please check your connection and try again.';
    }
  }

  function createSvgIcon(pathD) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    svg.appendChild(path);
    return svg;
  }

  function createSearchIcon() {
    return createSvgIcon('M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z');
  }

  function createArrowUpIcon() {
    return createSvgIcon('M12 19V5M5 12l7-7 7 7');
  }

  function createRefreshIcon() {
    return createSvgIcon('M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15');
  }

  function renderApp(root, repoInfo) {
    root.innerHTML = '';

    var header = document.createElement('header');
    header.className = 'header';

    var titleEl = document.createElement('div');
    titleEl.className = 'header__title';
    var titleIcon = document.createElement('span');
    titleIcon.className = 'header__title-icon';
    titleIcon.textContent = '\uD83D\uDCC1';
    var titleLink = document.createElement('a');
    titleLink.href = 'https://github.com/' + repoInfo.owner + '/' + repoInfo.repo;
    titleLink.textContent = repoInfo.owner + '/' + repoInfo.repo;
    titleLink.target = '_blank';
    titleLink.rel = 'noopener noreferrer';
    titleEl.appendChild(titleIcon);
    titleEl.appendChild(titleLink);
    header.appendChild(titleEl);

    var controls = document.createElement('div');
    controls.className = 'header__controls';

    var searchWrapper = document.createElement('div');
    searchWrapper.className = 'search-wrapper';
    var searchIconEl = document.createElement('span');
    searchIconEl.className = 'search-wrapper__icon';
    searchIconEl.appendChild(createSearchIcon());
    var searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'search-input';
    searchInput.placeholder = 'Search by title or filename\u2026';
    searchInput.id = 'gh-search-input';
    searchWrapper.appendChild(searchIconEl);
    searchWrapper.appendChild(searchInput);
    controls.appendChild(searchWrapper);

    var sortSelect = document.createElement('select');
    sortSelect.className = 'sort-select';
    sortSelect.id = 'gh-sort-select';
    var sortOpts = [
      { value: 'alpha', label: 'A \u2192 Z' },
      { value: 'newest', label: 'Newest' },
      { value: 'oldest', label: 'Oldest' }
    ];
    sortOpts.forEach(function (o) {
      var option = document.createElement('option');
      option.value = o.value;
      option.textContent = o.label;
      sortSelect.appendChild(option);
    });
    controls.appendChild(sortSelect);

    var themeToggle = document.createElement('button');
    themeToggle.className = 'theme-toggle';
    themeToggle.id = 'gh-theme-toggle';
    themeToggle.title = 'Toggle theme';
    themeToggle.textContent = getTheme() === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    controls.appendChild(themeToggle);

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'theme-toggle';
    refreshBtn.id = 'gh-refresh-btn';
    refreshBtn.title = 'Refresh page list';
    refreshBtn.appendChild(createRefreshIcon());
    controls.appendChild(refreshBtn);

    header.appendChild(controls);
    root.appendChild(header);

    var statusBar = document.createElement('div');
    statusBar.className = 'status-bar';
    statusBar.id = 'gh-status-bar';
    statusBar.style.display = 'none';
    var statusCount = document.createElement('span');
    statusCount.className = 'status-bar__count';
    statusCount.id = 'gh-count';
    statusBar.appendChild(statusCount);
    var statusHint = document.createElement('span');
    statusHint.id = 'gh-cache-hint';
    statusHint.style.cssText = 'margin-left:12px;font-size:12px;opacity:0.7;';
    statusBar.appendChild(statusHint);
    root.appendChild(statusBar);

    var mainContent = document.createElement('div');
    mainContent.className = 'main-content';
    mainContent.id = 'gh-main';
    root.appendChild(mainContent);

    if (!isIndexPage) {
      var backBtn = document.createElement('a');
      backBtn.className = 'back-to-index';
      backBtn.href = '/';
      backBtn.title = 'Back to Index';
      var backIcon = document.createElement('span');
      backIcon.className = 'back-to-index__icon';
      backIcon.appendChild(createArrowUpIcon());
      backBtn.appendChild(backIcon);
      backBtn.appendChild(document.createTextNode(' Index'));
      root.appendChild(backBtn);
    }

    return {
      header: header,
      searchInput: searchInput,
      sortSelect: sortSelect,
      themeToggle: themeToggle,
      refreshBtn: refreshBtn,
      statusBar: statusBar,
      statusCount: statusCount,
      mainContent: mainContent
    };
  }

  function renderLoading(mainContent) {
    mainContent.innerHTML = '';
    var spinner = document.createElement('div');
    spinner.className = 'loading-spinner';
    var circle = document.createElement('div');
    circle.className = 'loading-spinner__circle';
    var text = document.createElement('div');
    text.className = 'loading-spinner__text';
    text.textContent = 'Discovering pages\u2026';
    spinner.appendChild(circle);
    spinner.appendChild(text);
    mainContent.appendChild(spinner);
  }

  function renderError(mainContent, message, retryFn, isRateLimit) {
    mainContent.innerHTML = '';
    var errorState = document.createElement('div');
    errorState.className = 'error-state';
    var icon = document.createElement('div');
    icon.className = 'error-state__icon';
    icon.textContent = '\u26A0\uFE0F';
    var title = document.createElement('h2');
    title.className = 'error-state__title';
    title.textContent = 'Something went wrong';
    var desc = document.createElement('p');
    desc.className = 'error-state__description';
    desc.textContent = message;
    errorState.appendChild(icon);
    errorState.appendChild(title);
    errorState.appendChild(desc);

    if (isRateLimit) {
      var tokenWrap = document.createElement('div');
      tokenWrap.style.cssText = 'margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;';
      var tokenInput = document.createElement('input');
      tokenInput.type = 'password';
      tokenInput.placeholder = 'GitHub token (optional, raises limit to 5000/hr)';
      tokenInput.style.cssText = 'padding:8px 12px;border:1px solid var(--border-color);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-size:14px;width:300px;max-width:100%;outline:none;';
      var tokenBtn = document.createElement('button');
      tokenBtn.className = 'retry-button';
      tokenBtn.textContent = 'Save & Retry';
      tokenBtn.style.cssText = 'padding:8px 16px;';
      tokenBtn.addEventListener('click', function () {
        var val = tokenInput.value.trim();
        if (val) setToken(val);
        if (retryFn) retryFn();
      });
      tokenWrap.appendChild(tokenInput);
      tokenWrap.appendChild(tokenBtn);

      var tokenHint = document.createElement('p');
      tokenHint.style.cssText = 'width:100%;text-align:center;font-size:12px;color:var(--text-muted);margin-top:8px;';
      tokenHint.textContent = 'Create one at github.com/settings/tokens (no permissions needed, just reduces rate limit)';
      tokenWrap.appendChild(tokenHint);

      errorState.appendChild(tokenWrap);
    }

    if (retryFn) {
      var retryBtn = document.createElement('button');
      retryBtn.className = 'retry-button';
      retryBtn.style.cssText = isRateLimit ? 'margin-top:12px;' : 'margin-top:16px;';
      var retryIcon = document.createElement('span');
      retryIcon.className = 'retry-button__icon';
      retryIcon.appendChild(createRefreshIcon());
      retryBtn.appendChild(retryIcon);
      retryBtn.appendChild(document.createTextNode('Retry'));
      retryBtn.addEventListener('click', retryFn);
      errorState.appendChild(retryBtn);
    }

    mainContent.appendChild(errorState);
  }

  function renderEmpty(mainContent) {
    mainContent.innerHTML = '';
    var emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    var icon = document.createElement('div');
    icon.className = 'empty-state__icon';
    icon.textContent = '\uD83D\uDCC2';
    var title = document.createElement('h2');
    title.className = 'empty-state__title';
    title.textContent = 'No pages found';
    var desc = document.createElement('p');
    desc.className = 'empty-state__description';
    desc.textContent = 'No HTML pages found in this repository.';
    emptyState.appendChild(icon);
    emptyState.appendChild(title);
    emptyState.appendChild(desc);
    mainContent.appendChild(emptyState);
  }

  function renderGrid(mainContent, statusBar, statusCount, files, fromCache) {
    mainContent.innerHTML = '';
    statusCount.innerHTML = '<strong>' + files.length + '</strong> page' + (files.length !== 1 ? 's' : '') + ' found';
    statusBar.style.display = '';
    if (fromCache !== undefined) {
      var hint = document.getElementById('gh-cache-hint');
      if (hint) {
        hint.textContent = fromCache ? 'From cache \u2014 click \u21BB to refresh' : 'Updated just now';
      }
    }

    var grid = document.createElement('div');
    grid.className = 'card-grid';
    grid.id = 'gh-grid';

    files.forEach(function (file, idx) {
      var card = document.createElement('a');
      card.className = 'card';
      card.href = file.path.split('/').map(encodeURIComponent).join('/');
      card.dataset.path = file.path.toLowerCase();
      card.dataset.title = (file.title || '').toLowerCase();
      card.dataset.filename = file.path.split('/').pop().toLowerCase();

      var badge = document.createElement('span');
      badge.className = 'card__badge';
      badge.textContent = file.path.split('/').pop().replace(/\.html$/i, '');
      card.appendChild(badge);

      var cardTitle = document.createElement('h3');
      cardTitle.className = 'card__title';
      cardTitle.textContent = file.title || file.path.split('/').pop();
      cardTitle.id = 'gh-title-' + idx;
      card.appendChild(cardTitle);

      var cardDesc = document.createElement('p');
      cardDesc.className = 'card__description';
      cardDesc.textContent = file.path;
      card.appendChild(cardDesc);

      var meta = document.createElement('div');
      meta.className = 'card__meta';

      var metaItem = document.createElement('span');
      metaItem.className = 'card__meta-item';
      var metaIcon = document.createElement('span');
      metaIcon.className = 'card__meta-icon';
      metaIcon.textContent = '\uD83D\uDCC5';
      metaItem.appendChild(metaIcon);
      var dateEl = document.createElement('span');
      dateEl.id = 'gh-date-' + idx;
      dateEl.textContent = '\u2014';
      metaItem.appendChild(dateEl);
      meta.appendChild(metaItem);

      card.appendChild(meta);
      grid.appendChild(card);
    });

    mainContent.appendChild(grid);
  }

  function renderNoResults(mainContent, statusBar, statusCount, query) {
    statusCount.innerHTML = '<strong>0</strong> pages found';
    var grid = mainContent.querySelector('.card-grid');
    if (grid) grid.innerHTML = '';
    var emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    var icon = document.createElement('div');
    icon.className = 'empty-state__icon';
    icon.textContent = '\uD83D\uDD0D';
    var title = document.createElement('h2');
    title.className = 'empty-state__title';
    title.textContent = 'No results';
    var desc = document.createElement('p');
    desc.className = 'empty-state__description';
    desc.textContent = 'No pages match "' + query + '"';
    emptyState.appendChild(icon);
    emptyState.appendChild(title);
    emptyState.appendChild(desc);
    mainContent.appendChild(emptyState);
  }

  function setupSearchAndSort(files, els, renderFn) {
    var currentSort = 'alpha';
    var currentQuery = '';
    var searchTimeout = null;

    function getFilteredAndSorted() {
      var filtered = files;
      if (currentQuery) {
        var q = currentQuery.toLowerCase();
        filtered = files.filter(function (f) {
          var title = (f.title || '').toLowerCase();
          var path = f.path.toLowerCase();
          var filename = f.path.split('/').pop().toLowerCase();
          return title.includes(q) || path.includes(q) || filename.includes(q);
        });
      }
      var sorted = filtered.slice();
      if (currentSort === 'alpha') {
        sorted.sort(function (a, b) {
          return (a.title || a.path).localeCompare(b.title || b.path);
        });
      } else if (currentSort === 'newest') {
        sorted.sort(function (a, b) {
          if (!a.lastModified) return 1;
          if (!b.lastModified) return -1;
          return new Date(b.lastModified) - new Date(a.lastModified);
        });
      } else if (currentSort === 'oldest') {
        sorted.sort(function (a, b) {
          if (!a.lastModified) return 1;
          if (!b.lastModified) return -1;
          return new Date(a.lastModified) - new Date(b.lastModified);
        });
      }
      return sorted;
    }

    function refreshView() {
      var sorted = getFilteredAndSorted();
      if (sorted.length === 0) {
        renderNoResults(els.mainContent, els.statusBar, els.statusCount, currentQuery);
        return;
      }
      renderFn(sorted);
    }

    els.searchInput.addEventListener('input', function () {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(function () {
        currentQuery = els.searchInput.value.trim();
        refreshView();
      }, SEARCH_DEBOUNCE_MS);
    });

    els.sortSelect.addEventListener('change', function () {
      currentSort = els.sortSelect.value;
      refreshView();
    });
  }

  function fetchTitlesInBatches(files, owner, repo) {
    var tasks = files.map(function (file, idx) {
      return function () {
        return fetchRawContent(owner, repo, file.path).then(function (html) {
          if (html) {
            var title = extractTitleFromHtml(html);
            if (title) {
              files[idx].title = title;
              var el = document.getElementById('gh-title-' + idx);
              if (el) el.textContent = title;
            }
          }
        });
      };
    });
    return batchFetchWithConcurrency(tasks, TITLE_FETCH_CONCURRENCY);
  }

  function init() {
    var repoInfo = detectRepo();
    var root = document.getElementById('app');

    if (!repoInfo) {
      root.innerHTML = '';
      var errorState = document.createElement('div');
      errorState.className = 'error-state';
      var icon = document.createElement('div');
      icon.className = 'error-state__icon';
      icon.textContent = '\uD83D\uDEAB';
      var title = document.createElement('h2');
      title.className = 'error-state__title';
      title.textContent = 'Not a GitHub Pages site';
      var desc = document.createElement('p');
      desc.className = 'error-state__description';
      desc.textContent = 'This page must be hosted on GitHub Pages (e.g. username.github.io).';
      errorState.appendChild(icon);
      errorState.appendChild(title);
      errorState.appendChild(desc);
      root.appendChild(errorState);
      return;
    }

    document.documentElement.setAttribute('data-theme', getTheme());

    var els = renderApp(root, repoInfo);

    els.themeToggle.addEventListener('click', function () {
      var current = getTheme();
      var next = current === 'dark' ? 'light' : 'dark';
      setTheme(next);
      els.themeToggle.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
    });

    els.refreshBtn.addEventListener('click', function () {
      localStorage.removeItem(CACHE_KEY);
      loadFiles();
    });

    var files = [];

    function renderFileGrid(sortedFiles, fromCache) {
      renderGrid(els.mainContent, els.statusBar, els.statusCount, sortedFiles, fromCache);
    }

    setupSearchAndSort(files, els, renderFileGrid);

    function getCachedTree() {
      try {
        var raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        var cached = JSON.parse(raw);
        if (Date.now() - cached.time > CACHE_TTL_MS) return null;
        return cached.tree;
      } catch (e) {
        return null;
      }
    }

    function setCachedTree(tree) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ tree: tree, time: Date.now() }));
      } catch (e) { /* ignore */ }
    }

    function fetchFreshTree() {
      console.log('[Pages] Fetching from GitHub API...');
      return fetchFileTree(repoInfo.owner, repoInfo.repo).then(function (tree) {
        console.log('[Pages] Got tree:', tree.length, 'items');
        setCachedTree(tree);
        processTree(tree, false);
      }).catch(function (error) {
        var isRateLimit = error.message === 'RATE_LIMIT';
        renderError(els.mainContent, errorMessageFor(error), function () {
          localStorage.removeItem(CACHE_KEY);
          loadFiles();
        }, isRateLimit);
      });
    }

    function fetchFreshTreeInBackground() {
      fetchFileTree(repoInfo.owner, repoInfo.repo).then(function (tree) {
        setCachedTree(tree);
        var oldPaths = files.map(function (f) { return f.path; }).sort().join(',');
        var htmlFiles = filterHtmlFiles(tree);
        var newPaths = htmlFiles.map(function (f) { return f.path; }).sort().join(',');

        if (oldPaths !== newPaths) {
          console.log('[Pages] New/updated files detected on GitHub API! Updating grid...');
          processTree(tree, false);
        }
      }).catch(function (err) {
        console.warn('[Pages] Background refresh check failed:', err.message);
      });
    }

    function loadFiles() {
      renderLoading(els.mainContent);
      els.statusBar.style.display = 'none';

      var cached = getCachedTree();
      if (cached) {
        console.log('[Pages] Loading initial view from cache:', cached.length, 'items');
        processTree(cached, true);
        fetchFreshTreeInBackground();
        return Promise.resolve();
      }

      return fetchFreshTree();
    }

    function processTree(tree, fromCache) {
      var htmlFiles = filterHtmlFiles(tree);
      files.length = 0;
      htmlFiles.forEach(function (f) {
        files.push({ path: f.path, title: null, lastModified: null });
      });
      if (files.length === 0) {
        renderEmpty(els.mainContent);
        return;
      }
      renderFileGrid(files, fromCache);
      fetchTitlesInBatches(files, repoInfo.owner, repoInfo.repo);
    }

    loadFiles();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
