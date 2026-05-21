(function () {
  const root = document.getElementById('user-settings-root');
  const state = {
    data: null,
    error: '',
    message: ''
  };

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['content-type']) {
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

  function renderLogin() {
    root.innerHTML = `
      <section class="admin-login-shell">
        <div class="admin-login-card">
          <a class="brand" href="index.html" aria-label="返回门户首页">
            <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
            <span>
              <strong>系统服务导航门户</strong>
              <small>个人凭据设置</small>
            </span>
          </a>
          <div class="section-heading">
            <span class="eyebrow">User sign in</span>
            <h1>用户登录</h1>
            <p>登录后维护你在各业务系统中的个人账号和密码。</p>
          </div>
          ${state.error ? `<p class="admin-alert is-error">${escapeHtml(state.error)}</p>` : ''}
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
          <a class="admin-back-link" href="index.html">返回系统入口</a>
        </div>
      </section>
    `;
    root.querySelector('[data-user-login-form]')?.addEventListener('submit', login);
  }

  function renderSettings() {
    const systems = state.data?.systems || [];
    const user = state.data?.user || {};
    root.innerHTML = `
      <header class="top-nav">
        <a class="brand" href="index.html" aria-label="返回门户首页">
          <img src="assets/logo.jpg" alt="中国医学科学院医学生物学研究所标识">
          <span>
            <strong>个人凭据设置</strong>
            <small>${escapeHtml(user.displayName || user.username || '')}</small>
          </span>
        </a>
        <nav class="nav-actions" aria-label="个人设置操作">
          <a class="button button-secondary" href="index.html">返回入口</a>
          <button class="button button-primary" type="button" data-user-logout>退出登录</button>
        </nav>
      </header>

      <section class="systems-section user-settings-section">
        <div class="section-heading">
          <span class="eyebrow">Credential settings</span>
          <h1>系统账号密码</h1>
          <p>这里保存的是你个人在各业务系统里的账号密码，不会修改系统入口清单。</p>
        </div>
        ${state.message ? `<p class="admin-alert">${escapeHtml(state.message)}</p>` : ''}
        ${state.error ? `<p class="admin-alert is-error">${escapeHtml(state.error)}</p>` : ''}
        <div class="user-credential-list">
          ${systems.map((system) => {
            const credential = system.credential || {};
            return `
              <article class="user-credential-card">
                <div>
                  <span class="eyebrow">${escapeHtml(system.category || '')}</span>
                  <h2>${escapeHtml(system.name)}</h2>
                  <p>${escapeHtml(system.description)}</p>
                </div>
                <form class="user-credential-form" data-system-id="${escapeHtml(system.id)}">
                  <label>
                    <span>系统账号</span>
                    <input name="systemUsername" type="text" value="${escapeHtml(credential.username || '')}" autocomplete="off">
                  </label>
                  <label>
                    <span>系统密码</span>
                    <div class="credential-password-field">
                      <input name="systemPassword" type="password" placeholder="${credential.hasPassword ? '已保存，留空则保持不变' : '未保存'}" autocomplete="new-password" data-password-input>
                      <button class="button button-secondary credential-password-toggle" type="button" data-toggle-password="${escapeHtml(system.id)}" ${credential.hasPassword ? '' : 'disabled'}>${credential.hasPassword ? '显示' : '未保存'}</button>
                    </div>
                  </label>
                  <div class="admin-form-actions">
                    <button class="button button-primary" type="submit" data-save-credential>保存</button>
                    <button class="button button-secondary" type="button" data-clear-credential="${escapeHtml(system.id)}">清除</button>
                  </div>
                </form>
              </article>
            `;
          }).join('')}
        </div>
      </section>
    `;
    bindSettingsEvents();
  }

  function bindSettingsEvents() {
    root.querySelector('[data-user-logout]')?.addEventListener('click', logout);
    root.querySelectorAll('.user-credential-form').forEach((form) => {
      form.addEventListener('submit', saveCredential);
    });
    root.querySelectorAll('[data-clear-credential]').forEach((button) => {
      button.addEventListener('click', clearCredential);
    });
    root.querySelectorAll('[data-toggle-password]').forEach((button) => {
      button.addEventListener('click', toggleCredentialPassword);
    });
  }

  async function login(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/user-login', {
        method: 'POST',
        body: JSON.stringify({
          username: form.get('username'),
          password: form.get('password')
        })
      });
      state.error = '';
      await loadSettings();
    } catch (error) {
      state.error = '用户名或密码不正确';
      renderLogin();
    }
  }

  async function logout() {
    await api('/api/user-logout', { method: 'POST' }).catch(() => {});
    window.location.href = 'index.html';
  }

  async function saveCredential(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await api(`/api/user-credentials/${encodeURIComponent(form.dataset.systemId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: values.get('systemUsername'),
          password: values.get('systemPassword')
        })
      });
      state.message = '个人凭据已保存';
      state.error = '';
      await loadSettings();
    } catch (error) {
      state.error = error.message;
      state.message = '';
      renderSettings();
    }
  }

  async function clearCredential(event) {
    try {
      await api(`/api/user-credentials/${encodeURIComponent(event.currentTarget.dataset.clearCredential)}`, {
        method: 'DELETE'
      });
      state.message = '个人凭据已清除';
      state.error = '';
      await loadSettings();
    } catch (error) {
      state.error = error.message;
      state.message = '';
      renderSettings();
    }
  }

  async function toggleCredentialPassword(event) {
    const button = event.currentTarget;
    const form = button.closest('.user-credential-form');
    const input = form?.querySelector('[data-password-input]');
    const systemId = button.dataset.togglePassword;
    if (!input || !systemId) return;

    if (input.type === 'text') {
      input.type = 'password';
      input.value = '';
      input.placeholder = '已保存，留空则保持不变';
      button.textContent = '显示';
      return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = '读取中';
    try {
      const payload = await api(`/api/credential-copy/${encodeURIComponent(systemId)}/password`);
      input.type = 'text';
      input.value = payload.value || '';
      button.textContent = '隐藏';
    } catch (error) {
      state.error = '密码读取失败，请确认该系统已保存密码。';
      state.message = '';
      renderSettings();
    } finally {
      if (document.body.contains(button)) {
        button.disabled = false;
        if (button.textContent === '读取中') button.textContent = originalText;
      }
    }
  }

  async function loadSettings() {
    try {
      state.data = await api('/api/user-credentials');
      renderSettings();
    } catch (error) {
      renderLogin();
    }
  }

  async function init() {
    const session = await api('/api/user-session').catch(() => ({ authenticated: false }));
    if (!session.authenticated) {
      renderLogin();
      return;
    }
    await loadSettings();
  }

  init();
})();
