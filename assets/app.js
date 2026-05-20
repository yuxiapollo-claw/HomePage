(function () {
  const root = document.getElementById('portal-root');
  const theme = document.documentElement.dataset.theme || 'mintlify';
  const state = {
    config: null,
    activeCategory: 'all',
    query: ''
  };

  const iconMap = {
    'layout-dashboard': ['M4 5h7v6H4z', 'M13 5h7v4h-7z', 'M13 11h7v8h-7z', 'M4 13h7v6H4z'],
    boxes: ['M12 3l7 4-7 4-7-4z', 'M5 9l7 4 7-4', 'M5 13l7 4 7-4'],
    database: ['M5 6c0-2 14-2 14 0v12c0 2-14 2-14 0z', 'M5 10c0 2 14 2 14 0', 'M5 14c0 2 14 2 14 0'],
    flask: ['M9 3h6', 'M10 3v5l-5 8c-.8 1.4.2 3 1.8 3h10.4c1.6 0 2.6-1.6 1.8-3l-5-8V3', 'M8 14h8'],
    'file-text': ['M7 3h7l4 4v14H7z', 'M14 3v5h5', 'M9 12h6', 'M9 16h6'],
    chart: ['M5 19V9', 'M12 19V5', 'M19 19v-7', 'M4 19h17'],
    shield: ['M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z', 'M9 12l2 2 4-4'],
    'life-buoy': ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8 8l3 3', 'M16 8l-3 3', 'M8 16l3-3', 'M16 16l-3-3'],
    graduation: ['M3 8l9-4 9 4-9 4z', 'M7 10v5c3 2 7 2 10 0v-5', 'M21 8v6'],
    clipboard: ['M9 4h6l1 2h3v15H5V6h3z', 'M9 4h6', 'M8 11h8', 'M8 15h6'],
    'check-circle': ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M8.5 12l2.5 2.5L16 9'],
    calendar: ['M6 5h12v15H6z', 'M8 3v4', 'M16 3v4', 'M6 10h12']
  };

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function iconSvg(name) {
    const paths = iconMap[name] || iconMap['layout-dashboard'];
    const content = paths.map((path) => `<path d="${path}"></path>`).join('');
    return `<svg class="system-icon-svg" viewBox="0 0 24 24" aria-hidden="true">${content}</svg>`;
  }

  function getCategoryName(id) {
    const category = state.config.categories.find((item) => item.id === id);
    return category ? category.name : '未分类';
  }

  function getSystemHref(system) {
    if (system.launchMode === 'proxy' && String(system.credentialProfile || '').trim()) {
      return `/api/launch/${encodeURIComponent(system.id)}`;
    }
    return system.launchHref || system.url || '#';
  }

  function renderCredentialActions(system) {
    if (!system.hasLaunchUsername && !system.hasLaunchPassword) return '';
    return `
      <div class="credential-actions" aria-label="${escapeHtml(system.name)}凭据复制">
        ${system.hasLaunchUsername ? `
          <button class="credential-copy" type="button" data-copy-credential="username" data-system-id="${escapeHtml(system.id)}">
            ${iconSvg('clipboard')}
            <span>复制账号</span>
          </button>
        ` : ''}
        ${system.hasLaunchPassword ? `
          <button class="credential-copy" type="button" data-copy-credential="password" data-system-id="${escapeHtml(system.id)}">
            ${iconSvg('clipboard')}
            <span>复制密码</span>
          </button>
        ` : ''}
      </div>
    `;
  }

  async function copyTextToClipboard(value) {
    const text = String(value || '');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        // Fall back for internal HTTP deployments where Clipboard API can be blocked.
      }
    }

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
      throw new Error('Clipboard copy failed');
    }
  }

  function filterSystems() {
    const query = state.query.trim().toLowerCase();
    return state.config.systems.filter((system) => {
      const matchesCategory = state.activeCategory === 'all' || system.category === state.activeCategory;
      const searchText = [
        system.name,
        system.description,
        system.status,
        getCategoryName(system.category),
        ...(system.tags || [])
      ].join(' ').toLowerCase();
      return matchesCategory && (!query || searchText.includes(query));
    });
  }

  function renderCategories() {
    const categories = state.config.categories;
    return `
      <div class="category-bar" role="tablist" aria-label="系统分类">
        ${categories.map((category) => `
          <button
            class="category-pill ${state.activeCategory === category.id ? 'is-active' : ''}"
            type="button"
            role="tab"
            aria-selected="${state.activeCategory === category.id}"
            data-category="${escapeHtml(category.id)}"
          >
            ${escapeHtml(category.name)}
          </button>
        `).join('')}
      </div>
    `;
  }

  function renderSystems(systems) {
    if (!systems.length) {
      return `
        <section class="empty-state" aria-live="polite">
          <div class="empty-state-mark">${iconSvg('database')}</div>
          <h2>没有找到匹配的系统入口</h2>
          <p>请调整关键词或切换分类。真实系统清单接入后，这里会自动展示对应入口。</p>
          <button class="button button-secondary" type="button" data-reset-search>重置筛选</button>
        </section>
      `;
    }

    return `
      <section class="system-grid" aria-label="系统入口列表">
        ${systems.map((system) => {
          const href = getSystemHref(system);
          const disabled = href === '#';
          const tags = (system.tags || []).slice(0, 3);
          const hasImage = Boolean(system.image);
          const cardClass = hasImage ? 'system-card system-card-layout has-image' : 'system-card';
          const linkOverlay = disabled
            ? ''
            : `<a class="system-card-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="打开${escapeHtml(system.name)}"></a>`;
          const imageMarkup = hasImage
            ? `<div class="system-card-media"><img class="system-card-image" src="${escapeHtml(system.image)}" alt="${escapeHtml(system.name)}系统图片" onerror="this.closest('.system-card-media')?.remove()"></div>`
            : '';
          const credentialActions = renderCredentialActions(system);

          return `
            <article class="${cardClass} ${disabled ? 'is-placeholder' : 'is-link-card'}">
              ${linkOverlay}
              <div class="system-card-content">
                <div class="system-card-top">
                  <div class="system-icon">${iconSvg(system.icon)}</div>
                  <span class="status-badge">${escapeHtml(system.status || '可访问')}</span>
                </div>
                <div class="system-card-body">
                  <p class="system-category">${escapeHtml(getCategoryName(system.category))}</p>
                  <h2>${escapeHtml(system.name)}</h2>
                  <p>${escapeHtml(system.description)}</p>
                </div>
                <div class="tag-row">
                  ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
                </div>
                ${credentialActions}
              </div>
              ${imageMarkup}
            </article>
          `;
        }).join('')}
      </section>
    `;
  }

  function renderMetrics() {
    const systemCount = state.config.systems.length;
    const categoryCount = state.config.categories.filter((item) => item.id !== 'all').length;
    const envMetric = state.config.metrics.find((metric) => metric.label === '访问环境');
    const metrics = [
      { label: '系统入口', value: String(systemCount) },
      { label: '服务分类', value: String(categoryCount) },
      { label: '访问环境', value: envMetric?.value || '内网' }
    ];

    return `
      <div class="metric-row" aria-label="门户概览">
        ${metrics.map((metric) => `
          <div class="metric-item">
            <strong>${escapeHtml(metric.value)}</strong>
            <span>${escapeHtml(metric.label)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function renderPortal() {
    const config = state.config;
    const systems = filterSystems();
    root.innerHTML = `
      <header class="top-nav">
        <a class="brand" href="${theme === 'starbucks' ? 'starbucks.html' : 'index.html'}" aria-label="${escapeHtml(config.organization.portalName)}首页">
          <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
          <span>
            <strong>${escapeHtml(config.organization.name)}</strong>
            <small>${escapeHtml(config.organization.portalName)}</small>
          </span>
        </a>
        <nav class="nav-actions" aria-label="主题与帮助">
          <a class="button button-secondary" href="admin.html">系统管理员</a>
          <a class="button button-primary" href="#systems">查看入口</a>
        </nav>
      </header>

      <section class="hero-section">
        <div class="hero-copy">
          <span class="eyebrow">Internal service portal</span>
          <h1>${escapeHtml(config.organization.portalName)}</h1>
          <p>${escapeHtml(config.organization.description || config.organization.subtitle)}</p>
          <div class="hero-actions">
            <label class="search-shell">
              <span class="sr-only">搜索系统入口</span>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.5 18a7.5 7.5 0 1 1 5.3-2.2L21 21"></path></svg>
              <input id="portal-search" type="search" placeholder="搜索系统名称、标签或说明" value="${escapeHtml(state.query)}" autocomplete="off">
            </label>
            <button class="button button-primary" type="button" data-focus-search>快速搜索</button>
          </div>
          ${renderMetrics()}
        </div>
        <div class="hero-panel" aria-label="门户配置说明">
          <div class="mock-window">
            <div class="mock-dots"><span></span><span></span><span></span></div>
            <div class="mock-line wide"></div>
            <div class="mock-line"></div>
            <div class="mock-card-row">
              <div></div>
              <div></div>
              <div></div>
            </div>
          </div>
          <p>入口数据来自 <code>assets/config.json</code>，后续清单更新不需要改页面结构。</p>
        </div>
      </section>

      <div class="portal-divider" role="presentation">
        <div class="portal-divider-line"></div>
        <div class="portal-divider-line"></div>
      </div>

      <section id="systems" class="systems-section">
        ${renderCategories()}
        <div id="system-results">${renderSystems(systems)}</div>
      </section>

      <footer class="site-footer">
        <div>
          <strong>${escapeHtml(config.organization.name)}</strong>
          <p>${escapeHtml(config.organization.support)}维护。静态部署版本，系统清单通过配置文件更新。</p>
        </div>
        <a href="#portal-root">返回顶部</a>
      </footer>
    `;

    bindEvents();
  }

  function bindEvents() {
    const search = document.getElementById('portal-search');
    if (search) {
      search.addEventListener('input', (event) => {
        state.query = event.target.value;
        updateResults();
      });
    }

    document.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        state.activeCategory = button.dataset.category;
        updateResults();
      });
    });

    document.querySelectorAll('[data-focus-search]').forEach((button) => {
      button.addEventListener('click', () => {
        document.getElementById('portal-search')?.focus();
      });
    });

    document.querySelectorAll('[data-reset-search]').forEach((button) => {
      button.addEventListener('click', () => {
        state.query = '';
        state.activeCategory = 'all';
        renderPortal();
      });
    });

    document.querySelectorAll('[data-copy-credential]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const field = button.dataset.copyCredential;
        const systemId = button.dataset.systemId;
        const originalLabel = button.querySelector('span')?.textContent || '';
        button.disabled = true;
        try {
          const response = await fetch(`/api/credential-copy/${encodeURIComponent(systemId)}/${encodeURIComponent(field)}`, {
            cache: 'no-store'
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          await copyTextToClipboard(payload.value || '');
          const label = button.querySelector('span');
          if (label) label.textContent = '已复制';
          window.setTimeout(() => {
            if (label) label.textContent = originalLabel;
          }, 1600);
        } catch (error) {
          const label = button.querySelector('span');
          if (label) label.textContent = '复制失败';
          window.setTimeout(() => {
            if (label) label.textContent = originalLabel;
          }, 1800);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function updateResults() {
    const results = document.getElementById('system-results');
    if (!results) return;
    results.innerHTML = renderSystems(filterSystems());
    const categories = document.querySelector('.category-bar');
    if (categories) {
      categories.outerHTML = renderCategories();
    }
    bindEvents();
  }

  function renderError(error) {
    root.innerHTML = `
      <section class="empty-state load-error">
        <div class="empty-state-mark">${iconSvg('life-buoy')}</div>
        <h1>配置加载失败</h1>
        <p>请检查 <code>assets/config.json</code> 是否存在且格式正确。</p>
        <pre>${escapeHtml(error.message)}</pre>
      </section>
    `;
  }

  async function init() {
    try {
      const response = await fetch('/api/public-config', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      state.config = await response.json();
      renderPortal();
    } catch (error) {
      renderError(error);
    }
  }

  init();
})();
