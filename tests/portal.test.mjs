import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, readFile, rm, mkdir, copyFile, writeFile } from 'node:fs/promises';
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
  assert.match(styles, /\.system-card-media\s*{[^}]*min-height:\s*78px/s);
  assert.match(styles, /\.hero-section\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.25fr\)\s+minmax\(240px,\s*0\.58fr\)/s);
  assert.match(styles, /\.portal-divider\s*{[^}]*height:\s*4px/s);
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

  assert.match(app, /const linkOverlay = disabled/);
  assert.match(app, /<a class="system-card-link"/);
  assert.match(app, /<article class="\$\{cardClass\}/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.doesNotMatch(app, /system-link/);
  assert.match(app, /imageMarkup/);
  assert.match(app, /onerror="this\.closest\('\.system-card-media'\)\?\.remove\(\)"/);
  assert.match(styles, /\.system-card-link\s*{/);
  assert.match(styles, /position:\s*absolute/);
  assert.match(styles, /\.system-card-link\s*{[^}]*z-index:\s*2/s);
  assert.doesNotMatch(styles, /\.system-card-content\s*{[^}]*z-index/s);
  assert.match(styles, /\.credential-actions\s*{[^}]*z-index:\s*3/s);
  assert.doesNotMatch(styles, /\.system-link/);
});

test('credential-profile cards copy the password and open systems directly without a helper modal', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  const styles = await readFile('assets/styles.css', 'utf8');
  const admin = await readFile('assets/admin.js', 'utf8');
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  assert.match(app, /function getSystemHref/);
  assert.match(app, /system\.launchHref \|\| system\.url/);
  assert.doesNotMatch(app, /function renderLoginHelper/);
  assert.doesNotMatch(app, /function renderHelperDock/);
  assert.doesNotMatch(app, /helperSystemId/);
  assert.doesNotMatch(app, /helperOpen/);
  assert.doesNotMatch(app, /data-login-helper-system-id/);
  assert.doesNotMatch(app, /data-copy-and-open/);
  assert.doesNotMatch(app, /data-open-system/);
  assert.doesNotMatch(app, /login-helper-panel/);
  assert.doesNotMatch(styles, /login-helper/);
  assert.match(app, /data-direct-launch-system-id/);
  assert.match(app, /target="_blank"/);
  assert.match(app, /rel="noopener noreferrer"/);
  assert.match(app, /function preloadLaunchPasswords/);
  assert.match(app, /credentialCache:\s*new Map\(\)/);
  assert.match(app, /function openDirectLaunchCard/);
  assert.match(app, /function openSystemInNewPage/);
  assert.match(app, /event\.preventDefault\(\)/);
  assert.match(app, /window\.open\(href,\s*'_blank'\)/);
  assert.match(app, /copyCachedLaunchPassword/);
  assert.match(app, /function copyTextWithExecCommand/);
  assert.match(app, /copyTextWithExecCommand\(cachedSecret\)/);
  assert.match(app, /await preloadLaunchPasswords\(\);\s*renderPortal\(\);/);
  assert.doesNotMatch(app, /function launchSystemWithCopiedPassword/);
  assert.doesNotMatch(app, /window\.open\(href,\s*'_blank',\s*'noopener,noreferrer'\)/);
  assert.doesNotMatch(app, /window\.location\.href = href/);
  assert.match(app, /portal-toast/);
  assert.match(app, /data-copy-credential/);
  assert.match(app, /\/api\/credential-copy\/\$\{encodeURIComponent\(systemId\)\}/);
  assert.match(app, /function copyTextToClipboard/);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /document\.execCommand\('copy'\)/);
  assert.match(app, /api\/public-config/);
  assert.match(admin, /name="credentialProfile"/);
  assert.match(admin, /name="launchUsername"/);
  assert.match(admin, /name="launchPassword"/);
  assert.match(nodeServer, /api\/public-config/);
  assert.match(nodeServer, /api\\\/credential-copy/);
  assert.match(nodeServer, /launchMode:\s*existing\.launchMode \|\| 'direct'/);
  assert.match(nodeServer, /proxyMode:\s*existing\.proxyMode \|\| ''/);
  assert.match(nodeServer, /PORTAL_LAUNCH_CREDENTIALS_JSON/);
  assert.match(nodeServer, /function writeLaunchCredentials/);
  assert.match(nodeServer, /const launchMatch = url\.pathname\.match/);
  assert.match(nodeServer, /api\\\/launch/);
  assert.match(nodeServer, /decodeURIComponent\(cookies\[ROOT_PROXY_COOKIE\]\)/);
  assert.match(pythonServer, /path == '\/api\/public-config'/);
  assert.match(pythonServer, /credential_copy_match = re\.match/);
  assert.match(pythonServer, /'launchMode': existing\.get\('launchMode'\) or 'direct'/);
  assert.match(pythonServer, /'proxyMode': existing\.get\('proxyMode'\) or ''/);
  assert.match(pythonServer, /PORTAL_LAUNCH_CREDENTIALS_JSON/);
  assert.match(pythonServer, /def write_launch_credentials/);
  assert.match(pythonServer, /launch_match = re\.match/);
  assert.match(pythonServer, /api\/launch/);
});

test('production python server includes generic login-page autofill proxy adapter', async () => {
  const pythonServer = await readFile('server.py', 'utf8');

  assert.match(pythonServer, /def render_autofill_launch_page/);
  assert.match(pythonServer, /portalAutofill:/);
  assert.match(pythonServer, /def autofill_script/);
  assert.match(pythonServer, /def proxy_system_request/);
  assert.match(pythonServer, /inject_autofill_script/);
  assert.match(pythonServer, /def parse_proxy_request/);
  assert.match(pythonServer, /parse_proxy_request\(self, path\)/);
  assert.match(pythonServer, /ThreadingHTTPServer/);
  assert.match(pythonServer, /render_autofill_launch_page\(system, profile\)/);
  assert.match(pythonServer, /decode_url_component\(cookie\[ROOT_PROXY_COOKIE\]\.value\)/);
  assert.match(pythonServer, /def gzip_decompress/);
  assert.match(pythonServer, /gzip\.GzipFile/);
  assert.match(pythonServer, /drop_content_encoding=should_rewrite/);
  assert.match(pythonServer, /def proxy_error_response/);
  assert.match(pythonServer, /Unable to open system/);
  assert.match(pythonServer, /def proxy_request_value/);
  assert.match(pythonServer, /PortalProxyRequest\(\s*proxy_request_value\(target_url\)/);
  assert.doesNotMatch(pythonServer, /render_ledger_launch_page\(system, login_ledger\(system, profile\)\)/);
});

test('autofill script handles text inputs that represent password fields', async () => {
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  for (const source of [nodeServer, pythonServer]) {
    assert.match(source, /passwordScore/);
    assert.match(source, /pwd\|pass\|password/);
    assert.ok(source.includes('\\\\u5bc6\\\\s*\\\\u7801'));
    assert.match(source, /checkbox|radio|button|submit|reset/);
    assert.match(source, /stableFillCount/);
    assert.match(source, /attempts >= 120/);
    assert.match(source, /passwordScore\([^)]*\) < 9/);
    assert.match(source, /if \(element\.value === value\) return true/);
    assert.match(source, /element\.dataset\.portalAutofillApplied === "1"/);
    assert.match(source, /if \(usernameInput && credentials\.username\) usernameChanged = setValue/);
    assert.match(source, /org\|company\|corp\|tenant/);
    assert.match(source, /userScore\(input\) < 9/);
    assert.match(source, /new Event\("blur"/);
    assert.match(source, /credentials\.extraFields/);
    assert.match(source, /fillExtraFields/);
    assert.match(source, /selectOptionByValueOrText/);
  }
});

test('proxy html rewriting handles unquoted root-relative asset attributes', async () => {
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  assert.match(nodeServer, /src\|href\|action/);
  assert.match(nodeServer, /quote \|\| ''/);
  assert.match(pythonServer, /src\|href\|action/);
  assert.match(pythonServer, /\\b\(src\|href\|action\)=/);
  assert.match(pythonServer, /quote = match\.group\(2\) or ''/);
});

test('native-path proxy mode preserves target pathname for route-sensitive systems', async () => {
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  for (const source of [nodeServer, pythonServer]) {
    assert.match(source, /native-path/);
    assert.match(source, /portal_root_proxy/);
    assert.match(source, /parseRootProxyCookie|parse_root_proxy_cookie/);
    assert.match(source, /filterProxyCookieHeader|filter_proxy_cookie_header/);
    assert.match(source, /referer|Referer/);
  }
});

test('proxy autofill adapter bridges LCAP login success into the default dashboard route', async () => {
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  for (const source of [nodeServer, pythonServer]) {
    assert.match(source, /installLcapLoginBridge|install_lcap_login_bridge/);
    assert.match(source, /lcplogics\/getDeptNameByUserName/);
    assert.match(source, /window\.\$global\.userInfo/);
    assert.match(source, /UserId/);
    assert.match(source, /\/dashboard\/applicationCenter/);
  }
});

test('admin page exposes card configuration fields, upload control, reorder actions, centered save dialog, and aligned preview layout', async () => {
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
  assert.match(admin, /function moveSystem/);
  assert.match(admin, /<select name="status"/);
  assert.match(admin, /data-close-dialog/);
  assert.match(admin, /class="admin-modal/);
  assert.doesNotMatch(admin, /window\.alert\(/);
  assert.doesNotMatch(admin, /theme-chip/);
  assert.match(admin, /data-move-up/);
  assert.match(admin, /data-move-down/);
  assert.match(admin, /await api\('\/api\/upload',\s*{\s*method:\s*'DELETE'/s);
  assert.match(admin, /await api\('\/api\/config',\s*{\s*method:\s*'PUT'/s);
  assert.match(admin, /state\.draft\s*=/);
  assert.match(admin, /system-card-content[\s\S]*system-card-media/s);
  assert.match(pythonServer, /path == '\/api\/upload' and self\.command == 'DELETE'/);
  assert.match(pythonServer, /path == '\/api\/config' and self\.command == 'PUT'/);
  assert.match(pythonServer, /def decode_url_component/);
  assert.match(pythonServer, /system_id = decode_url_component\(match\.group\(1\)\)/);
  assert.match(styles, /\.admin-shell/);
  assert.match(styles, /\.admin-form/);
  assert.match(styles, /\.admin-upload/);
  assert.match(styles, /\.admin-modal/);
  assert.match(styles, /\.admin-order-actions/);
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

test('launch route renders an autofill proxy launcher from server-side credential profiles', async () => {
  const { createServer } = await import('../server.js');
  const tempRoot = await mkdtemp(join(tmpdir(), 'portal-launch-'));
  await mkdir(join(tempRoot, 'assets'), { recursive: true });
  const config = JSON.parse(await readFile('assets/config.json', 'utf8'));
  config.systems = [
    {
      id: 'oa-test',
      name: 'OA Test',
      description: 'Launch test card',
      category: 'common',
      icon: 'layout-dashboard',
      image: '',
      tags: ['test'],
      status: 'available',
      url: '#',
      credentialProfile: 'oa-test-profile'
    },
    {
      id: 'plain-test',
      name: 'Plain Test',
      description: 'Plain redirect card',
      category: 'common',
      icon: 'layout-dashboard',
      image: '',
      tags: ['test'],
      status: 'available',
      url: 'https://example.test/app'
    }
  ];
  await writeFile(join(tempRoot, 'assets/config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const app = createServer({
    rootDir: tempRoot,
    launchCredentials: {
      'oa-test-profile': {
        username: 'demo-user',
        password: 'demo-pass',
        loginUrl: 'https://example.test/login',
        fields: {
          username: 'user_code',
          password: 'user_pass'
        },
        extraFields: {
          tenant: 'qa'
        }
      }
    }
  });

  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  try {
    const launch = await fetch(`${baseUrl}/api/launch/oa-test`);
    assert.equal(launch.status, 200);
    assert.match(launch.headers.get('content-type'), /text\/html/);
    const html = await launch.text();
    assert.match(html, /sessionStorage\.setItem\("portalAutofill:oa-test"/);
    assert.match(html, /window\.location\.replace\('\/proxy\/oa-test\/login'\)/);
    assert.match(html, /demo-user/);
    assert.match(html, /demo-pass/);
    assert.match(html, /extraFields/);
    assert.match(html, /tenant/);
    assert.doesNotMatch(html, /launch-form|user_code|user_pass/);

    const savedConfig = await readFile(join(tempRoot, 'assets/config.json'), 'utf8');
    assert.doesNotMatch(savedConfig, /demo-user|demo-pass/);

    const redirect = await fetch(`${baseUrl}/api/launch/plain-test`, { redirect: 'manual' });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), 'https://example.test/app');

    const missingSystem = await fetch(`${baseUrl}/api/launch/unknown-system`);
    assert.equal(missingSystem.status, 404);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('static app assets are served without browser caching', async () => {
  const nodeServer = await readFile('server.js', 'utf8');
  const pythonServer = await readFile('server.py', 'utf8');

  assert.match(nodeServer, /async function serveStatic/);
  assert.match(nodeServer, /'cache-control': 'no-store'/);
  assert.match(pythonServer, /def serve_static/);
  assert.match(pythonServer, /self\.send_header\('Cache-Control', 'no-store'\)/);
});

test('admin backend stores launch credentials outside the public config', async () => {
  const { createServer } = await import('../server.js');
  const tempRoot = await mkdtemp(join(tmpdir(), 'portal-launch-admin-'));
  await mkdir(join(tempRoot, 'assets'), { recursive: true });
  await copyFile('assets/config.json', join(tempRoot, 'assets/config.json'));
  const launchCredentialsPath = join(tempRoot, 'secure', 'launch-credentials.json');

  const app = createServer({
    rootDir: tempRoot,
    adminPassword: 'correct-password',
    sessionSecret: 'test-session-secret',
    launchCredentialsPath
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

    const create = await fetch(`${baseUrl}/api/systems`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        name: 'Credential Launch System',
        description: 'Stores launch credentials outside public config',
        category: 'common',
        icon: 'database',
        image: '',
        tags: ['launch'],
        status: 'available',
        url: 'https://example.test/login',
        launchUsername: 'launch-user',
        launchPassword: 'launch-secret'
      })
    });
    assert.equal(create.status, 201);
    const created = await create.json();
    assert.ok(created.system.credentialProfile);
    assert.equal(created.system.launchUsername, 'launch-user');
    assert.equal(created.system.launchPassword, undefined);
    assert.equal(created.system.hasLaunchPassword, true);

    const publicConfig = await readFile(join(tempRoot, 'assets/config.json'), 'utf8');
    assert.match(publicConfig, /credentialProfile/);
    assert.doesNotMatch(publicConfig, /launch-user|launch-secret/);

    const credentials = JSON.parse(await readFile(launchCredentialsPath, 'utf8'));
    const profile = credentials[created.system.credentialProfile];
    assert.equal(profile.username, 'launch-user');
    assert.equal(profile.password, 'launch-secret');
    assert.deepEqual(profile.fields, { username: 'username', password: 'password' });

    const adminConfigResponse = await fetch(`${baseUrl}/api/config`, { headers: { cookie } });
    const adminConfig = await adminConfigResponse.json();
    const adminSystem = adminConfig.systems.find((system) => system.id === created.system.id);
    assert.equal(adminSystem.launchUsername, 'launch-user');
    assert.equal(adminSystem.launchPassword, undefined);
    assert.equal(adminSystem.hasLaunchPassword, true);

    const launch = await fetch(`${baseUrl}/api/launch/${created.system.id}`);
    const html = await launch.text();
    assert.match(html, /sessionStorage\.setItem\("portalAutofill:credential-launch-system"/);
    assert.match(html, /window\.location\.replace\('\/proxy\/credential-launch-system\/login'\)/);
    assert.match(html, /launch-user/);
    assert.match(html, /launch-secret/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('credential launch opens the proxied login page and autofills saved credentials without submitting', async () => {
  const { createServer } = await import('../server.js');
  const tempRoot = await mkdtemp(join(tmpdir(), 'portal-autofill-launch-'));
  await mkdir(join(tempRoot, 'assets'), { recursive: true });
  const config = JSON.parse(await readFile('assets/config.json', 'utf8'));
  let loginRequests = 0;

  const target = http.createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/login.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><form><input name="username"><input type="password" name="password"></form><script src="/assets/js/app.js"></script></body></html>');
      return;
    }
    if (request.method === 'GET' && request.url === '/compressed-login.html') {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-encoding': 'gzip'
      });
      response.end(gzipSync('<!doctype html><html><body><form><input name="username"><input type="password" name="password"></form></body></html>'));
      return;
    }
    if (request.method === 'GET' && request.url === '/assets/js/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('window.__TARGET_APP__ = true;');
      return;
    }
    if (request.method === 'GET' && request.url === '/static/js/app.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      response.end('window.__TARGET_ROOT_APP__ = true;');
      return;
    }
    if (request.method === 'GET' && request.url === '/compressed.cssgz') {
      if (request.headers.referer !== `${targetOrigin}/`) {
        response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('missing target referer');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/css',
        'content-encoding': 'gzip'
      });
      response.end(gzipSync('body { color: #123456; }'));
      return;
    }
    if (request.method === 'GET' && request.url === '/status-as-html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('{"ok":true,"message":"json response mislabeled as html"}');
      return;
    }
    if (request.method === 'POST' && request.url === '/login') {
      loginRequests += 1;
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ code: 500, msg: 'launch should not submit login' }));
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  await new Promise((resolve) => target.listen(0, '127.0.0.1', resolve));
  const targetOrigin = `http://127.0.0.1:${target.address().port}`;

  config.systems = [{
    id: 'generic',
    name: 'Generic',
    description: 'Generic login app',
    category: 'common',
    icon: 'database',
    image: '',
    tags: ['generic'],
    status: 'available',
    url: `${targetOrigin}/login.html`,
    credentialProfile: 'generic-profile'
  }];
  await writeFile(join(tempRoot, 'assets/config.json'), `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  const app = createServer({
    rootDir: tempRoot,
    launchCredentials: {
      'generic-profile': {
        username: 'launch-user',
        password: 'launch-secret',
        loginUrl: `${targetOrigin}/login.html`,
        fields: { username: 'username', password: 'password' },
        extraFields: { company: '中国医学科学院医学生物学研究所' }
      }
    }
  });
  await new Promise((resolve) => app.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${app.address().port}`;

  try {
    const launch = await fetch(`${baseUrl}/api/launch/generic`);
    assert.equal(launch.status, 200);
    const html = await launch.text();
    assert.match(html, /sessionStorage\.setItem\("portalAutofill:generic"/);
    assert.match(html, /window\.location\.replace\('\/proxy\/generic\/login\.html'\)/);
    assert.match(html, /launch-user/);
    assert.match(html, /launch-secret/);
    assert.match(html, /extraFields/);
    assert.match(html, /中国医学科学院医学生物学研究所/);
    assert.doesNotMatch(html, /localStorage\["authToken"\]\s*=|doLogin/);
    assert.equal(loginRequests, 0);

    const proxyRoot = await fetch(`${baseUrl}/proxy/generic/login.html`);
    assert.equal(proxyRoot.status, 200);
    assert.equal(proxyRoot.headers.get('cache-control'), 'no-store');
    const proxyHtml = await proxyRoot.text();
    assert.match(proxyHtml, /<form>/);
    assert.match(proxyHtml, /portalFillLogin/);
    assert.match(proxyHtml, /sessionStorage\.getItem\(storageKey\)/);
    assert.match(proxyHtml, /const storageKey = "portalAutofill:generic"/);
    assert.doesNotMatch(proxyHtml, /launch-secret/);

    const proxyAsset = await fetch(`${baseUrl}/proxy/generic/assets/js/app.js`);
    assert.equal(proxyAsset.status, 200);
    assert.match(await proxyAsset.text(), /__TARGET_APP__/);

    const proxyRootAsset = await fetch(`${baseUrl}/static/js/app.js`, {
      headers: { referer: `${baseUrl}/proxy/generic/login.html` }
    });
    assert.equal(proxyRootAsset.status, 200);
    assert.match(await proxyRootAsset.text(), /__TARGET_ROOT_APP__/);

    const mislabeledJson = await fetch(`${baseUrl}/proxy/generic/status-as-html`);
    assert.equal(mislabeledJson.status, 200);
    const mislabeledJsonText = await mislabeledJson.text();
    assert.equal(mislabeledJsonText, '{"ok":true,"message":"json response mislabeled as html"}');
    assert.doesNotMatch(mislabeledJsonText, /portalFillLogin/);

    const compressedCss = await fetch(`${baseUrl}/proxy/generic/compressed.cssgz`);
    assert.equal(compressedCss.status, 200);
    assert.equal(await compressedCss.text(), 'body { color: #123456; }');

    const compressedLogin = await fetch(`${baseUrl}/proxy/generic/compressed-login.html`);
    assert.equal(compressedLogin.status, 200);
    assert.equal(compressedLogin.headers.get('content-encoding'), null);
    const compressedLoginHtml = await compressedLogin.text();
    assert.match(compressedLoginHtml, /<form>/);
    assert.match(compressedLoginHtml, /portalFillLogin/);
  } finally {
    await new Promise((resolve) => app.close(resolve));
    await new Promise((resolve) => target.close(resolve));
    await rm(tempRoot, { recursive: true, force: true });
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

    const reorderedSystems = savedAfterUpdate.systems.slice().reverse();
    const reorder = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ systems: reorderedSystems })
    });
    assert.equal(reorder.status, 200);

    const savedAfterReorder = JSON.parse(await readFile(join(tempRoot, 'assets/config.json'), 'utf8'));
    assert.equal(savedAfterReorder.systems[0].id, reorderedSystems[0].id);

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
