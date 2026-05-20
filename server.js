const http = require('node:http');
const https = require('node:https');
const zlib = require('node:zlib');
const { createReadStream } = require('node:fs');
const { access, copyFile, mkdir, readFile, rename, writeFile } = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SESSION_COOKIE = 'portal_admin_session';
const ROOT_PROXY_COOKIE = 'portal_root_proxy';
const MAX_BODY_BYTES = 1024 * 1024;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function jsonResponse(response, status, payload, headers = {}) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function textResponse(response, status, message) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(message);
}

function htmlResponse(response, status, html) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(html);
}

function proxyErrorResponse(response, status, system, message) {
  const systemName = system && system.name ? system.name : 'System';
  htmlResponse(response, status, `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(systemName)} - Unable to open system</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(520px, calc(100% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 12px; color: #526173; line-height: 1.6; }
    code { display: block; margin: 14px 0; padding: 12px; border: 1px solid #d9e2ef; border-radius: 8px; color: #334155; background: #f8fafc; word-break: break-word; }
    a { color: #0f6f64; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Unable to open system</h1>
    <p>${escapeHtml(systemName)} 暂时无法打开。通常是目标地址、DNS 或服务器到目标系统的网络访问配置问题。</p>
    <code>${escapeHtml(message)}</code>
    <p><a href="/index.html">返回系统入口</a></p>
  </main>
</body>
</html>`);
}

function redirectResponse(response, location) {
  response.writeHead(302, {
    location,
    'cache-control': 'no-store'
  });
  response.end();
}

function getLedgerOrigin(options = {}) {
  return String(options.ledgerOrigin || process.env.PORTAL_LEDGER_ORIGIN || 'http://10.1.18.211').replace(/\/+$/, '');
}

function isLedgerProxyPath(pathname) {
  return pathname === '/ledger'
    || pathname.startsWith('/ledger/')
    || pathname.startsWith('/qhp/')
    || pathname.startsWith('/assets/js/')
    || pathname.startsWith('/assets/css/')
    || pathname.startsWith('/images/');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseCookies(header = '') {
  return header.split(';').reduce((cookies, part) => {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) return cookies;
    cookies[rawName] = decodeURIComponent(rawValue.join('='));
    return cookies;
  }, {});
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8') || '{}';
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function parseMultipart(request) {
  return new Promise((resolve, reject) => {
    const header = request.headers['content-type'] || '';
    const match = header.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!match) {
      reject(new Error('Multipart boundary is required'));
      return;
    }
    const boundary = Buffer.from(`--${match[1] || match[2]}`);
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES * 8) {
        reject(new Error('Upload body is too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const parts = [];
      let start = body.indexOf(boundary);
      while (start !== -1) {
        const next = body.indexOf(boundary, start + boundary.length);
        if (next === -1) break;
        const part = body.subarray(start + boundary.length + 2, next - 2);
        start = next;
        if (!part.length) continue;
        const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
        if (headerEnd === -1) continue;
        const rawHeaders = part.subarray(0, headerEnd).toString('utf8');
        const content = part.subarray(headerEnd + 4);
        const disposition = rawHeaders.match(/name="([^"]+)"/i);
        const filename = rawHeaders.match(/filename="([^"]*)"/i);
        const contentType = rawHeaders.match(/content-type:\s*([^\r\n]+)/i);
        parts.push({
          name: disposition ? disposition[1] : '',
          filename: filename ? filename[1] : '',
          contentType: contentType ? contentType[1].trim() : 'application/octet-stream',
          content
        });
      }
      resolve(parts);
    });
    request.on('error', reject);
  });
}

function safeJoin(rootDir, requestPath) {
  const normalized = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.resolve(rootDir, normalized.replace(/^[/\\]+/, ''));
  const root = path.resolve(rootDir);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return null;
  }
  return resolved;
}

function makeSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `system-${crypto.randomBytes(4).toString('hex')}`;
}

function readRawRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function makeAsciiSlug(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `system-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 8);
  }
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function validateUrl(value, field) {
  const text = String(value || '').trim();
  if (!text) return '#';
  if (text === '#') return text;
  if (field === 'image' && /(^|[\\/])\.\.([\\/]|$)/.test(text)) {
    throw new Error('Image path cannot contain parent-directory traversal');
  }
  if (/^(https?:)?\/\//i.test(text) || /^[a-z0-9_./#?=&%-]+$/i.test(text)) {
    return text;
  }
  throw new Error(`${field} is not a supported URL or relative path`);
}

function normalizeCredentialProfile(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[a-z0-9_.:-]+$/i.test(text)) return text;
  throw new Error('Credential profile can contain only letters, numbers, dot, underscore, colon, or hyphen');
}

function normalizeSystem(input, existingId, existingSystem = {}) {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const category = String(input.category || '').trim();
  const icon = String(input.icon || '').trim() || 'layout-dashboard';
  const status = String(input.status || '').trim() || '待配置';
  const launchUsername = String(input.launchUsername || '').trim();
  const launchPassword = String(input.launchPassword || '');
  const hasLaunchInput = Object.prototype.hasOwnProperty.call(input, 'launchUsername')
    || Object.prototype.hasOwnProperty.call(input, 'launchPassword');
  let credentialProfile = normalizeCredentialProfile(input.credentialProfile || existingSystem.credentialProfile);

  if (hasLaunchInput && !launchUsername && !launchPassword) {
    credentialProfile = '';
  }

  if ((launchUsername || launchPassword) && !credentialProfile) {
    credentialProfile = `system-${existingId || makeAsciiSlug(name)}`;
  }

  if (!name) throw new Error('System name is required');
  if (!description) throw new Error('Description is required');
  if (!category) throw new Error('Category is required');

  return {
    id: existingId || makeSlug(name),
    name,
    description,
    category,
    url: validateUrl(input.url, 'url'),
    status,
    icon,
    image: validateUrl(input.image || '', 'image'),
    credentialProfile,
    tags: normalizeTags(input.tags)
  };
}

async function readConfig(configPath) {
  return JSON.parse(await readFile(configPath, 'utf8'));
}

async function writeConfig(rootDir, configPath, config) {
  const backupDir = path.join(rootDir, 'data', 'backups');
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await copyFile(configPath, path.join(backupDir, `config-${stamp}.json`));
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  await rename(tempPath, configPath);
}

async function storeUpload(rootDir, part) {
  const allowed = new Map([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif']
  ]);
  const extension = allowed.get(part.contentType) || path.extname(part.filename || '').toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) {
    throw new Error('Only jpg, png, webp, and gif images are supported');
  }
  const uploadDir = path.join(rootDir, 'assets', 'uploads');
  await mkdir(uploadDir, { recursive: true });
  const filename = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}${extension === '.jpeg' ? '.jpg' : extension}`;
  await writeFile(path.join(uploadDir, filename), part.content);
  return `assets/uploads/${filename}`;
}

async function deleteUpload(rootDir, uploadPath) {
  const normalized = String(uploadPath || '').trim();
  if (!/^assets\/uploads\/[a-z0-9-]+\.(jpg|jpeg|png|webp|gif)$/i.test(normalized)) {
    throw new Error('Upload path is invalid');
  }
  const target = safeJoin(rootDir, normalized);
  if (!target) {
    throw new Error('Upload path is invalid');
  }
  await access(target);
  const { unlink } = await import('node:fs/promises');
  await unlink(target);
}

function getLaunchCredentialsPath(options = {}) {
  return options.launchCredentialsPath || process.env.PORTAL_LAUNCH_CREDENTIALS_FILE || '/etc/service-portal/launch-credentials.json';
}

async function readLaunchCredentials(options = {}) {
  if (options.launchCredentials) {
    return options.launchCredentials;
  }
  if (process.env.PORTAL_LAUNCH_CREDENTIALS_JSON) {
    return JSON.parse(process.env.PORTAL_LAUNCH_CREDENTIALS_JSON);
  }
  const credentialPath = getLaunchCredentialsPath(options);
  try {
    return JSON.parse(await readFile(credentialPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeLaunchCredentials(options = {}, credentials) {
  if (options.launchCredentials || process.env.PORTAL_LAUNCH_CREDENTIALS_JSON) {
    return;
  }
  const credentialPath = getLaunchCredentialsPath(options);
  await mkdir(path.dirname(credentialPath), { recursive: true });
  const tempPath = `${credentialPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(tempPath, credentialPath);
}

function stripLaunchSecrets(system) {
  const { launchPassword, ...rest } = system;
  return rest;
}

async function attachLaunchMetadata(options, config) {
  const credentials = await readLaunchCredentials(options);
  return {
    ...config,
    systems: config.systems.map((system) => {
      const profile = system.credentialProfile ? credentials[system.credentialProfile] : null;
      return {
        ...system,
        launchUsername: profile ? String(profile.username || '') : '',
        hasLaunchPassword: Boolean(profile && profile.password)
      };
    })
  };
}

async function publicPortalConfig(options, config) {
  const credentials = await readLaunchCredentials(options);
  return {
    ...config,
    systems: config.systems.map((system) => {
      const profile = system.credentialProfile ? credentials[system.credentialProfile] : null;
      const launchMode = profile && profile.launchMode === 'proxy' ? 'proxy' : 'direct';
      const loginUrl = profile && profile.loginUrl ? profile.loginUrl : system.url;
      return {
        ...system,
        launchMode,
        launchHref: launchMode === 'proxy' ? `/api/launch/${encodeURIComponent(system.id)}` : loginUrl,
        hasLaunchUsername: Boolean(profile && profile.username),
        hasLaunchPassword: Boolean(profile && profile.password)
      };
    })
  };
}

async function syncLaunchCredentials(options, system, input) {
  const launchUsername = String(input.launchUsername || '').trim();
  const launchPassword = String(input.launchPassword || '');
  if (!system.credentialProfile || (!launchUsername && !launchPassword)) return;

  const credentials = await readLaunchCredentials(options);
  const existing = credentials[system.credentialProfile] || {};
  credentials[system.credentialProfile] = {
    ...existing,
    username: launchUsername || existing.username || '',
    password: launchPassword || existing.password || '',
    method: existing.method || 'POST',
    loginUrl: existing.loginUrl || system.url,
    launchMode: existing.launchMode || 'direct',
    proxyMode: existing.proxyMode || '',
    fields: existing.fields || {
      username: 'username',
      password: 'password'
    },
    extraFields: existing.extraFields || {}
  };
  await writeLaunchCredentials(options, credentials);
}

async function getCredentialCopyPayload(options, config, systemId, field) {
  if (field !== 'username' && field !== 'password') {
    return null;
  }
  const system = config.systems.find((item) => item.id === systemId);
  if (!system || !system.credentialProfile) return null;
  const credentials = await readLaunchCredentials(options);
  const profile = credentials[system.credentialProfile];
  if (!profile) return null;
  return {
    field,
    value: String(profile[field] || '')
  };
}

function targetOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function isLedgerLaunch(system, profile, options = {}) {
  if (profile.launchMode === 'ledger') return true;
  const ledgerOrigin = getLedgerOrigin(options);
  return targetOrigin(profile.loginUrl || system.url) === ledgerOrigin
    || targetOrigin(system.url) === ledgerOrigin;
}

function requestJson(url, payload) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json',
        'content-length': raw.length
      }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const data = JSON.parse(text);
          if (response.statusCode >= 400) {
            reject(new Error(data.msg || data.error || `HTTP ${response.statusCode}`));
            return;
          }
          resolve(data);
        } catch {
          reject(new Error(`Target login response is not JSON: HTTP ${response.statusCode}`));
        }
      });
    });
    request.on('error', reject);
    request.write(raw);
    request.end();
  });
}

async function loginLedger(system, profile, options = {}) {
  const loginApi = profile.loginApi || `${getLedgerOrigin(options)}/qhp/user/doLogin`;
  const fields = profile.fields || {};
  const usernameField = String(fields.username || 'username').trim();
  const passwordField = String(fields.password || 'password').trim();
  const result = await requestJson(loginApi, {
    [usernameField]: profile.username,
    [passwordField]: profile.password
  });
  if (Number(result.code) !== 200) {
    throw new Error(result.msg || 'Ledger login failed');
  }
  return result;
}

function renderLedgerLaunchPage(system, loginResult) {
  const payload = JSON.stringify(loginResult).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(system.name)} - 正在进入系统</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>正在进入 ${escapeHtml(system.name)}</h1>
    <p>登录凭据已验证，正在打开系统页面。</p>
  </main>
  <script>
    const payload = ${payload};
    const info = payload.data || {};
    localStorage["isLogin"] = true;
    localStorage["trueName"] = info.true_name || "";
    localStorage["authToken"] = info.auth_token || "";
    localStorage["createdAt"] = info.created_at || "";
    localStorage["headPortrait"] = info.head_portrait || "";
    localStorage["roleName"] = info.role_name || "";
    localStorage["roleDesc"] = info.role_desc || "";
    localStorage["menuList"] = JSON.stringify(payload.menuList || []);
    localStorage["userId"] = info.id || 0;
    localStorage["role_id"] = info.role_id || 0;
    localStorage["department_id"] = info.department_id || 0;
    localStorage["username"] = info.name || "";
    document.cookie = "token=" + encodeURIComponent(info.auth_token || "") + "; path=/";
    window.location.replace('/ledger/#/');
  </script>
</body>
</html>`;
}

function renderLedgerAutofillLaunchPage(system, profile) {
  const payload = JSON.stringify({
    username: String(profile.username || ''),
    password: String(profile.password || ''),
    extraFields: profile.extraFields && typeof profile.extraFields === 'object' ? profile.extraFields : {}
  }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(system.name)} - Opening login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Opening ${escapeHtml(system.name)}</h1>
    <p>The saved account and password will be filled on the login page. Please click login manually.</p>
  </main>
  <script>
    const payload = ${payload};
    [
      "isLogin",
      "trueName",
      "authToken",
      "createdAt",
      "headPortrait",
      "roleName",
      "roleDesc",
      "menuList",
      "userId",
      "role_id",
      "department_id",
      "username",
      "navMenu"
    ].forEach((key) => localStorage.removeItem(key));
    document.cookie = "token=; path=/; Max-Age=0";
    sessionStorage.setItem("portalLedgerAutofill", JSON.stringify(payload));
    window.location.replace('/ledger/#/login');
  </script>
</body>
</html>`;
}

function ledgerAutofillScript() {
  return `<script>
(function portalLedgerFillLogin() {
  const storageKey = "portalLedgerAutofill";
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(storageKey);
    return;
  }

  const setValue = (element, value) => {
    if (element.dataset.portalAutofillApplied === "1" && element.value) return true;
    const matched = element.value === value;
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (!matched) {
      if (descriptor && descriptor.set) descriptor.set.call(element, value);
      else element.value = value;
    }
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dispatchEvent(new Event("blur", { bubbles: true }));
    element.dataset.portalAutofillApplied = "1";
    return matched;
  };

  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  };

  const userScore = (element) => {
    const text = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label")
    ].join(" ").toLowerCase();
    if (/user|account|login|name|phone|mobile|email|账号|帐号|用户|用户名|登录名/.test(text)) return 0;
    return 1;
  };

  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter((input) => !input.disabled && !input.readOnly && input.type !== "hidden" && isVisible(input));
    const passwordInput = inputs.find((input) => String(input.type || "").toLowerCase() === "password");
    const usernameInput = inputs
      .filter((input) => String(input.type || "").toLowerCase() !== "password")
      .sort((left, right) => userScore(left) - userScore(right))[0];

    let usernameChanged = false;
    let passwordChanged = false;
    if (usernameInput && credentials.username) usernameChanged = setValue(usernameInput, credentials.username);
    if (passwordInput && credentials.password) passwordChanged = setValue(passwordInput, credentials.password);

    if ((usernameInput || !credentials.username) && (passwordInput || !credentials.password)) {
      window.clearInterval(timer);
      window.setTimeout(() => sessionStorage.removeItem(storageKey), 2000);
    }
    if (attempts >= 30) window.clearInterval(timer);
  }, 300);
})();
</script>`;
}

function injectLedgerAutofillScript(html) {
  const script = ledgerAutofillScript();
  if (html.includes('portalLedgerFillLogin')) return html;
  if (html.includes('</body>')) return html.replace('</body>', `${script}</body>`);
  return `${html}${script}`;
}

function autofillStorageKey(system) {
  return `portalAutofill:${system.id}`;
}

function proxySystemPrefix(system) {
  return `/proxy/${encodeURIComponent(system.id)}`;
}

function getLaunchUrl(system, profile) {
  const launchUrl = validateUrl(profile.loginUrl || system.url, 'loginUrl');
  if (!/^https?:\/\//i.test(launchUrl)) {
    throw new Error('Autofill launch URL must be absolute');
  }
  return new URL(launchUrl);
}

function renderAutofillLaunchPage(system, profile) {
  const target = getLaunchUrl(system, profile);
  const useNativePathProxy = profile.proxyMode === 'native-path';
  const proxyLocation = useNativePathProxy
    ? `${target.pathname || '/'}${target.search}${target.hash}`
    : `${proxySystemPrefix(system)}${target.pathname || '/'}${target.search}${target.hash}`;
  const payload = JSON.stringify({
    username: String(profile.username || ''),
    password: String(profile.password || ''),
    extraFields: profile.extraFields && typeof profile.extraFields === 'object' ? profile.extraFields : {}
  }).replace(/</g, '\\u003c');
  const storageKey = JSON.stringify(autofillStorageKey(system));
  const rootProxyCookie = useNativePathProxy
    ? `document.cookie = "${ROOT_PROXY_COOKIE}=" + encodeURIComponent(${JSON.stringify(system.id)}) + "; path=/; max-age=3600; SameSite=Lax";`
    : `document.cookie = "${ROOT_PROXY_COOKIE}=; path=/; Max-Age=0";`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(system.name)} - Opening login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Opening ${escapeHtml(system.name)}</h1>
    <p>The saved account and password will be filled on the login page. Please click login manually.</p>
  </main>
  <script>
    const payload = ${payload};
    [
      "isLogin",
      "trueName",
      "authToken",
      "createdAt",
      "headPortrait",
      "roleName",
      "roleDesc",
      "menuList",
      "userId",
      "role_id",
      "department_id",
      "username",
      "navMenu"
    ].forEach((key) => localStorage.removeItem(key));
    document.cookie = "token=; path=/; Max-Age=0";
    ${rootProxyCookie}
    sessionStorage.setItem(${storageKey}, JSON.stringify(payload));
    window.location.replace('${proxyLocation}');
  </script>
</body>
</html>`;
}

function autofillScript(system) {
  const storageKey = JSON.stringify(autofillStorageKey(system));
  return `<script>
(function portalFillLogin() {
  const storageKey = ${storageKey};
  const lcapUserInfoKey = storageKey + ":lcapUserInfo";
  const lcapRedirectKey = storageKey + ":lcapRedirected";

  const installLcapLoginBridge = () => {
    if (window.__portalLcapLoginBridgeInstalled) return;
    window.__portalLcapLoginBridgeInstalled = true;
    let lcapResourcesReady = false;

    const parseJson = (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    };

    const resourcePaths = () => {
      const appInfo = window.appInfo || {};
      const seen = {};
      const paths = [];
      (appInfo.authResourcePaths || []).concat(appInfo.baseResourcePaths || []).forEach((path) => {
        const current = String(path || "").trim();
        if (current && !seen[current]) {
          seen[current] = true;
          paths.push(current);
        }
      });
      return paths;
    };

    const lcapResources = () => resourcePaths().map((path) => {
      return {
        resourceType: "ui",
        resourceValue: path,
        ResourceType: "ui",
        ResourceValue: path
      };
    });

    const buildLcapUserInfo = (payload) => {
      const data = (payload && (payload.Data || payload.data)) || payload || {};
      const user = data.lCAPUser || data.LCAPUser || data.user || {};
      const department = data.lCAPDepartment || data.LCAPDepartment || data.department || {};
      const mapping = data.lCAPUserDeptMapping || data.LCAPUserDeptMapping || {};
      const userId = user.userId || user.UserId || user.id || user.ID;
      const userName = user.userName || user.UserName || user.name || user.Name;
      const displayName = user.displayName || user.DisplayName || userName;
      if (!userId && !userName) return null;
      return {
        UserId: userId || userName,
        userId: userId || userName,
        UserName: userName || userId,
        userName: userName || userId,
        DisplayName: displayName,
        displayName,
        DepartmentId: department.deptId || department.DepartmentId || mapping.deptId || "",
        DepartmentName: department.name || department.Name || "",
        status: user.status || user.Status || "",
        source: user.source || user.Source || ""
      };
    };

    const getLcapUserInfo = () => window.__portalLcapUserInfo || parseJson(sessionStorage.getItem(lcapUserInfoKey));

    const applyLcapUserInfo = (info) => {
      if (!info || !info.UserId) return info;
      window.__portalLcapUserInfo = info;
      if (window.$global) window.$global.userInfo = info;
      if (window.appVM && window.appVM.$global) {
        window.appVM.$global.userInfo = info;
        if (window.appVM.$global.frontendVariables) {
          window.appVM.$global.frontendVariables.userInfo = info;
        }
      }
      return info;
    };

    const storeLcapUserInfo = (info) => {
      if (!info || !info.UserId) return;
      sessionStorage.setItem(lcapUserInfoKey, JSON.stringify(info));
      applyLcapUserInfo(info);
    };

    const hasResourcePath = (path) => {
      const normalized = String(path || "");
      const fullPath = normalized.charAt(0) === "/" ? normalized : "/" + normalized;
      return resourcePaths().some((resourcePath) => {
        return resourcePath === fullPath || resourcePath + "/" === fullPath || fullPath.indexOf(resourcePath + "/") === 0;
      });
    };

    const installLcapAuthPatch = () => {
      const auth = window.appVM && window.appVM.$auth;
      if (!auth || auth.__portalLcapPatched) return;
      auth.__portalLcapPatched = true;
      const originalGetUserInfo = auth.getUserInfo && auth.getUserInfo.bind(auth);
      const originalGetUserResources = auth.getUserResources && auth.getUserResources.bind(auth);
      const originalIsInit = auth.isInit && auth.isInit.bind(auth);
      const originalHas = auth.has && auth.has.bind(auth);
      const originalHasFullPath = auth.hasFullPath && auth.hasFullPath.bind(auth);

      auth.getUserInfo = function() {
        const cached = getLcapUserInfo();
        if (cached && cached.UserId) return Promise.resolve(applyLcapUserInfo(cached));
        if (!originalGetUserInfo) return Promise.resolve(cached || {});
        return originalGetUserInfo.apply(auth, arguments).then((info) => {
          if (info && info.UserId) return info;
          const nextCached = getLcapUserInfo();
          return nextCached && nextCached.UserId ? applyLcapUserInfo(nextCached) : info;
        });
      };

      auth.getUserResources = function() {
        const cached = getLcapUserInfo();
        if (cached && cached.UserId) {
          lcapResourcesReady = true;
          return Promise.resolve(lcapResources());
        }
        return originalGetUserResources ? originalGetUserResources.apply(auth, arguments) : Promise.resolve([]);
      };

      auth.isInit = function() {
        return Boolean((originalIsInit && originalIsInit()) || lcapResourcesReady);
      };

      auth.has = function(path) {
        return Boolean((originalHas && originalHas(path)) || (getLcapUserInfo() && hasResourcePath(path)));
      };

      auth.hasFullPath = function(path) {
        return Boolean((originalHasFullPath && originalHasFullPath(path)) || (getLcapUserInfo() && hasResourcePath(path)));
      };
    };

    const redirectAfterLcapLogin = () => {
      const cached = getLcapUserInfo();
      if (!cached || !cached.UserId) return;
      if (!/[/]login[/]?$/.test(window.location.pathname)) return;
      if (sessionStorage.getItem(lcapRedirectKey)) return;
      sessionStorage.setItem(lcapRedirectKey, "1");
      window.setTimeout(() => {
        if (/[/]login[/]?$/.test(window.location.pathname)) {
          window.location.replace("/dashboard/applicationCenter");
        }
      }, 500);
    };

    const handleLcapBridgeResponse = (url, status, responseText) => {
      if (status < 200 || status >= 300) return;
      const textUrl = String(url || "");
      const payload = parseJson(responseText);
      if (textUrl.includes("lcplogics/getDeptNameByUserName") && payload) {
        storeLcapUserInfo(buildLcapUserInfo(payload));
      }
      if (textUrl.includes("/api/login-log") || textUrl.includes("login-log")) {
        redirectAfterLcapLogin();
      }
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
      this.__portalLcapUrl = url;
      return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
      this.addEventListener("loadend", function() {
        handleLcapBridgeResponse(this.__portalLcapUrl, this.status, this.responseText);
      });
      return originalSend.apply(this, arguments);
    };

    const patchTimer = window.setInterval(() => {
      installLcapAuthPatch();
      if (window.appVM && window.appVM.$auth) {
        applyLcapUserInfo(getLcapUserInfo());
      }
    }, 100);
    window.setTimeout(() => window.clearInterval(patchTimer), 30000);
  };

  installLcapLoginBridge();

  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    sessionStorage.removeItem(storageKey);
    return;
  }

  const setValue = (element, value) => {
    if (element.dataset.portalAutofillApplied === "1" && element.value) return true;
    if (element.value === value) return true;
    const prototype = Object.getPrototypeOf(element);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dataset.portalAutofillApplied = "1";
    return false;
  };

  const isVisible = (element) => {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  };

  const fieldText = (element) => {
    return [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.className
    ].join(" ").toLowerCase();
  };

  const fillableType = (element) => {
    return !/^(hidden|checkbox|radio|button|submit|reset|file|image)$/i.test(String(element.type || ""));
  };

  const passwordScore = (element) => {
    const text = fieldText(element);
    if (String(element.type || "").toLowerCase() === "password") return 0;
    if (/pwd|pass|password|\\u5bc6\\s*\\u7801/.test(text)) return 1;
    return 9;
  };

  const userScore = (element) => {
    const text = fieldText(element);
    if (/org|company|corp|tenant|\\u516c\\u53f8|\\u7ec4\\u7ec7|\\u4f01\\u4e1a|\\u6240\\u5c5e/.test(text)) return 9;
    if (/userid|user_id|user-code|usercode|account|login|username|user|name|email|phone|mobile|id|\\u8d26\\u53f7|\\u5e10\\u53f7|\\u7528\\u6237|\\u7528\\u6237\\u540d|\\u767b\\u5f55\\u540d/.test(text)) return 0;
    if (/user|account|login|name|phone|mobile|email|\\u8d26\\u53f7|\\u5e10\\u53f7|\\u7528\\u6237|\\u7528\\u6237\\u540d|\\u767b\\u5f55\\u540d/.test(text)) return 0;
    return 1;
  };

  const findField = (key) => {
    const raw = String(key || "").trim();
    if (!raw) return null;
    const selectors = [];
    if (/^[#.\\[]/.test(raw)) selectors.push(raw);
    selectors.push("#" + CSS.escape(raw));
    selectors.push("[name='" + CSS.escape(raw) + "']");
    for (const selector of selectors) {
      try {
        const found = document.querySelector(selector);
        if (found) return found;
      } catch {}
    }
    const normalized = raw.toLowerCase();
    return Array.from(document.querySelectorAll("input, select, textarea")).find((element) => {
      return [element.id, element.name, element.placeholder, element.getAttribute("aria-label")]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    }) || null;
  };

  const selectOptionByValueOrText = (select, value) => {
    const expected = String(value || "").trim();
    const options = Array.from(select.options || []);
    const option = options.find((item) => item.value === expected || item.text.trim() === expected);
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("blur", { bubbles: true }));
    select.dataset.portalAutofillApplied = "1";
    return select.value === option.value;
  };

  const fillExtraFields = () => {
    const extraFields = credentials.extraFields || {};
    const entries = Object.entries(extraFields).filter((entry) => String(entry[1] || "").trim());
    if (!entries.length) return true;
    return entries.every(([key, value]) => {
      const field = findField(key);
      if (!field || field.disabled || field.readOnly) return false;
      if (String(field.tagName || "").toLowerCase() === "select") {
        return selectOptionByValueOrText(field, value);
      }
      setValue(field, String(value));
      return field.value === String(value);
    });
  };

  let attempts = 0;
  let stableFillCount = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const inputs = Array.from(document.querySelectorAll("input"))
      .filter((input) => !input.disabled && !input.readOnly && fillableType(input) && isVisible(input));
    const passwordInput = inputs
      .slice()
      .sort((left, right) => passwordScore(left) - passwordScore(right))
      .find((input) => passwordScore(input) < 9);
    const usernameInput = inputs
      .filter((input) => input !== passwordInput)
      .sort((left, right) => userScore(left) - userScore(right))
      .find((input) => userScore(input) < 9);

    let usernameChanged = false;
    let passwordChanged = false;
    if (usernameInput && credentials.username) usernameChanged = setValue(usernameInput, credentials.username);
    if (passwordInput && credentials.password) passwordChanged = setValue(passwordInput, credentials.password);
    const extraDone = fillExtraFields();

    const usernameDone = !credentials.username || (usernameInput && usernameInput.value === credentials.username);
    const passwordDone = !credentials.password || (passwordInput && passwordInput.value === credentials.password);
    stableFillCount = usernameDone && passwordDone && extraDone ? stableFillCount + 1 : 0;

    if (stableFillCount >= 5) {
      window.clearInterval(timer);
      window.setTimeout(() => sessionStorage.removeItem(storageKey), 2000);
    }
    if (attempts >= 120) window.clearInterval(timer);
  }, 300);
})();
</script>`;
}

function parseProxyPath(pathname) {
  const match = pathname.match(/^\/proxy\/([^/]+)(\/.*)?$/);
  if (!match) return null;
  return {
    systemId: decodeURIComponent(match[1]),
    targetPath: match[2] || '/'
  };
}

function parseProxyReferer(request, pathname) {
  const referer = request.headers.referer || request.headers.referrer;
  if (!referer) return null;
  try {
    const refererUrl = new URL(referer, 'http://localhost');
    const refererProxy = parseProxyPath(refererUrl.pathname);
    if (!refererProxy) return null;
    return {
      systemId: refererProxy.systemId,
      targetPath: pathname || '/'
    };
  } catch {
    return null;
  }
}

function isPortalNativePath(pathname) {
  if (pathname === '/' || /^\/(?:index|admin|starbucks)\.html$/i.test(pathname)) return true;
  if (pathname.startsWith('/assets/') || pathname.startsWith('/docs/')) return true;
  if (pathname === '/api/session'
    || pathname === '/api/login'
    || pathname === '/api/logout'
    || pathname === '/api/config'
    || pathname === '/api/upload'
    || pathname.startsWith('/api/launch/')
    || pathname === '/api/systems'
    || pathname.startsWith('/api/systems/')) {
    return true;
  }
  return false;
}

function parseRootProxyCookie(request, pathname) {
  if (isPortalNativePath(pathname)) return null;
  const cookies = parseCookies(request.headers.cookie);
  const systemId = cookies[ROOT_PROXY_COOKIE] ? decodeURIComponent(cookies[ROOT_PROXY_COOKIE]) : '';
  if (!systemId) return null;
  return {
    systemId,
    targetPath: pathname || '/'
  };
}

function parseProxyRequest(request, pathname) {
  return parseProxyPath(pathname) || parseProxyReferer(request, pathname) || parseRootProxyCookie(request, pathname);
}

function filterProxyCookieHeader(value) {
  const filtered = String(value || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => {
      const name = part.split('=')[0];
      return name !== ROOT_PROXY_COOKIE && name !== SESSION_COOKIE;
    });
  return filtered.join('; ');
}

function rewriteProxyUrl(system, targetOrigin, value) {
  const raw = String(value || '');
  const useNativePathProxy = system && system._nativePathProxy;
  if (!raw || raw.startsWith('#') || /^(data|blob|mailto|tel|javascript):/i.test(raw)) return raw;
  if (raw.startsWith('//')) {
    try {
      const absolute = new URL(`http:${raw}`);
      const origin = new URL(targetOrigin);
      if (absolute.host === origin.host) {
        if (useNativePathProxy) return `${absolute.pathname}${absolute.search}${absolute.hash}`;
        return `${proxySystemPrefix(system)}${absolute.pathname}${absolute.search}${absolute.hash}`;
      }
    } catch {
      return raw;
    }
    return raw;
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const absolute = new URL(raw);
      if (absolute.origin === targetOrigin) {
        if (useNativePathProxy) return `${absolute.pathname}${absolute.search}${absolute.hash}`;
        return `${proxySystemPrefix(system)}${absolute.pathname}${absolute.search}${absolute.hash}`;
      }
    } catch {
      return raw;
    }
    return raw;
  }
  if (raw.startsWith('/')) {
    if (raw.startsWith('/proxy/') || raw.startsWith('/api/launch/')) return raw;
    if (useNativePathProxy) return raw;
    return `${proxySystemPrefix(system)}${raw}`;
  }
  return raw;
}

function rewriteHtmlForProxy(system, targetOrigin, html) {
  const rewritten = html.replace(/\b(src|href|action)=(?:(["'])([^"'\s>]+)\2|([^\s>]+))/gi, (match, name, quote, quotedValue, unquotedValue) => {
    const value = quotedValue || unquotedValue;
    const wrapper = quote || '';
    return `${name}=${wrapper}${rewriteProxyUrl(system, targetOrigin, value)}${wrapper}`;
  });
  const script = autofillScript(system);
  if (rewritten.includes('portalFillLogin')) return rewritten;
  if (rewritten.includes('</body>')) return rewritten.replace('</body>', `${script}</body>`);
  return `${rewritten}${script}`;
}

function looksLikeHtmlDocument(html) {
  const text = String(html || '').trimStart().slice(0, 2048).toLowerCase();
  return text.startsWith('<!doctype html')
    || text.startsWith('<html')
    || /<(head|body|form|input|script|div)\b/.test(text);
}

function rewriteCssForProxy(system, targetOrigin, css) {
  return css.replace(/url\((["']?)([^"')]+)\1\)/gi, (match, quote, value) => {
    return `url(${quote}${rewriteProxyUrl(system, targetOrigin, value)}${quote})`;
  });
}

function rewriteProxyContent(system, targetOrigin, contentType, buffer) {
  const lowerType = String(contentType || '').toLowerCase();
  if (lowerType.includes('text/html')) {
    const html = buffer.toString('utf8');
    if (!looksLikeHtmlDocument(html)) return buffer;
    return Buffer.from(rewriteHtmlForProxy(system, targetOrigin, html), 'utf8');
  }
  if (lowerType.includes('text/css')) {
    return Buffer.from(rewriteCssForProxy(system, targetOrigin, buffer.toString('utf8')), 'utf8');
  }
  return buffer;
}

function shouldDecodeProxyBody(contentType, contentEncoding = '') {
  const lowerType = String(contentType || '').toLowerCase();
  const lowerEncoding = String(contentEncoding || '').toLowerCase();
  return lowerEncoding === 'gzip' && (lowerType.includes('text/html') || lowerType.includes('text/css'));
}

function shouldRewriteProxyBody(contentType, contentEncoding = '') {
  const lowerType = String(contentType || '').toLowerCase();
  const lowerEncoding = String(contentEncoding || '').toLowerCase();
  return (lowerType.includes('text/html') || lowerType.includes('text/css'))
    && (!lowerEncoding || lowerEncoding === 'identity' || lowerEncoding === 'gzip');
}

async function proxySystemRequest(options, configPath, request, response, url, proxyInfo) {
  const config = await readConfig(configPath);
  const system = config.systems.find((item) => item.id === proxyInfo.systemId);
  if (!system) {
    proxyErrorResponse(response, 404, { name: proxyInfo.systemId }, 'System not found');
    return;
  }
  const credentials = await readLaunchCredentials(options);
  const profile = system.credentialProfile ? credentials[system.credentialProfile] || {} : {};
  if (profile.proxyMode === 'native-path') system._nativePathProxy = true;
  let targetBase;
  try {
    targetBase = getLaunchUrl(system, profile);
  } catch (error) {
    proxyErrorResponse(response, 502, system, error.message);
    return;
  }
  const targetOrigin = targetBase.origin;
  const target = new URL(`${proxyInfo.targetPath}${url.search}`, targetOrigin);
  const rawBody = ['GET', 'HEAD'].includes(request.method) ? null : await readRawRequestBody(request);
  const headers = { ...request.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers['accept-encoding'];
  headers.referer = `${targetOrigin}/`;
  if (headers.referrer) headers.referrer = `${targetOrigin}/`;
  if (headers.cookie) {
    const cookie = filterProxyCookieHeader(headers.cookie);
    if (cookie) headers.cookie = cookie;
    else delete headers.cookie;
  }
  headers['accept-encoding'] = 'gzip, identity';
  if (rawBody) headers['content-length'] = rawBody.length;

  const transport = target.protocol === 'https:' ? https : http;
  const proxy = transport.request({
    method: request.method,
    hostname: target.hostname,
    port: target.port || (target.protocol === 'https:' ? 443 : 80),
    path: `${target.pathname}${target.search}`,
    headers
  }, (targetResponse) => {
    const responseHeaders = { ...targetResponse.headers };
    delete responseHeaders['content-length'];
    delete responseHeaders['transfer-encoding'];
    if (responseHeaders.location) {
      responseHeaders.location = rewriteProxyUrl(system, targetOrigin, responseHeaders.location);
    }

    const chunks = [];
    targetResponse.on('data', (chunk) => chunks.push(chunk));
    targetResponse.on('end', () => {
      const contentType = String(targetResponse.headers['content-type'] || '');
      const contentEncoding = String(targetResponse.headers['content-encoding'] || '');
      if (shouldRewriteProxyBody(contentType, contentEncoding)) {
        delete responseHeaders['content-encoding'];
        delete responseHeaders['cache-control'];
        delete responseHeaders.expires;
        delete responseHeaders.pragma;
        responseHeaders['cache-control'] = 'no-store';
      }
      const rawBody = Buffer.concat(chunks);
      const decodedBody = shouldDecodeProxyBody(contentType, contentEncoding) ? zlib.gunzipSync(rawBody) : rawBody;
      const body = request.method === 'HEAD'
        ? Buffer.alloc(0)
        : shouldRewriteProxyBody(contentType, contentEncoding)
          ? rewriteProxyContent(system, targetOrigin, contentType, decodedBody)
          : rawBody;
      responseHeaders['content-length'] = body.length;
      response.writeHead(targetResponse.statusCode || 502, responseHeaders);
      response.end(body);
    });
  });
  proxy.on('error', (error) => {
    proxyErrorResponse(response, 502, system, error.message);
  });
  if (rawBody) proxy.write(rawBody);
  proxy.end();
}

async function proxyLedgerRequest(options, request, response, url) {
  const ledgerOrigin = getLedgerOrigin(options);
  const origin = new URL(ledgerOrigin);
  const proxyPath = url.pathname === '/ledger'
    ? '/'
    : url.pathname.startsWith('/ledger/')
      ? `/${url.pathname.slice('/ledger/'.length)}`
      : url.pathname;
  const rawBody = ['GET', 'HEAD'].includes(request.method) ? null : await readRawRequestBody(request);
  const headers = { ...request.headers };
  delete headers.host;
  delete headers['content-length'];
  delete headers['accept-encoding'];
  headers['accept-encoding'] = 'identity';
  if (rawBody) headers['content-length'] = rawBody.length;

  const transport = origin.protocol === 'https:' ? https : http;
  const proxy = transport.request({
    method: request.method,
    hostname: origin.hostname,
    port: origin.port || (origin.protocol === 'https:' ? 443 : 80),
    path: `${proxyPath}${url.search}`,
    headers
  }, (targetResponse) => {
    const responseHeaders = { ...targetResponse.headers };
    delete responseHeaders['content-encoding'];
    delete responseHeaders['content-length'];
    delete responseHeaders['transfer-encoding'];
    const contentType = String(targetResponse.headers['content-type'] || '');
    if (contentType.includes('text/html') && request.method !== 'HEAD') {
      const chunks = [];
      targetResponse.on('data', (chunk) => chunks.push(chunk));
      targetResponse.on('end', () => {
        const html = injectLedgerAutofillScript(Buffer.concat(chunks).toString('utf8'));
        const body = Buffer.from(html, 'utf8');
        responseHeaders['content-length'] = body.length;
        response.writeHead(targetResponse.statusCode || 502, responseHeaders);
        response.end(body);
      });
      return;
    }
    response.writeHead(targetResponse.statusCode || 502, responseHeaders);
    targetResponse.pipe(response);
  });
  proxy.on('error', (error) => {
    jsonResponse(response, 502, { error: error.message });
  });
  if (rawBody) proxy.write(rawBody);
  proxy.end();
}

function renderLaunchForm(system, profile) {
  const method = String(profile.method || 'POST').toUpperCase();
  if (method !== 'POST') {
    throw new Error('Only POST launch profiles are supported');
  }
  const loginUrl = validateUrl(profile.loginUrl || system.url, 'loginUrl');
  if (!loginUrl || loginUrl === '#') {
    throw new Error('Launch login URL is not configured');
  }
  const fields = profile.fields || {};
  const usernameField = String(fields.username || 'username').trim();
  const passwordField = String(fields.password || 'password').trim();
  if (!usernameField || !passwordField) {
    throw new Error('Launch username and password field names are required');
  }
  const hiddenFields = [
    [usernameField, profile.username],
    [passwordField, profile.password],
    ...Object.entries(profile.extraFields || {})
  ].map(([name, value]) => {
    return `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`;
  }).join('\n        ');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(system.name)} - 正在进入系统</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 18px; color: #526173; line-height: 1.6; }
    button { border: 0; border-radius: 8px; padding: 10px 16px; color: #fff; background: #0f6f64; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>正在进入 ${escapeHtml(system.name)}</h1>
    <p>系统将通过服务器端测试凭据提交登录表单。若未自动跳转，请点击下方按钮。</p>
    <form id="launch-form" method="post" action="${escapeHtml(loginUrl)}">
        ${hiddenFields}
      <button type="submit">进入系统</button>
    </form>
  </main>
  <script>document.getElementById('launch-form').submit();</script>
</body>
</html>`;
}

function isAuthenticated(request, sessions) {
  const cookies = parseCookies(request.headers.cookie);
  const session = cookies[SESSION_COOKIE];
  return Boolean(session && sessions.has(session));
}

function requireAuth(request, response, sessions) {
  if (isAuthenticated(request, sessions)) return true;
  jsonResponse(response, 401, { error: 'Authentication required' });
  return false;
}

async function serveStatic(rootDir, requestPath, response) {
  const pathname = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = safeJoin(rootDir, pathname);
  if (!filePath) {
    textResponse(response, 403, 'Forbidden');
    return;
  }

  try {
    await access(filePath);
  } catch {
    textResponse(response, 404, 'Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  });
  createReadStream(filePath).pipe(response);
}

function createServer(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const configPath = path.join(rootDir, 'assets', 'config.json');
  const adminPassword = options.adminPassword || process.env.ADMIN_PASSWORD || '';
  const sessions = new Map();

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');

    try {
      const proxyInfo = parseProxyRequest(request, url.pathname);
      if (proxyInfo) {
        await proxySystemRequest(options, configPath, request, response, url, proxyInfo);
        return;
      }

      if (url.pathname === '/api/session' && request.method === 'GET') {
        jsonResponse(response, 200, { authenticated: isAuthenticated(request, sessions) });
        return;
      }

      const launchMatch = url.pathname.match(/^\/api\/launch\/([^/]+)$/);
      if (launchMatch && request.method === 'GET') {
        const systemId = decodeURIComponent(launchMatch[1]);
        const config = await readConfig(configPath);
        const system = config.systems.find((item) => item.id === systemId);
        if (!system) {
          jsonResponse(response, 404, { error: 'System not found' });
          return;
        }
        const profileId = String(system.credentialProfile || '').trim();
        if (!profileId) {
          if (!system.url || system.url === '#') {
            jsonResponse(response, 404, { error: 'System launch is not configured' });
            return;
          }
          redirectResponse(response, system.url);
          return;
        }
        const credentials = await readLaunchCredentials(options);
        const profile = credentials[profileId];
        if (!profile) {
          jsonResponse(response, 503, { error: 'Credential profile is not configured' });
          return;
        }
        htmlResponse(response, 200, renderAutofillLaunchPage(system, profile));
        return;
      }

      if (url.pathname === '/api/public-config' && request.method === 'GET') {
        jsonResponse(response, 200, await publicPortalConfig(options, await readConfig(configPath)));
        return;
      }

      const credentialCopyMatch = url.pathname.match(/^\/api\/credential-copy\/([^/]+)\/(username|password)$/);
      if (credentialCopyMatch && request.method === 'GET') {
        const config = await readConfig(configPath);
        const payload = await getCredentialCopyPayload(
          options,
          config,
          decodeURIComponent(credentialCopyMatch[1]),
          decodeURIComponent(credentialCopyMatch[2])
        );
        if (!payload) {
          jsonResponse(response, 404, { error: 'Credential not found' });
          return;
        }
        jsonResponse(response, 200, payload);
        return;
      }

      if (url.pathname === '/api/login' && request.method === 'POST') {
        if (!adminPassword) {
          jsonResponse(response, 503, { error: 'Admin password is not configured' });
          return;
        }
        const body = await readRequestBody(request);
        if (String(body.password || '') !== adminPassword) {
          jsonResponse(response, 401, { error: 'Invalid password' });
          return;
        }
        const sessionId = crypto.randomBytes(32).toString('base64url');
        sessions.set(sessionId, { createdAt: Date.now() });
        jsonResponse(response, 200, { authenticated: true }, {
          'set-cookie': `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Strict`
        });
        return;
      }

      if (url.pathname === '/api/logout' && request.method === 'POST') {
        const cookies = parseCookies(request.headers.cookie);
        if (cookies[SESSION_COOKIE]) sessions.delete(cookies[SESSION_COOKIE]);
        jsonResponse(response, 200, { authenticated: false }, {
          'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict`
        });
        return;
      }

      if (url.pathname === '/api/config' && request.method === 'GET') {
        if (!requireAuth(request, response, sessions)) return;
        jsonResponse(response, 200, await attachLaunchMetadata(options, await readConfig(configPath)));
        return;
      }

      if (url.pathname === '/api/config' && request.method === 'PUT') {
        if (!requireAuth(request, response, sessions)) return;
        const body = await readRequestBody(request);
        const config = await readConfig(configPath);
        if (!Array.isArray(body.systems)) {
          jsonResponse(response, 400, { error: 'Systems array is required' });
          return;
        }
        const existingIds = new Set(config.systems.map((item) => item.id));
        const nextIds = new Set(body.systems.map((item) => item && item.id));
        if (existingIds.size !== nextIds.size || [...existingIds].some((id) => !nextIds.has(id))) {
          jsonResponse(response, 400, { error: 'Systems payload must contain the same ids' });
          return;
        }
        config.systems = body.systems;
        await writeConfig(rootDir, configPath, config);
        jsonResponse(response, 200, { config: await attachLaunchMetadata(options, config) });
        return;
      }

      if (url.pathname === '/api/upload' && request.method === 'POST') {
        if (!requireAuth(request, response, sessions)) return;
        const parts = await parseMultipart(request);
        const image = parts.find((part) => part.name === 'image' && part.filename);
        if (!image) {
          jsonResponse(response, 400, { error: 'Image file is required' });
          return;
        }
        const savedPath = await storeUpload(rootDir, image);
        jsonResponse(response, 201, { path: savedPath });
        return;
      }

      if (url.pathname === '/api/upload' && request.method === 'DELETE') {
        if (!requireAuth(request, response, sessions)) return;
        const body = await readRequestBody(request);
        await deleteUpload(rootDir, body.path);
        jsonResponse(response, 200, { removed: body.path });
        return;
      }

      if (url.pathname === '/api/systems' && request.method === 'POST') {
        if (!requireAuth(request, response, sessions)) return;
        const body = await readRequestBody(request);
        const config = await readConfig(configPath);
        const system = normalizeSystem(body);
        const ids = new Set(config.systems.map((item) => item.id));
        let baseId = system.id;
        let counter = 2;
        while (ids.has(system.id)) {
          system.id = `${baseId}-${counter}`;
          counter += 1;
        }
        config.systems.push(system);
        await syncLaunchCredentials(options, system, body);
        await writeConfig(rootDir, configPath, config);
        const adminConfig = await attachLaunchMetadata(options, config);
        const adminSystem = adminConfig.systems.find((item) => item.id === system.id);
        jsonResponse(response, 201, { system: adminSystem, config: adminConfig });
        return;
      }

      const systemMatch = url.pathname.match(/^\/api\/systems\/([^/]+)$/);
      if (systemMatch && request.method === 'PUT') {
        if (!requireAuth(request, response, sessions)) return;
        const id = decodeURIComponent(systemMatch[1]);
        const body = await readRequestBody(request);
        const config = await readConfig(configPath);
        const index = config.systems.findIndex((item) => item.id === id);
        if (index === -1) {
          jsonResponse(response, 404, { error: 'System not found' });
          return;
        }
        const system = normalizeSystem(body, id, config.systems[index]);
        config.systems[index] = system;
        await syncLaunchCredentials(options, system, body);
        await writeConfig(rootDir, configPath, config);
        const adminConfig = await attachLaunchMetadata(options, config);
        const adminSystem = adminConfig.systems.find((item) => item.id === system.id);
        jsonResponse(response, 200, { system: adminSystem, config: adminConfig });
        return;
      }

      if (systemMatch && request.method === 'DELETE') {
        if (!requireAuth(request, response, sessions)) return;
        const id = decodeURIComponent(systemMatch[1]);
        const config = await readConfig(configPath);
        const nextSystems = config.systems.filter((item) => item.id !== id);
        if (nextSystems.length === config.systems.length) {
          jsonResponse(response, 404, { error: 'System not found' });
          return;
        }
        config.systems = nextSystems;
        await writeConfig(rootDir, configPath, config);
        jsonResponse(response, 200, { removed: id, config: await attachLaunchMetadata(options, config) });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        jsonResponse(response, 404, { error: 'API route not found' });
        return;
      }

      if (isLedgerProxyPath(url.pathname)) {
        await proxyLedgerRequest(options, request, response, url);
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        textResponse(response, 405, 'Method not allowed');
        return;
      }

      await serveStatic(rootDir, url.pathname, response);
    } catch (error) {
      const status = /required|valid|supported|traversal/i.test(error.message) ? 400 : 500;
      jsonResponse(response, status, { error: error.message });
    }
  });
}

exports.createServer = createServer;

if (require.main === module) {
  const port = Number(process.env.PORT || 80);
  createServer().listen(port, '0.0.0.0', () => {
    console.log(`Service portal listening on ${port}`);
  });
}
