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

  function categoryCounts() {
    return state.config.systems.reduce((counts, system) => {
      counts.all += 1;
      counts[system.category] = (counts[system.category] || 0) + 1;
      return counts;
    }, { all: 0 });
  }

  function activeCategoryName() {
    return getCategoryName(state.activeCategory);
  }

  function statusTone(status) {
    if (status === '可访问') return 'is-ready';
    if (status === '维护中') return 'is-maintenance';
    return 'is-pending';
  }

  function renderCategories() {
    const categories = state.config.categories;
    const counts = categoryCounts();
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
            <span>${escapeHtml(category.name)}</span>
            <strong>${escapeHtml(counts[category.id] || 0)}</strong>
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
          const disabled = system.url === '#';
          const tags = (system.tags || []).slice(0, 3);
          const hasImage = Boolean(system.image);
          const cardClass = hasImage ? 'system-card system-card-layout has-image' : 'system-card';
          const cardTag = disabled ? 'article' : 'a';
          const cardAttributes = disabled
            ? ''
            : ` href="${escapeHtml(system.url)}" target="_blank" rel="noopener noreferrer"`;
          const imageMarkup = hasImage
            ? `<div class="system-card-media"><img class="system-card-image" src="${escapeHtml(system.image)}" alt="${escapeHtml(system.name)}系统图片" loading="lazy" decoding="async" onerror="this.closest('.system-card-media')?.remove()"></div>`
            : '';

          return `
            <${cardTag} class="${cardClass} ${disabled ? 'is-placeholder' : 'system-card-link'}"${cardAttributes}>
              <div class="system-card-content">
                <div class="system-card-top">
                  <span class="system-category">${escapeHtml(getCategoryName(system.category))}</span>
                  <span class="status-badge ${statusTone(system.status)}">${escapeHtml(system.status || '可访问')}</span>
                </div>
                <div class="system-card-body">
                  <div class="system-title-line">
                    <div class="system-icon">${iconSvg(system.icon)}</div>
                    <h2>${escapeHtml(system.name)}</h2>
                  </div>
                  <p>${escapeHtml(system.description)}</p>
                </div>
                <div class="tag-row">
                  ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
                </div>
                <div class="system-card-footer">
                  <span>${disabled ? '地址待配置' : '新窗口打开'}</span>
                  <span aria-hidden="true">${disabled ? '待' : '↗'}</span>
                </div>
              </div>
              ${imageMarkup}
            </${cardTag}>
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

  function renderCategorySummary() {
    const counts = categoryCounts();
    return `
      <div class="category-summary" aria-label="分类概览">
        ${state.config.categories.filter((category) => category.id !== 'all').map((category) => `
          <button type="button" data-category="${escapeHtml(category.id)}" class="category-summary-item ${state.activeCategory === category.id ? 'is-active' : ''}">
            <span>${escapeHtml(category.name)}</span>
            <strong>${escapeHtml(counts[category.id] || 0)}</strong>
          </button>
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
          <img src="assets/logo-small.jpg" width="44" height="44" decoding="async" alt="中国医学科学院医学生物学研究所标识">
          <span>
            <strong>${escapeHtml(config.organization.name)}</strong>
            <small>${escapeHtml(config.organization.portalName)}</small>
          </span>
        </a>
        <nav class="nav-actions" aria-label="主题与帮助">
          <a class="button button-secondary" href="admin.html">管理配置</a>
          <a class="button button-primary" href="#systems">入口目录</a>
        </nav>
      </header>

      <section class="hero-section">
        <div class="hero-copy">
          <span class="eyebrow">Institute service index</span>
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
          <div class="panel-kicker">入口清单</div>
          <h2 id="active-category-name">${escapeHtml(activeCategoryName())}</h2>
          <p>系统入口、分类和状态由 <code>assets/config.json</code> 集中维护，管理后台保存后前台刷新即生效。</p>
          ${renderCategorySummary()}
        </div>
      </section>

      <div class="portal-divider" role="presentation">
        <div class="portal-divider-line"></div>
        <div class="portal-divider-line"></div>
      </div>

      <section id="systems" class="systems-section">
        <div class="catalog-heading">
          <div>
            <span class="eyebrow">Service catalogue</span>
            <h2>系统入口目录</h2>
          </div>
          <p>当前显示 <strong id="result-count">${escapeHtml(systems.length)}</strong> 个入口。可按分类筛选，或搜索系统名称、说明和标签。</p>
        </div>
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
  }

  function updateResults() {
    const results = document.getElementById('system-results');
    if (!results) return;
    const systems = filterSystems();
    results.innerHTML = renderSystems(systems);
    const resultCount = document.getElementById('result-count');
    if (resultCount) {
      resultCount.textContent = String(systems.length);
    }
    const activeCategory = document.getElementById('active-category-name');
    if (activeCategory) {
      activeCategory.textContent = activeCategoryName();
    }
    const categories = document.querySelector('.category-bar');
    if (categories) {
      categories.outerHTML = renderCategories();
    }
    const summary = document.querySelector('.category-summary');
    if (summary) {
      summary.outerHTML = renderCategorySummary();
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
      const response = await fetch('assets/config.json', { cache: 'no-store' });
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
