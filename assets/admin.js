(function () {
  const root = document.getElementById('admin-root');
  const state = {
    config: null,
    selectedId: null,
    query: '',
    message: '',
    error: '',
    uploadMessage: '',
    saveDialogOpen: false,
    draft: null
  };

  const defaultSystem = {
    name: '',
    description: '',
    category: 'common',
    icon: 'layout-dashboard',
    image: '',
    tags: '',
    status: '待配置',
    url: '#',
    credentialProfile: '',
    launchUsername: '',
    launchPassword: '',
    hasLaunchPassword: false
  };

  const iconOptions = [
    'layout-dashboard',
    'boxes',
    'database',
    'flask',
    'file-text',
    'chart',
    'shield',
    'life-buoy',
    'graduation',
    'clipboard',
    'check-circle',
    'calendar'
  ];

  const statusOptions = ['可访问', '待配置', '维护中'];

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function setNotice(message, error) {
    state.message = message || '';
    state.error = error || '';
  }

  function setUploadNotice(message) {
    state.uploadMessage = message || '';
  }

  async function api(path, options) {
    const headers = { ...(options?.headers || {}) };
    const isFormData = options?.body instanceof FormData;
    if (!isFormData && !headers['content-type']) {
      headers['content-type'] = 'application/json';
    }

    const response = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  }

  function getSelectedSystem() {
    if (!state.config || !state.selectedId) return null;
    return state.config.systems.find((system) => system.id === state.selectedId) || null;
  }

  function formValue(system) {
    const source = system || defaultSystem;
    return {
      ...defaultSystem,
      ...source,
      tags: Array.isArray(source.tags) ? source.tags.join(', ') : source.tags || '',
      launchPassword: ''
    };
  }

  function currentValues() {
    if (!state.draft) {
      state.draft = formValue(getSelectedSystem());
    }
    return state.draft;
  }

  function resetDraft(system) {
    state.draft = formValue(system);
  }

  function filteredSystems() {
    const query = state.query.trim().toLowerCase();
    if (!query) return state.config.systems;
    return state.config.systems.filter((system) => {
      return [
        system.name,
        system.description,
        system.category,
        system.status,
        ...(system.tags || [])
      ].join(' ').toLowerCase().includes(query);
    });
  }

  function categoryName(id) {
    const category = state.config.categories.find((item) => item.id === id);
    return category ? category.name : id;
  }

  function selectedSystemIndex() {
    if (!state.config || !state.selectedId) return -1;
    return state.config.systems.findIndex((system) => system.id === state.selectedId);
  }

  function previewIconLabel(icon) {
    const parts = String(icon || 'FI').split('-');
    return parts.map((part) => part.charAt(0)).join('').slice(0, 2).toUpperCase() || 'FI';
  }

  function dialogMarkup() {
    if (!state.saveDialogOpen) return '';
    return `
      <div class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
        <div class="admin-modal-card">
          <h2 id="save-dialog-title">配置已生效</h2>
          <p>当前修改已经写入配置文件，前台入口页刷新后即可看到最新内容。</p>
          <div class="admin-modal-actions">
            <button class="button button-primary" type="button" data-close-dialog>知道了</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderLogin() {
    root.innerHTML = `
      <section class="admin-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回门户首页">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>系统服务导航门户</strong>
              <small>管理员配置入口</small>
            </span>
          </a>
          <div class="section-heading">
            <span class="eyebrow">Admin console</span>
            <h1>管理配置</h1>
            <p>登录后维护系统入口卡片，保存后前台页面刷新即可生效。</p>
          </div>
          ${state.error ? `<p class="admin-alert is-error">${escapeHtml(state.error)}</p>` : ''}
          <form class="admin-login-form" data-login-form>
            <label>
              <span>管理员密码</span>
              <input name="password" type="password" autocomplete="current-password" required>
            </label>
            <button class="button button-primary" type="submit">登录</button>
          </form>
          <a class="admin-back-link" href="index.html">返回系统入口</a>
        </div>
      </section>
    `;
    root.querySelector('[data-login-form]')?.addEventListener('submit', login);
  }

  function renderList() {
    const systems = filteredSystems();
    const selectedIndex = selectedSystemIndex();
    const isSearching = Boolean(state.query.trim());
    return `
      <section class="admin-list-panel">
        <div class="admin-panel-head">
          <div>
            <span class="eyebrow">Service cards</span>
            <h2>入口卡片</h2>
          </div>
          <button class="button button-primary" type="button" data-new-system>新增入口</button>
        </div>
        <label class="admin-search">
          <span class="sr-only">搜索系统入口</span>
          <input type="search" placeholder="搜索名称、描述、分类或标签" value="${escapeHtml(state.query)}" data-admin-search>
        </label>
        <div class="admin-order-actions">
          <button class="button button-secondary" type="button" data-move-up ${selectedIndex <= 0 || isSearching ? 'disabled' : ''}>上移</button>
          <button class="button button-secondary" type="button" data-move-down ${selectedIndex === -1 || selectedIndex >= state.config.systems.length - 1 || isSearching ? 'disabled' : ''}>下移</button>
          <span class="admin-order-hint">${isSearching ? '搜索状态下不可调整顺序' : '选择卡片后可调整显示顺序'}</span>
        </div>
        <div class="admin-card-list">
          ${systems.map((system) => `
            <button class="admin-system-row ${state.selectedId === system.id ? 'is-active' : ''}" type="button" data-edit-id="${escapeHtml(system.id)}">
              <span>
                <strong>${escapeHtml(system.name)}</strong>
                <small>${escapeHtml(categoryName(system.category))} / ${escapeHtml(system.status || '待配置')}</small>
              </span>
              <em>${escapeHtml((system.tags || []).slice(0, 2).join(' · '))}</em>
            </button>
          `).join('')}
        </div>
      </section>
    `;
  }

  function renderPreview(values) {
    const tags = String(values.tags || '')
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3);

    return `
      <aside class="admin-preview" aria-label="卡片预览">
        <span class="eyebrow">Preview</span>
        <article class="system-card ${values.image ? 'system-card-layout has-image' : ''}">
          <div class="system-card-content">
            <div class="system-card-top">
              <div class="system-icon">${previewIconLabel(values.icon)}</div>
              <span class="status-badge">${escapeHtml(values.status || '待配置')}</span>
            </div>
            <div class="system-card-body">
              <p class="system-category">${escapeHtml(categoryName(values.category))}</p>
              <h2>${escapeHtml(values.name || '系统名称')}</h2>
              <p>${escapeHtml(values.description || '系统描述将在这里显示。')}</p>
            </div>
            <div class="tag-row">
              ${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('')}
            </div>
          </div>
          ${values.image ? `<div class="system-card-media"><img class="system-card-image" src="${escapeHtml(values.image)}" alt="${escapeHtml(values.name || '系统图片')}"></div>` : ''}
        </article>
      </aside>
    `;
  }

  function renderForm() {
    const selected = getSelectedSystem();
    const values = currentValues();
    return `
      <section class="admin-form-panel">
        <div class="admin-panel-head">
          <div>
            <span class="eyebrow">Card editor</span>
            <h2>${selected ? '编辑入口' : '新增入口'}</h2>
          </div>
          ${selected ? `<button class="button button-secondary" type="button" data-cancel-edit>取消编辑</button>` : ''}
        </div>
        <form class="admin-form" data-system-form>
          <label>
            <span>系统名称</span>
            <input name="name" value="${escapeHtml(values.name)}" required>
          </label>
          <label>
            <span>描述</span>
            <textarea name="description" rows="4" required>${escapeHtml(values.description)}</textarea>
          </label>
          <div class="admin-form-grid">
            <label>
              <span>分类</span>
              <select name="category" required>
                ${state.config.categories.filter((item) => item.id !== 'all').map((category) => `
                  <option value="${escapeHtml(category.id)}" ${values.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>
                `).join('')}
              </select>
            </label>
            <label>
              <span>图标</span>
              <select name="icon">
                ${iconOptions.map((icon) => `<option value="${icon}" ${values.icon === icon ? 'selected' : ''}>${icon}</option>`).join('')}
              </select>
            </label>
          </div>
          <label>
            <span>图片</span>
            <div class="admin-upload">
              <input name="image" type="hidden" value="${escapeHtml(values.image)}">
              <label class="button button-secondary admin-upload-button">
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-image-upload>
                上传本地图片
              </label>
              <span class="admin-upload-path">${escapeHtml(values.image || '未上传图片')}</span>
              ${values.image ? '<button class="button admin-upload-remove" type="button" data-delete-image>删除图片</button>' : ''}
            </div>
            ${state.uploadMessage ? `<span class="admin-upload-help">${escapeHtml(state.uploadMessage)}</span>` : '<span class="admin-upload-help">支持 png、jpg、webp、gif，上传后自动写入 assets/uploads。</span>'}
          </label>
          <label>
            <span>访问地址</span>
            <input name="url" value="${escapeHtml(values.url)}" placeholder="https://... 或 #">
          </label>
          <input type="hidden" name="credentialProfile" value="${escapeHtml(values.credentialProfile)}">
          <div class="admin-form-grid">
            <label>
              <span>登录账号</span>
              <input name="launchUsername" value="${escapeHtml(values.launchUsername)}" placeholder="不填写则普通跳转" autocomplete="off">
            </label>
            <label>
              <span>登录密码</span>
              <input name="launchPassword" type="password" value="${escapeHtml(values.launchPassword)}" placeholder="${values.hasLaunchPassword ? '已保存密码，不修改可留空' : '填写登录密码'}" autocomplete="new-password">
            </label>
          </div>
          <span class="admin-upload-help">账号密码保存在服务器本地凭据文件，不写入公开入口配置。</span>
          <div class="admin-form-grid">
            <label>
              <span>状态</span>
              <select name="status">
                ${statusOptions.map((status) => `<option value="${status}" ${values.status === status ? 'selected' : ''}>${status}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>标签</span>
              <input name="tags" value="${escapeHtml(values.tags)}" placeholder="办公, 审批, 内网">
            </label>
          </div>
          <div class="admin-form-actions">
            <button class="button button-primary" type="submit">${selected ? '保存修改' : '新增入口'}</button>
            ${selected ? `<button class="button admin-danger" type="button" data-delete-system>删除入口</button>` : ''}
          </div>
        </form>
        ${renderPreview(values)}
      </section>
    `;
  }

  function renderAdmin() {
    root.innerHTML = `
      <header class="top-nav">
        <a class="brand" href="index.html" aria-label="返回门户首页">
          <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
          <span>
            <strong>系统服务导航门户</strong>
            <small>管理员配置</small>
          </span>
        </a>
        <nav class="nav-actions" aria-label="管理操作">
          <a class="button button-secondary" href="index.html">查看入口</a>
          <button class="button button-primary" type="button" data-logout>退出登录</button>
        </nav>
      </header>
      <section class="admin-hero">
        <span class="eyebrow">Admin console</span>
        <h1>系统入口配置</h1>
        <p>集中维护系统名称、描述、分类、图标、图片、标签和访问地址。</p>
      </section>
      <section class="admin-shell">
        ${state.message ? `<p class="admin-alert">${escapeHtml(state.message)}</p>` : ''}
        ${state.error ? `<p class="admin-alert is-error">${escapeHtml(state.error)}</p>` : ''}
        ${renderList()}
        ${renderForm()}
      </section>
      ${dialogMarkup()}
    `;
    bindAdminEvents();
  }

  function syncDraftFromForm() {
    const form = root.querySelector('[data-system-form]');
    if (!form) return;
    state.draft = {
      ...defaultSystem,
      ...Object.fromEntries(new FormData(form).entries())
    };
  }

  function bindAdminEvents() {
    root.querySelector('[data-logout]')?.addEventListener('click', logout);
    root.querySelector('[data-close-dialog]')?.addEventListener('click', () => {
      state.saveDialogOpen = false;
      renderAdmin();
    });
    root.querySelector('[data-new-system]')?.addEventListener('click', () => {
      state.selectedId = null;
      state.saveDialogOpen = false;
      setNotice('', '');
      setUploadNotice('');
      resetDraft(null);
      renderAdmin();
    });
    root.querySelector('[data-cancel-edit]')?.addEventListener('click', () => {
      state.selectedId = null;
      state.saveDialogOpen = false;
      setUploadNotice('');
      resetDraft(null);
      renderAdmin();
    });
    root.querySelector('[data-admin-search]')?.addEventListener('input', (event) => {
      state.query = event.target.value;
      renderAdmin();
      root.querySelector('[data-admin-search]')?.focus();
    });
    root.querySelector('[data-move-up]')?.addEventListener('click', () => moveSystem(-1));
    root.querySelector('[data-move-down]')?.addEventListener('click', () => moveSystem(1));
    root.querySelectorAll('[data-edit-id]').forEach((button) => {
      button.addEventListener('click', () => {
        state.selectedId = button.dataset.editId;
        state.saveDialogOpen = false;
        setNotice('', '');
        setUploadNotice('');
        resetDraft(getSelectedSystem());
        renderAdmin();
      });
    });
    root.querySelector('[data-system-form]')?.addEventListener('submit', saveSystem);
    root.querySelector('[data-delete-system]')?.addEventListener('click', deleteSystem);
    root.querySelector('[data-image-upload]')?.addEventListener('change', uploadImage);
    root.querySelector('[data-delete-image]')?.addEventListener('click', deleteImage);
    root.querySelector('[data-system-form]')?.addEventListener('input', () => {
      syncDraftFromForm();
      const preview = root.querySelector('.admin-preview');
      if (preview) preview.outerHTML = renderPreview(currentValues());
    });
  }

  async function login(event) {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get('password');
    try {
      await api('/api/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });
      setNotice('', '');
      await loadConfig();
    } catch (error) {
      setNotice('', error.message);
      renderLogin();
    }
  }

  async function logout() {
    await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
    state.config = null;
    state.selectedId = null;
    state.draft = null;
    state.saveDialogOpen = false;
    setNotice('', '');
    setUploadNotice('');
    renderLogin();
  }

  async function loadConfig() {
    state.config = await api('/api/config');
    if (state.selectedId && !getSelectedSystem()) {
      state.selectedId = null;
    }
    resetDraft(getSelectedSystem());
    renderAdmin();
  }

  async function saveSystem(event) {
    event.preventDefault();
    syncDraftFromForm();
    const body = currentValues();
    try {
      const selected = getSelectedSystem();
      const result = await api(selected ? `/api/systems/${encodeURIComponent(selected.id)}` : '/api/systems', {
        method: selected ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      state.config = result.config;
      state.selectedId = result.system.id;
      resetDraft(result.system);
      state.saveDialogOpen = true;
      setNotice('配置已保存，前台刷新后生效。', '');
      renderAdmin();
    } catch (error) {
      setNotice('', error.message);
      renderAdmin();
    }
  }

  async function uploadImage(event) {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) return;

    syncDraftFromForm();
    const form = new FormData();
    form.set('image', file);
    setUploadNotice('正在上传图片...');
    renderAdmin();

    try {
      const data = await api('/api/upload', {
        method: 'POST',
        body: form
      });
      state.draft.image = data.path;
      setUploadNotice(`已上传：${data.path}`);
      renderAdmin();
    } catch (error) {
      setUploadNotice(error.message);
      renderAdmin();
    }
  }

  async function deleteSystem() {
    const selected = getSelectedSystem();
    if (!selected) return;
    if (!window.confirm(`确认删除“${selected.name}”？`)) return;

    try {
      const result = await api(`/api/systems/${encodeURIComponent(selected.id)}`, {
        method: 'DELETE',
        body: '{}'
      });
      state.config = result.config;
      state.selectedId = null;
      state.saveDialogOpen = false;
      setUploadNotice('');
      setNotice('入口已删除，前台刷新后生效。', '');
      resetDraft(null);
      renderAdmin();
    } catch (error) {
      setNotice('', error.message);
      renderAdmin();
    }
  }

  async function deleteImage() {
    syncDraftFromForm();
    const currentPath = currentValues().image;
    if (!currentPath) return;

    try {
      await api('/api/upload', {
        method: 'DELETE',
        body: JSON.stringify({ path: currentPath })
      });
      state.draft.image = '';
      setUploadNotice('图片已删除');
      renderAdmin();
    } catch (error) {
      setUploadNotice(error.message);
      renderAdmin();
    }
  }

  async function moveSystem(direction) {
    if (!state.config || state.query.trim()) return;
    const index = selectedSystemIndex();
    if (index === -1) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= state.config.systems.length) return;

    const systems = state.config.systems.slice();
    const [moved] = systems.splice(index, 1);
    systems.splice(nextIndex, 0, moved);

    try {
      const result = await api('/api/config', {
        method: 'PUT',
        body: JSON.stringify({ systems })
      });
      state.config = result.config;
      state.selectedId = moved.id;
      resetDraft(getSelectedSystem());
      setNotice('显示顺序已更新。', '');
      renderAdmin();
    } catch (error) {
      setNotice('', error.message);
      renderAdmin();
    }
  }

  async function init() {
    try {
      const session = await api('/api/session');
      if (!session.authenticated) {
        renderLogin();
        return;
      }
      await loadConfig();
    } catch (error) {
      setNotice('', error.message);
      renderLogin();
    }
  }

  init();
})();
