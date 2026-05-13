import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const files = [
  'index.html',
  'starbucks.html',
  'assets/config.json',
  'assets/app.js',
  'assets/admin.js',
  'assets/styles.css',
  'assets/logo.jpg',
  'admin.html',
  'server.py',
  'server.js',
  'DEPLOY.md'
];

test('static portal files exist', () => {
  for (const file of files) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }
});

test('config contains organization, categories, and placeholder systems', async () => {
  const config = JSON.parse(await readFile('assets/config.json', 'utf8'));
  assert.ok(config.organization.portalName);
  assert.ok(Array.isArray(config.categories));
  assert.ok(config.categories.length >= 4);
  assert.ok(Array.isArray(config.systems));
  assert.ok(config.systems.length >= 8);
  assert.ok(config.systems.every((system) => system.id && system.name && system.category && system.url));
});

test('both theme pages mount the shared portal renderer', async () => {
  const mintlify = await readFile('index.html', 'utf8');
  const starbucks = await readFile('starbucks.html', 'utf8');
  assert.match(mintlify, /data-theme="mintlify"/);
  assert.match(starbucks, /data-theme="starbucks"/);
  assert.match(mintlify, /id="portal-root"/);
  assert.match(starbucks, /id="portal-root"/);
  assert.match(mintlify, /assets\/app\.js/);
  assert.match(starbucks, /assets\/app\.js/);
});

test('package and deployment docs describe the authenticated node server', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const deploy = await readFile('DEPLOY.md', 'utf8');

  assert.equal(pkg.scripts.start, 'node server.js');
  assert.match(deploy, /server\.js/);
  assert.match(deploy, /server\.py/);
  assert.match(deploy, /ADMIN_PASSWORD/);
  assert.match(deploy, /\/api\/login/);
});

test('client app implements search, category filters, and empty state hooks', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  assert.match(app, /function renderSystems/);
  assert.match(app, /function filterSystems/);
  assert.match(app, /function renderCategories/);
  assert.match(app, /empty-state/);
});

test('public portal links to admin page and uses a compact five-column card wall on desktop', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  const styles = await readFile('assets/styles.css', 'utf8');

  assert.match(app, /href="admin\.html"/);
  assert.match(app, /system\.image/);
  assert.match(app, /system-card-layout/);
  assert.match(app, /system-card-image/);
  assert.match(app, /portal-divider-line"><\/div>\s*<div class="portal-divider-line"/);
  assert.doesNotMatch(app, /theme-chip/);
  assert.doesNotMatch(app, /section-heading/);
  assert.match(styles, /\.system-card-image/);
  assert.match(styles, /\.system-grid\s*{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(styles, /\.system-card-layout/);
  assert.match(styles, /\.system-card-layout\s*{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(styles, /\.system-card-media\s*{[^}]*min-height:\s*112px/s);
  assert.match(styles, /\.hero-section\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.2fr\)\s+minmax\(280px,\s*0\.68fr\)/s);
  assert.match(styles, /aspect-ratio:\s*16 \/ 9/);
});

test('main portal nav hides the Starbucks theme switch entry', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  assert.doesNotMatch(app, /href="starbucks\.html"/);
  assert.doesNotMatch(app, /Starbucks\s+版本/);
});

test('hero metrics derive from live config counts instead of hardcoded values', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  assert.match(app, /state\.config\.systems\.length/);
  assert.match(app, /state\.config\.categories\.filter\(\(item\)\s*=>\s*item\.id\s*!==\s*['"]all['"]\)\.length/);
  assert.doesNotMatch(app, /state\.config\.metrics\.map/);
});

test('active system cards are whole-card links that open in a new tab', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  const styles = await readFile('assets/styles.css', 'utf8');

  assert.match(app, /const cardTag = disabled \? 'article' : 'a'/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.doesNotMatch(app, /system-link/);
  assert.match(app, /imageMarkup/);
  assert.match(app, /onerror="this\.closest\('\.system-card-media'\)\?\.remove\(\)"/);
  assert.match(styles, /\.system-card-link\s*{/);
  assert.doesNotMatch(styles, /\.system-link/);
});

test('admin page exposes card configuration fields, upload control, delete-image action, centered save dialog, and aligned preview layout', async () => {
  const html = await readFile('admin.html', 'utf8');
  const admin = await readFile('assets/admin.js', 'utf8');
  const styles = await readFile('assets/styles.css', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  assert.match(html, /id="admin-root"/);
  assert.match(html, /assets\/admin\.js/);
  assert.match(admin, /name="name"/);
  assert.match(admin, /name="description"/);
  assert.match(admin, /name="category"/);
  assert.match(admin, /name="icon"/);
  assert.match(admin, /type="file"/);
  assert.match(admin, /data-image-upload/);
  assert.match(admin, /data-delete-image/);
  assert.match(admin, /name="tags"/);
  assert.match(admin, /function renderAdmin/);
  assert.match(admin, /function saveSystem/);
  assert.match(admin, /function deleteSystem/);
  assert.match(admin, /function uploadImage/);
  assert.match(admin, /function deleteImage/);
  assert.match(admin, /<select name="status"/);
  assert.match(admin, /data-close-dialog/);
  assert.match(admin, /class="admin-modal/);
  assert.doesNotMatch(admin, /window\.alert\(/);
  assert.match(admin, /await api\('\/api\/upload',\s*{\s*method:\s*'DELETE'/s);
  assert.match(admin, /state\.draft\s*=/);
  assert.match(admin, /system-card-content[\s\S]*system-card-media/s);
  assert.match(pythonServer, /path == '\/api\/upload' and self\.command == 'DELETE'/);
  assert.match(pythonServer, /def decode_url_component/);
  assert.match(pythonServer, /system_id = decode_url_component\(match\.group\(1\)\)/);
  assert.match(styles, /\.admin-shell/);
  assert.match(styles, /\.admin-form/);
  assert.match(styles, /\.admin-upload/);
  assert.match(styles, /\.admin-modal/);
});

test('portal separates hero and system catalog with a divider band', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  const styles = await readFile('assets/styles.css', 'utf8');
  assert.match(app, /portal-divider/);
  assert.match(styles, /\.portal-divider/);
  assert.match(styles, /--divider-bg/);
});

test('hero section has a bottom divider line', async () => {
  const styles = await readFile('assets/styles.css', 'utf8');
  assert.match(styles, /\.hero-section\s*{[^}]*border-bottom:\s*1px solid var\(--hero-bottom-border/s);
  assert.match(styles, /--hero-bottom-border/);
});

test('system catalog section has a visible top divider line', async () => {
  const styles = await readFile('assets/styles.css', 'utf8');
  assert.match(styles, /\.systems-section\s*{[^}]*border-top:\s*1px solid var\(--systems-top-border/s);
  assert.match(styles, /--systems-top-border/);
});

test('project files do not contain deployment credentials', async () => {
  const checkedFiles = [
    'index.html',
    'starbucks.html',
    'assets/config.json',
    'assets/app.js',
    'assets/styles.css',
    'DEPLOY.md'
  ];
  for (const file of checkedFiles) {
    const content = await readFile(file, 'utf8');
    assert.doesNotMatch(content, /icci1239|root\s*密码|password\s*[:=]/i, `${file} should not contain credentials`);
  }
});

test('admin backend requires login, validates payloads, and persists CRUD changes', async () => {
  const { createServer } = await import('../server.js');
  const tempRoot = await mkdtemp(join(tmpdir(), 'portal-admin-'));
  await mkdir(join(tempRoot, 'assets'), { recursive: true });
  await copyFile('assets/config.json', join(tempRoot, 'assets/config.json'));

  const app = createServer({
    rootDir: tempRoot,
    adminPassword: 'correct-password',
    sessionSecret: 'test-session-secret'
  });

  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  try {
    const rejected = await fetch(`${baseUrl}/api/config`);
    assert.equal(rejected.status, 401);

    const badLogin = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    assert.equal(badLogin.status, 401);

    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie');
    assert.match(cookie, /portal_admin_session=/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);

    const invalidCreate = await fetch(`${baseUrl}/api/systems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ name: '' })
    });
    assert.equal(invalidCreate.status, 400);

    const create = await fetch(`${baseUrl}/api/systems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: '测试系统',
        description: '用于验证管理员新增入口',
        category: 'common',
        icon: 'database',
        image: 'assets/logo.jpg',
        tags: ['测试', '后台'],
        status: '可访问',
        url: 'http://example.test'
      })
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.ok(created.system.id);

    const update = await fetch(`${baseUrl}/api/systems/${created.system.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: '测试系统更新',
        description: '用于验证管理员更新入口',
        category: 'data',
        icon: 'chart',
        image: '',
        tags: '更新,后台',
        status: '维护中',
        url: '#'
      })
    });
    assert.equal(update.status, 200);

    const savedAfterUpdate = JSON.parse(await readFile(join(tempRoot, 'assets/config.json'), 'utf8'));
    const updated = savedAfterUpdate.systems.find((system) => system.id === created.system.id);
    assert.equal(updated.name, '测试系统更新');
    assert.deepEqual(updated.tags, ['更新', '后台']);

    const remove = await fetch(`${baseUrl}/api/systems/${created.system.id}`, {
      method: 'DELETE',
      headers: { cookie }
    });
    assert.equal(remove.status, 200);

    const savedAfterDelete = JSON.parse(await readFile(join(tempRoot, 'assets/config.json'), 'utf8'));
    assert.equal(savedAfterDelete.systems.some((system) => system.id === created.system.id), false);
    assert.equal(existsSync(join(tempRoot, 'data/backups')), true);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('admin backend accepts authenticated image uploads into assets/uploads', async () => {
  const { createServer } = await import('../server.js');
  const tempRoot = await mkdtemp(join(tmpdir(), 'portal-upload-'));
  await mkdir(join(tempRoot, 'assets'), { recursive: true });
  await copyFile('assets/config.json', join(tempRoot, 'assets/config.json'));

  const app = createServer({
    rootDir: tempRoot,
    adminPassword: 'correct-password',
    sessionSecret: 'test-session-secret'
  });

  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  try {
    const login = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct-password' })
    });
    const cookie = login.headers.get('set-cookie');

    const form = new FormData();
    form.set('image', new Blob(['fake-image'], { type: 'image/png' }), 'portal-card.png');
    const upload = await fetch(`${baseUrl}/api/upload`, {
      method: 'POST',
      headers: { cookie },
      body: form
    });

    assert.equal(upload.status, 201);
    const payload = await upload.json();
    assert.match(payload.path, /^assets\/uploads\/[a-z0-9-]+\.png$/);
    assert.equal(existsSync(join(tempRoot, payload.path.replace(/\//g, '\\'))), true);

    const remove = await fetch(`${baseUrl}/api/upload`, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ path: payload.path })
    });
    assert.equal(remove.status, 200);
    assert.equal(existsSync(join(tempRoot, payload.path.replace(/\//g, '\\'))), false);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});
