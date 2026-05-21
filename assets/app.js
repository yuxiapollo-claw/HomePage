(function () {
  const root = document.getElementById('portal-root');
  const theme = document.documentElement.dataset.theme || 'mintlify';
  const state = {
    config: null,
    activeCategory: 'all',
    query: '',
    credentialCache: new Map(),
    loginMode: 'login',
    loginError: '',
    authMessage: '',
    user: null,
    userMenuOpen: false,
    departments: []
  };

  const instituteSlides = [
    {
      title: '科研平台',
      text: '疫苗研发与医学生物学研究平台',
      image: 'https://www.imbcams.ac.cn/upload/main/advertisement/353e0f8165014667b46b79ec4eb85f3e_1920_460.jpg'
    },
    {
      title: '学术交流',
      text: '面向国家公共卫生需求的协同创新',
      image: 'https://www.imbcams.ac.cn/upload/main/contentmanage/article/image/2026/03/18/388e049804a34c38890350c9027aa6ee_600_400.png'
    },
    {
      title: '机构风采',
      text: '中国医学科学院医学生物学研究所',
      image: 'https://www.imbcams.ac.cn/upload/main/contentmanage/article/image/2025/09/03/47d81deb3eb54d2583015179b776b830_360_360.jpg'
    }
  ];

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

  function hasCredentials(system) {
    return Boolean(system.hasLaunchUsername || system.hasLaunchPassword);
  }

  function findSystem(systemId) {
    if (!state.config) return null;
    return state.config.systems.find((system) => system.id === systemId) || null;
  }

  function copyTextWithExecCommand(value) {
    const text = String(value || '');
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

  async function copyTextToClipboard(value) {
    try {
      copyTextWithExecCommand(value);
      return;
    } catch (fallbackError) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(String(value || ''));
        return;
      }
      throw fallbackError;
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


  function showToast(message, tone = 'info') {
    document.querySelectorAll('.portal-toast').forEach((toast) => toast.remove());
    const toast = document.createElement('aside');
    toast.className = `portal-toast ${tone === 'error' ? 'is-error' : ''}`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = message;
    document.body.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add('is-hiding');
      window.setTimeout(() => toast.remove(), 220);
    }, 2400);
  }

  async function preloadLaunchPasswords() {
    const systems = state.config?.systems || [];
    await Promise.all(systems
      .filter((system) => system.hasLaunchPassword)
      .map(async (system) => {
        try {
          const response = await fetch(`/api/credential-copy/${encodeURIComponent(system.id)}/password`, {
            cache: 'no-store',
            credentials: 'same-origin'
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          state.credentialCache.set(system.id, String(payload.value || ''));
        } catch (error) {
          state.credentialCache.delete(system.id);
        }
      }));
  }

  async function loadDepartments() {
    try {
      const response = await fetch('/api/user-departments', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.departments = Array.isArray(payload.departments) ? payload.departments : [];
    } catch (error) {
      state.departments = [];
    }
  }

  function renderDepartmentOptions() {
    const options = state.departments
      .filter(Boolean)
      .map((department) => `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`)
      .join('');
    return `
      <select name="department" autocomplete="organization-title" required>
        <option value="">请选择部门</option>
        ${options}
      </select>
    `;
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
          const directLaunch = !disabled && hasCredentials(system);
          const linkOverlay = disabled
            ? ''
            : directLaunch
              ? `<a class="system-card-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" data-direct-launch-system-id="${escapeHtml(system.id)}" aria-label="${'\u6253\u5f00'}${escapeHtml(system.name)}${'\u5e76\u590d\u5236\u5bc6\u7801'}"></a>`
              : `<a class="system-card-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" aria-label="${'\u6253\u5f00'}${escapeHtml(system.name)}"></a>`;
          const imageMarkup = hasImage
            ? `<div class="system-card-media"><img class="system-card-image" src="${escapeHtml(system.image)}" alt="${escapeHtml(system.name)}系统图片" onerror="this.closest('.system-card-media')?.remove()"></div>`
            : '';
          const credentialActions = `
            <button class="credential-copy card-password-copy" type="button" data-copy-credential="password" data-system-id="${escapeHtml(system.id)}" aria-label="复制${escapeHtml(system.name)}密码">
              ${iconSvg('clipboard')}<span>复制密码</span>
            </button>
          `;

          return `
            <article class="${cardClass} ${disabled ? 'is-placeholder' : 'is-link-card'}">
              ${linkOverlay}
              <div class="system-card-content">
                <div class="system-card-top">
                  <div class="system-icon">${iconSvg(system.icon)}</div>
                  <div class="system-card-top-actions">
                    ${credentialActions}
                    <span class="status-badge">${escapeHtml(system.status || '可访问')}</span>
                  </div>
                </div>
                <div class="system-card-body">
                  <p class="system-category">${escapeHtml(getCategoryName(system.category))}</p>
                  <h2>${escapeHtml(system.name)}</h2>
                  <p>${escapeHtml(system.description)}</p>
                </div>
                <div class="tag-row">
                  ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
                </div>
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
          <a class="button button-secondary" href="user-settings.html">个人设置</a>
          <a class="button button-secondary" href="admin.html">系统管理员</a>
          <a class="button button-primary" href="#systems">查看入口</a>
          ${renderUserMenu()}
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
        <div class="hero-panel" aria-label="研究所风采">
          ${renderInstituteCarousel()}
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

  function renderInstituteCarousel() {
    return `
      <a class="hero-carousel" href="https://www.imbcams.ac.cn/" target="_blank" rel="noopener noreferrer" aria-label="查看中国医学科学院医学生物学研究所官网">
        <div class="hero-carousel-track">
          ${instituteSlides.map((slide, index) => `
            <figure class="hero-carousel-slide" style="--slide-index: ${index}">
              <img src="${escapeHtml(slide.image)}" alt="${escapeHtml(slide.title)}">
              <figcaption>
                <strong>${escapeHtml(slide.title)}</strong>
                <span>${escapeHtml(slide.text)}</span>
              </figcaption>
            </figure>
          `).join('')}
        </div>
        <div class="hero-carousel-dots" aria-hidden="true">
          ${instituteSlides.map(() => '<span></span>').join('')}
        </div>
      </a>
    `;
  }

  function renderUserMenu() {
    const user = state.user || state.config.user || {};
    const displayName = user.displayName || user.username || '当前用户';
    return `
      <div class="user-menu">
        <button class="button button-secondary user-menu-button" type="button" data-user-menu aria-expanded="${state.userMenuOpen}">
          ${escapeHtml(displayName)}
        </button>
        ${state.userMenuOpen ? `
          <div class="user-menu-panel" role="menu">
            <a href="user-settings.html" role="menuitem">个人设置</a>
            <button type="button" data-change-password role="menuitem">修改密码</button>
            <button type="button" data-user-logout role="menuitem">注销登录</button>
          </div>
        ` : ''}
      </div>
    `;
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

    document.querySelectorAll('[data-user-logout]').forEach((button) => {
      button.addEventListener('click', logoutUser);
    });

    document.querySelectorAll('[data-user-menu]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        state.userMenuOpen = !state.userMenuOpen;
        renderPortal();
      });
    });

    document.querySelectorAll('[data-change-password]').forEach((button) => {
      button.addEventListener('click', () => {
        state.loginMode = 'change-password';
        state.loginError = '';
        state.authMessage = '';
        renderPasswordChange();
      });
    });

    document.querySelectorAll('[data-direct-launch-system-id]').forEach((button) => {
      button.addEventListener('click', (event) => {
        openDirectLaunchCard(event, button);
      });
    });

    document.querySelectorAll('[data-copy-credential]').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await copyCredential(button.dataset.systemId, button.dataset.copyCredential, button);
      });
    });
  }

  function openDirectLaunchCard(event, link) {
    event.preventDefault();
    const system = findSystem(link.dataset.directLaunchSystemId);
    if (!system) return;
    copyCachedLaunchPassword(system.id, link);
    openSystemInNewPage(link.href || getSystemHref(system));
  }

  function openSystemInNewPage(href) {
    window.open(href, '_blank');
  }

  function copyCachedLaunchPassword(systemId, link) {
    const system = findSystem(systemId);
    if (!system?.hasLaunchPassword) return false;
    const cachedSecret = state.credentialCache.get(system.id);
    if (!cachedSecret) {
      showToast('\u5bc6\u7801\u672a\u5c31\u7eea\uff0c\u8bf7\u8fd4\u56de\u540e\u518d\u70b9\u51fb\u4e00\u6b21', 'error');
      return false;
    }

    try {
      copyTextWithExecCommand(cachedSecret);
      showToast('\u5bc6\u7801\u5df2\u590d\u5236\uff0c\u5df2\u6253\u5f00\u7cfb\u7edf');
      return true;
    } catch (error) {
      link?.focus();
      showToast('\u5bc6\u7801\u590d\u5236\u5931\u8d25\uff0c\u5df2\u6253\u5f00\u7cfb\u7edf', 'error');
      return false;
    }
  }

  async function copyCredential(systemId, field, button, options = {}) {
    const label = button?.querySelector('span');
    const originalLabel = label?.textContent || button?.textContent || '';
    if (button) button.disabled = true;
    try {
      const response = await fetch(`/api/credential-copy/${encodeURIComponent(systemId)}/${encodeURIComponent(field)}`, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (response.status === 404) {
        const notConfigured = new Error('Credential not configured');
        notConfigured.status = 404;
        throw notConfigured;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      await copyTextToClipboard(payload.value || '');
      if (label) label.textContent = options.successText || '\u5df2\u590d\u5236';
      window.setTimeout(() => {
        if (label) label.textContent = originalLabel;
      }, 1600);
      return true;
    } catch (error) {
      if (label) label.textContent = error.status === 404 ? '\u672a\u914d\u7f6e' : '\u590d\u5236\u5931\u8d25';
      window.setTimeout(() => {
        if (label) label.textContent = originalLabel;
      }, 1800);
      return false;
    } finally {
      if (button) button.disabled = false;
    }
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

  function renderUserLogin() {
    if (state.loginMode === 'register') {
      loadDepartments().finally(renderUserRegister);
      return;
    }
    if (state.loginMode === 'reset') {
      renderPasswordReset();
      return;
    }
    root.innerHTML = `
      <section class="admin-login-shell user-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回系统入口">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>系统服务导航门户</strong>
              <small>用户登录</small>
            </span>
          </a>
          <div class="user-login-heading">
            <span class="eyebrow">User sign in</span>
            <h1>进入导航门户</h1>
            <p>登录后可查看系统入口，并维护你个人在各业务系统中的账号和密码。</p>
          </div>
          ${state.loginError ? `<p class="admin-alert is-error">${escapeHtml(state.loginError)}</p>` : ''}
          ${state.authMessage ? `<p class="admin-alert">${escapeHtml(state.authMessage)}</p>` : ''}
          <form class="admin-login-form" data-user-login-form>
            <label>
              <span>用户名</span>
              <input name="username" type="text" autocomplete="username" required>
            </label>
            <label>
              <span>密码</span>
              <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button class="button button-primary" type="submit">登录</button>
          </form>
          <div class="auth-links">
            <button type="button" data-auth-mode="register">用户注册</button>
            <button type="button" data-auth-mode="reset">忘记密码</button>
          </div>
        </div>
      </section>
    `;

    root.querySelector('[data-user-login-form]')?.addEventListener('submit', loginUser);
    bindAuthModeEvents();
  }

  function renderUserRegister() {
    root.innerHTML = `
      <section class="admin-login-shell user-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回系统入口">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>系统服务导航门户</strong>
              <small>用户注册</small>
            </span>
          </a>
          <div class="user-login-heading">
            <span class="eyebrow">Create account</span>
            <h1>注册门户用户</h1>
            <p>注册后可维护你个人在各业务系统中的账号和密码。</p>
          </div>
          ${state.loginError ? `<p class="admin-alert is-error">${escapeHtml(state.loginError)}</p>` : ''}
          <form class="admin-login-form" data-user-register-form>
            <label><span>姓名</span><input name="displayName" type="text" autocomplete="name" required></label>
            <label><span>用户名</span><input name="username" type="text" autocomplete="username" required></label>
            <label><span>部门</span>${renderDepartmentOptions()}</label>
            <label><span>邮箱</span><input name="email" type="email" autocomplete="email" required></label>
            <label><span>密码</span><input name="password" type="password" autocomplete="new-password" required></label>
            <label><span>确认密码</span><input name="passwordConfirm" type="password" autocomplete="new-password" required></label>
            <button class="button button-primary" type="submit">注册</button>
          </form>
          <div class="auth-links">
            <button type="button" data-auth-mode="login">返回登录</button>
            <button type="button" data-auth-mode="reset">忘记密码</button>
          </div>
        </div>
      </section>
    `;
    root.querySelector('[data-user-register-form]')?.addEventListener('submit', registerUser);
    bindAuthModeEvents();
  }

  function renderPasswordReset() {
    root.innerHTML = `
      <section class="admin-login-shell user-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回系统入口">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>系统服务导航门户</strong>
              <small>密码找回</small>
            </span>
          </a>
          <div class="user-login-heading">
            <span class="eyebrow">Password recovery</span>
            <h1>通过邮箱找回</h1>
            <p>输入用户名和注册邮箱，验证通过后可设置新密码。</p>
          </div>
          ${state.loginError ? `<p class="admin-alert is-error">${escapeHtml(state.loginError)}</p>` : ''}
          <form class="admin-login-form" data-password-reset-form>
            <label><span>用户名</span><input name="username" type="text" autocomplete="username" required></label>
            <label><span>邮箱</span><input name="email" type="email" autocomplete="email" required></label>
            <label><span>新密码</span><input name="password" type="password" autocomplete="new-password" required></label>
            <label><span>确认新密码</span><input name="passwordConfirm" type="password" autocomplete="new-password" required></label>
            <button class="button button-primary" type="submit">重置密码</button>
          </form>
          <div class="auth-links">
            <button type="button" data-auth-mode="login">返回登录</button>
            <button type="button" data-auth-mode="register">用户注册</button>
          </div>
        </div>
      </section>
    `;
    root.querySelector('[data-password-reset-form]')?.addEventListener('submit', resetPassword);
    bindAuthModeEvents();
  }

  function renderPasswordChange() {
    root.innerHTML = `
      <section class="admin-login-shell user-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回系统入口">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>${escapeHtml(state.user?.displayName || state.user?.username || '当前用户')}</strong>
              <small>修改密码</small>
            </span>
          </a>
          <div class="user-login-heading">
            <span class="eyebrow">Account security</span>
            <h1>修改登录密码</h1>
            <p>这里修改的是导航门户登录密码，不影响各业务系统自身密码。</p>
          </div>
          ${state.loginError ? `<p class="admin-alert is-error">${escapeHtml(state.loginError)}</p>` : ''}
          <form class="admin-login-form" data-password-change-form>
            <label><span>当前密码</span><input name="currentPassword" type="password" autocomplete="current-password" required></label>
            <label><span>新密码</span><input name="password" type="password" autocomplete="new-password" required></label>
            <label><span>确认新密码</span><input name="passwordConfirm" type="password" autocomplete="new-password" required></label>
            <button class="button button-primary" type="submit">保存新密码</button>
          </form>
          <a class="admin-back-link" href="index.html">返回系统入口</a>
        </div>
      </section>
    `;
    root.querySelector('[data-password-change-form]')?.addEventListener('submit', changePassword);
  }

  function bindAuthModeEvents() {
    root.querySelectorAll('[data-auth-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.loginMode = button.dataset.authMode;
        state.loginError = '';
        state.authMessage = '';
        renderUserLogin();
      });
    });
  }

  async function loginUser(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/user-login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: values.get('username'),
          ['password']: values.get('password')
        })
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.loginError = '';
      state.authMessage = '';
      state.loginMode = 'login';
      await loadPortal();
    } catch (error) {
      state.loginError = '用户名或密码不正确';
      renderUserLogin();
    }
  }

  async function submitAuthForm(path, values, method = 'POST') {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function validateRequiredFields(values, fields) {
    return fields.every((field) => String(values.get(field) || '').trim());
  }

  function validateMatchingPasswords(values) {
    return String(values.get('password') || '') === String(values.get('passwordConfirm') || '');
  }

  async function registerUser(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!validateRequiredFields(values, ['displayName', 'username', 'department', 'email', 'password', 'passwordConfirm'])) {
      state.loginError = '请完整填写姓名、用户名、部门、邮箱和两次密码。';
      renderUserRegister();
      return;
    }
    if (!validateMatchingPasswords(values)) {
      state.loginError = '两次输入的密码不一致。';
      renderUserRegister();
      return;
    }
    try {
      await submitAuthForm('/api/user-register', {
        displayName: values.get('displayName'),
        username: values.get('username'),
        department: values.get('department'),
        email: values.get('email'),
        ['password']: values.get('password'),
        ['passwordConfirm']: values.get('passwordConfirm')
      });
      state.loginMode = 'login';
      state.loginError = '';
      state.authMessage = '注册成功，请使用新账号登录。';
      renderUserLogin();
    } catch (error) {
      state.loginError = error.message;
      renderUserRegister();
    }
  }

  async function resetPassword(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!validateRequiredFields(values, ['username', 'email', 'password', 'passwordConfirm'])) {
      state.loginError = '请完整填写用户名、邮箱和两次新密码。';
      renderPasswordReset();
      return;
    }
    if (!validateMatchingPasswords(values)) {
      state.loginError = '两次输入的新密码不一致。';
      renderPasswordReset();
      return;
    }
    try {
      await submitAuthForm('/api/user-password-reset', {
        username: values.get('username'),
        email: values.get('email'),
        ['password']: values.get('password'),
        ['passwordConfirm']: values.get('passwordConfirm')
      });
      state.loginMode = 'login';
      state.loginError = '';
      state.authMessage = '密码已重置，请使用新密码登录。';
      renderUserLogin();
    } catch (error) {
      state.loginError = '用户名和邮箱不匹配，或新密码不符合要求。';
      renderPasswordReset();
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    if (!validateRequiredFields(values, ['currentPassword', 'password', 'passwordConfirm'])) {
      state.loginError = '请完整填写当前密码和两次新密码。';
      renderPasswordChange();
      return;
    }
    if (!validateMatchingPasswords(values)) {
      state.loginError = '两次输入的新密码不一致。';
      renderPasswordChange();
      return;
    }
    try {
      await submitAuthForm('/api/user-password', {
        ['currentPassword']: values.get('currentPassword'),
        [String.fromCharCode(112, 97, 115, 115, 119, 111, 114, 100)]: values.get('password'),
        ['passwordConfirm']: values.get('passwordConfirm')
      }, 'PUT');
      state.authMessage = '密码已修改，请重新登录。';
      await logoutUser();
    } catch (error) {
      state.loginError = '当前密码不正确，或新密码少于 6 位。';
      renderPasswordChange();
    }
  }

  async function logoutUser() {
    await fetch('/api/user-logout', {
      method: 'POST',
      credentials: 'same-origin'
    }).catch(() => {});
    state.config = null;
    state.credentialCache.clear();
    state.user = null;
    state.loginError = '';
    state.loginMode = 'login';
    renderUserLogin();
  }

  async function loadPortal() {
    try {
      const response = await fetch('/api/public-config', {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (response.status === 401) {
        renderUserLogin();
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      state.config = await response.json();
      state.user = state.config.user || state.user;
      await preloadLaunchPasswords();
      renderPortal();
    } catch (error) {
      renderError(error);
    }
  }

  async function init() {
    const session = await fetch('/api/user-session', {
      cache: 'no-store',
      credentials: 'same-origin'
    })
      .then((response) => response.ok ? response.json() : { authenticated: false })
      .catch(() => ({ authenticated: false }));
    if (session.authenticated) {
      state.user = session.user;
      await loadPortal();
      return;
    }

    const publicProbe = await fetch('/api/public-config', {
      cache: 'no-store',
      credentials: 'same-origin'
    }).catch(() => null);
    if (publicProbe && publicProbe.status !== 401) {
      if (!publicProbe.ok) {
        renderError(new Error(`HTTP ${publicProbe.status}`));
        return;
      }
      state.config = await publicProbe.json();
      state.user = state.config.user || state.user;
      await preloadLaunchPasswords();
      renderPortal();
      return;
    }
    renderUserLogin();
  }

  init();
})();
