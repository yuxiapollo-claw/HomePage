const http = require('node:http');
const { createReadStream } = require('node:fs');
const { access, copyFile, mkdir, readFile, rename, stat, writeFile } = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const SESSION_COOKIE = 'portal_admin_session';
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

function staticCacheControl(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const extension = path.extname(filePath).toLowerCase();

  if (normalized.endsWith('/assets/config.json')) {
    return 'no-store';
  }
  if (extension === '.html') {
    return 'no-cache';
  }
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico'].includes(extension)) {
    return 'public, max-age=31536000, immutable';
  }
  if (['.js', '.css'].includes(extension)) {
    return 'public, max-age=86400';
  }
  return 'no-cache';
}

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

function normalizeSystem(input, existingId) {
  const name = String(input.name || '').trim();
  const description = String(input.description || '').trim();
  const category = String(input.category || '').trim();
  const icon = String(input.icon || '').trim() || 'layout-dashboard';
  const status = String(input.status || '').trim() || '待配置';

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

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    textResponse(response, 404, 'Not found');
    return;
  }
  if (!fileStat.isFile()) {
    textResponse(response, 404, 'Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'content-length': String(fileStat.size),
    'cache-control': staticCacheControl(filePath)
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
      if (url.pathname === '/api/session' && request.method === 'GET') {
        jsonResponse(response, 200, { authenticated: isAuthenticated(request, sessions) });
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
        jsonResponse(response, 200, await readConfig(configPath));
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
        jsonResponse(response, 200, { config });
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
        await writeConfig(rootDir, configPath, config);
        jsonResponse(response, 201, { system, config });
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
        const system = normalizeSystem(body, id);
        config.systems[index] = system;
        await writeConfig(rootDir, configPath, config);
        jsonResponse(response, 200, { system, config });
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
        jsonResponse(response, 200, { removed: id, config });
        return;
      }

      if (url.pathname.startsWith('/api/')) {
        jsonResponse(response, 404, { error: 'API route not found' });
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
