#!/usr/bin/env python
# -*- coding: utf-8 -*-
from __future__ import print_function

try:
    import BaseHTTPServer
except ImportError:
    import http.server as BaseHTTPServer
try:
    import SocketServer
except ImportError:
    import socketserver as SocketServer
try:
    import Cookie
except ImportError:
    import http.cookies as Cookie
import cgi
import errno
import hashlib
import json
import mimetypes
import os
import posixpath
import random
import re
import shutil
import tempfile
import time
import gzip
import io
try:
    from urllib import unquote
except ImportError:
    from urllib.parse import unquote
try:
    import urllib2
    import urlparse
except ImportError:
    import urllib.request as urllib2
    import urllib.parse as urlparse

try:
    text_type = unicode
except NameError:
    text_type = str

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(ROOT_DIR, 'assets', 'config.json')
SESSION_COOKIE = 'portal_admin_session'
ROOT_PROXY_COOKIE = 'portal_root_proxy'
MAX_BODY_BYTES = 1024 * 1024
SESSIONS = {}


def ensure_dir(path):
    try:
        os.makedirs(path)
    except OSError as exc:
        if exc.errno != errno.EEXIST:
            raise


def json_response(handler, status, payload, headers=None):
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json; charset=utf-8')
    handler.send_header('Cache-Control', 'no-store')
    if headers:
        for name, value in headers.items():
            handler.send_header(name, value)
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler, status, message):
    body = message.encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'text/plain; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def html_response(handler, status, html):
    body = html.encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'text/html; charset=utf-8')
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Content-Length', str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def proxy_error_response(handler, status, system, message):
    system_name = unicode_or_string(system.get('name') if system else 'System')
    detail = unicode_or_string(message)
    html_response(handler, status, u'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s - Unable to open system</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(520px, calc(100%% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    p { margin: 0 0 12px; color: #526173; line-height: 1.6; }
    code { display: block; margin: 14px 0; padding: 12px; border: 1px solid #d9e2ef; border-radius: 8px; color: #334155; background: #f8fafc; word-break: break-word; }
    a { color: #0f6f64; text-decoration: none; font-weight: 700; }
  </style>
</head>
<body>
  <main>
    <h1>Unable to open system</h1>
    <p>%s 暂时无法打开。通常是目标地址、DNS 或服务器到目标系统的网络访问配置问题。</p>
    <code>%s</code>
    <p><a href="/index.html">返回系统入口</a></p>
  </main>
</body>
</html>''' % (
        escape_html(system_name),
        escape_html(system_name),
        escape_html(detail)
    ))


def redirect_response(handler, location):
    handler.send_response(302)
    handler.send_header('Location', location)
    handler.send_header('Cache-Control', 'no-store')
    handler.end_headers()


def get_ledger_origin():
    return os.environ.get('PORTAL_LEDGER_ORIGIN', 'http://10.1.18.211').rstrip('/')


def target_origin(value):
    try:
        parsed = urlparse.urlparse(unicode_or_string(value))
        if not parsed.scheme or not parsed.netloc:
            return ''
        return '%s://%s' % (parsed.scheme, parsed.netloc)
    except Exception:
        return ''


def is_ledger_proxy_path(pathname):
    return (
        pathname == '/ledger' or
        pathname.startswith('/ledger/') or
        pathname.startswith('/qhp/') or
        pathname.startswith('/assets/js/') or
        pathname.startswith('/assets/css/') or
        pathname.startswith('/images/')
    )


def escape_html(value):
    text = unicode_or_string(value)
    return (
        text.replace('&', '&amp;')
            .replace('<', '&lt;')
            .replace('>', '&gt;')
            .replace('"', '&quot;')
            .replace("'", '&#039;')
    )


def read_body(handler):
    length = int(handler.headers.get('Content-Length') or '0')
    if length > MAX_BODY_BYTES:
        raise ValueError('Request body is too large')
    raw = handler.rfile.read(length) if length else '{}'
    try:
        return json.loads(raw.decode('utf-8'))
    except Exception:
        raise ValueError('Request body must be valid JSON')


def read_upload(handler):
    form = cgi.FieldStorage(
        fp=handler.rfile,
        headers=handler.headers,
        environ={
            'REQUEST_METHOD': 'POST',
            'CONTENT_TYPE': handler.headers.get('Content-Type', '')
        }
    )
    image = form['image'] if 'image' in form else None
    if image is None or not getattr(image, 'filename', None):
        raise ValueError('Image file is required')
    content_type = getattr(image, 'type', '') or 'application/octet-stream'
    extension = os.path.splitext(image.filename)[1].lower()
    allowed = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
        'image/gif': '.gif'
    }
    if content_type in allowed:
        extension = allowed[content_type]
    if extension not in ['.jpg', '.jpeg', '.png', '.webp', '.gif']:
        raise ValueError('Only jpg, png, webp, and gif images are supported')
    return image.file.read(), extension


def read_config():
    with open(CONFIG_PATH, 'rb') as handle:
        return json.loads(handle.read().decode('utf-8'))


def write_config(config):
    backup_dir = os.path.join(ROOT_DIR, 'data', 'backups')
    ensure_dir(backup_dir)
    stamp = time.strftime('%Y%m%d-%H%M%S')
    shutil.copy2(CONFIG_PATH, os.path.join(backup_dir, 'config-%s.json' % stamp))
    fd, temp_path = tempfile.mkstemp(prefix='config-', suffix='.json', dir=os.path.dirname(CONFIG_PATH))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write((json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
        os.rename(temp_path, CONFIG_PATH)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def write_upload(content, extension):
    upload_dir = os.path.join(ROOT_DIR, 'assets', 'uploads')
    ensure_dir(upload_dir)
    filename = '%s-%s%s' % (
        time.strftime('%Y%m%d%H%M%S'),
        hashlib.sha1(os.urandom(16)).hexdigest()[:8],
        '.jpg' if extension == '.jpeg' else extension
    )
    file_path = os.path.join(upload_dir, filename)
    with open(file_path, 'wb') as handle:
        handle.write(content)
    return 'assets/uploads/%s' % filename


def delete_upload(upload_path):
    normalized = unicode_or_string(upload_path).strip()
    if not re.match(r'^assets/uploads/[a-z0-9-]+\.(jpg|jpeg|png|webp|gif)$', normalized, re.I):
        raise ValueError('Upload path is invalid')
    target = os.path.abspath(os.path.join(ROOT_DIR, normalized.replace('/', os.sep)))
    upload_root = os.path.abspath(os.path.join(ROOT_DIR, 'assets', 'uploads'))
    if target != upload_root and not target.startswith(upload_root + os.sep):
        raise ValueError('Upload path is invalid')
    if not os.path.exists(target):
        raise ValueError('Upload path is invalid')
    os.remove(target)


def parse_cookie(header):
    cookie = Cookie.SimpleCookie()
    if header:
      cookie.load(header)
    return cookie


def is_authenticated(handler):
    cookie = parse_cookie(handler.headers.get('Cookie'))
    if SESSION_COOKIE not in cookie:
        return False
    return cookie[SESSION_COOKIE].value in SESSIONS


def require_auth(handler):
    if is_authenticated(handler):
        return True
    json_response(handler, 401, {'error': 'Authentication required'})
    return False


def session_id():
    seed = '%s:%s:%s' % (time.time(), random.random(), os.urandom(32))
    return hashlib.sha256(seed).hexdigest()


def normalize_tags(value):
    if isinstance(value, list):
        return [unicode_or_string(item).strip() for item in value if unicode_or_string(item).strip()][:8]
    return [part.strip() for part in unicode_or_string(value).split(',') if part.strip()][:8]


def unicode_or_string(value):
    if value is None:
        return u''
    if isinstance(value, text_type):
        return value
    if isinstance(value, bytes):
        return value.decode('utf-8')
    return text_type(value)


def proxy_request_value(value):
    if value is None:
        return None
    if isinstance(value, bytes):
        return value
    return unicode_or_string(value).encode('utf-8')


def decode_url_component(value):
    decoded = unquote(value)
    if isinstance(decoded, text_type):
        return decoded
    return decoded.decode('utf-8')


def make_slug(value):
    text = unicode_or_string(value).strip().lower()
    text = re.sub(u'[^a-z0-9\u4e00-\u9fa5]+', '-', text, flags=re.UNICODE).strip('-')
    if text:
        return text
    return 'system-%s' % hashlib.sha1(str(time.time()).encode('utf-8')).hexdigest()[:8]


def make_ascii_slug(value):
    text = unicode_or_string(value).strip().lower()
    text = re.sub(r'[^a-z0-9]+', '-', text).strip('-')
    if text:
        return text
    return 'system-%s' % hashlib.sha1(str(time.time()).encode('utf-8')).hexdigest()[:8]


def validate_url(value, field):
    text = unicode_or_string(value).strip()
    if not text:
        return ''
    if text == '#':
        return text
    if field == 'image' and re.search(r'(^|[\\/])\.\.([\\/]|$)', text):
        raise ValueError('Image path cannot contain parent-directory traversal')
    if re.match(r'^(https?:)?//', text, re.I) or re.match(r'^[a-z0-9_./#?=&%-]+$', text, re.I):
        return text
    raise ValueError('%s is not a supported URL or relative path' % field)


def normalize_credential_profile(value):
    text = unicode_or_string(value).strip()
    if not text:
        return ''
    if re.match(r'^[a-z0-9_.:-]+$', text, re.I):
        return text
    raise ValueError('Credential profile can contain only letters, numbers, dot, underscore, colon, or hyphen')


def normalize_system(payload, existing_id=None, existing_system=None):
    existing_system = existing_system or {}
    name = unicode_or_string(payload.get('name')).strip()
    description = unicode_or_string(payload.get('description')).strip()
    category = unicode_or_string(payload.get('category')).strip()
    launch_username = unicode_or_string(payload.get('launchUsername')).strip()
    launch_password = unicode_or_string(payload.get('launchPassword'))
    has_launch_input = 'launchUsername' in payload or 'launchPassword' in payload
    credential_profile = normalize_credential_profile(payload.get('credentialProfile') or existing_system.get('credentialProfile'))
    if has_launch_input and not launch_username and not launch_password:
        credential_profile = ''
    if (launch_username or launch_password) and not credential_profile:
        credential_profile = 'system-%s' % (existing_id or make_ascii_slug(name))
    if not name:
        raise ValueError('System name is required')
    if not description:
        raise ValueError('Description is required')
    if not category:
        raise ValueError('Category is required')
    return {
        'id': existing_id or make_slug(name),
        'name': name,
        'description': description,
        'category': category,
        'url': validate_url(payload.get('url') or '#', 'url'),
        'status': unicode_or_string(payload.get('status') or '待配置').strip(),
        'icon': unicode_or_string(payload.get('icon') or 'layout-dashboard').strip(),
        'image': validate_url(payload.get('image') or '', 'image'),
        'credentialProfile': credential_profile,
        'tags': normalize_tags(payload.get('tags'))
    }


def get_launch_credentials_path():
    return os.environ.get('PORTAL_LAUNCH_CREDENTIALS_FILE', '/etc/service-portal/launch-credentials.json')


def read_launch_credentials():
    raw = os.environ.get('PORTAL_LAUNCH_CREDENTIALS_JSON')
    if raw:
        return json.loads(raw)
    credential_path = get_launch_credentials_path()
    if not os.path.exists(credential_path):
        return {}
    with open(credential_path, 'rb') as handle:
        return json.loads(handle.read().decode('utf-8'))


def write_launch_credentials(credentials):
    if os.environ.get('PORTAL_LAUNCH_CREDENTIALS_JSON'):
        return
    credential_path = get_launch_credentials_path()
    ensure_dir(os.path.dirname(credential_path))
    fd, temp_path = tempfile.mkstemp(prefix='launch-credentials-', suffix='.json', dir=os.path.dirname(credential_path))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write((json.dumps(credentials, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))
        try:
            os.chmod(temp_path, 0o600)
        except Exception:
            pass
        os.rename(temp_path, credential_path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def attach_launch_metadata(config):
    credentials = read_launch_credentials()
    next_config = dict(config)
    next_systems = []
    for system in config.get('systems', []):
        next_system = dict(system)
        profile = credentials.get(system.get('credentialProfile')) if system.get('credentialProfile') else None
        next_system['launchUsername'] = unicode_or_string(profile.get('username')) if profile else ''
        next_system['hasLaunchPassword'] = bool(profile and profile.get('password'))
        next_systems.append(next_system)
    next_config['systems'] = next_systems
    return next_config


def public_portal_config(config):
    credentials = read_launch_credentials()
    next_config = dict(config)
    next_systems = []
    for system in config.get('systems', []):
        next_system = dict(system)
        profile = credentials.get(system.get('credentialProfile')) if system.get('credentialProfile') else None
        launch_mode = 'proxy' if profile and profile.get('launchMode') == 'proxy' else 'direct'
        login_url = profile.get('loginUrl') if profile and profile.get('loginUrl') else system.get('url')
        next_system['launchMode'] = launch_mode
        next_system['launchHref'] = '/api/launch/%s' % system.get('id') if launch_mode == 'proxy' else login_url
        next_system['hasLaunchUsername'] = bool(profile and profile.get('username'))
        next_system['hasLaunchPassword'] = bool(profile and profile.get('password'))
        next_systems.append(next_system)
    next_config['systems'] = next_systems
    return next_config


def sync_launch_credentials(system, payload):
    launch_username = unicode_or_string(payload.get('launchUsername')).strip()
    launch_password = unicode_or_string(payload.get('launchPassword'))
    if not system.get('credentialProfile') or (not launch_username and not launch_password):
        return
    credentials = read_launch_credentials()
    existing = credentials.get(system.get('credentialProfile')) or {}
    credentials[system.get('credentialProfile')] = {
        'username': launch_username or existing.get('username') or '',
        'password': launch_password or existing.get('password') or '',
        'method': existing.get('method') or 'POST',
        'loginUrl': existing.get('loginUrl') or system.get('url'),
        'launchMode': existing.get('launchMode') or 'direct',
        'proxyMode': existing.get('proxyMode') or '',
        'fields': existing.get('fields') or {
            'username': 'username',
            'password': 'password'
        },
        'extraFields': existing.get('extraFields') or {}
    }
    write_launch_credentials(credentials)


def credential_copy_payload(config, system_id, field):
    if field not in ('username', 'password'):
        return None
    system = None
    for item in config.get('systems', []):
        if item.get('id') == system_id:
            system = item
            break
    if not system or not system.get('credentialProfile'):
        return None
    credentials = read_launch_credentials()
    profile = credentials.get(system.get('credentialProfile'))
    if not profile:
        return None
    return {
        'field': field,
        'value': unicode_or_string(profile.get(field))
    }


def is_ledger_launch(system, profile):
    if profile.get('launchMode') == 'ledger':
        return True
    ledger_origin = get_ledger_origin()
    return target_origin(profile.get('loginUrl') or system.get('url')) == ledger_origin or target_origin(system.get('url')) == ledger_origin


def request_json(url, payload):
    raw = json.dumps(payload).encode('utf-8')
    req = urllib2.Request(url, data=raw)
    req.add_header('Content-Type', 'application/json')
    req.add_header('Content-Length', str(len(raw)))
    response = urllib2.urlopen(req, timeout=10)
    body = response.read().decode('utf-8')
    return json.loads(body)


def login_ledger(system, profile):
    login_api = profile.get('loginApi') or (get_ledger_origin() + '/qhp/user/doLogin')
    fields = profile.get('fields') or {}
    username_field = unicode_or_string(fields.get('username') or 'username').strip()
    password_field = unicode_or_string(fields.get('password') or 'password').strip()
    result = request_json(login_api, {
        username_field: profile.get('username'),
        password_field: profile.get('password')
    })
    if int(result.get('code') or 0) != 200:
        raise ValueError(result.get('msg') or 'Ledger login failed')
    return result


def render_ledger_launch_page(system, login_result):
    payload = json.dumps(login_result, ensure_ascii=False).replace('<', '\\u003c')
    return u'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s - 正在进入系统</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100%% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>正在进入 %s</h1>
    <p>登录凭据已验证，正在打开系统页面。</p>
  </main>
  <script>
    const payload = %s;
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
</html>''' % (
        escape_html(system.get('name')),
        escape_html(system.get('name')),
        payload
    )


def render_ledger_autofill_launch_page(system, profile):
    payload = json.dumps({
        'username': unicode_or_string(profile.get('username')),
        'password': unicode_or_string(profile.get('password')),
        'extraFields': profile.get('extraFields') if isinstance(profile.get('extraFields'), dict) else {}
    }, ensure_ascii=False).replace('<', '\\u003c')
    return u'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s - Opening login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100%% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Opening %s</h1>
    <p>The saved account and password will be filled on the login page. Please click login manually.</p>
  </main>
  <script>
    const payload = %s;
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
    ].forEach(function(key) { localStorage.removeItem(key); });
    document.cookie = "token=; path=/; Max-Age=0";
    sessionStorage.setItem("portalLedgerAutofill", JSON.stringify(payload));
    window.location.replace('/ledger/#/login');
  </script>
</body>
</html>''' % (
        escape_html(system.get('name')),
        escape_html(system.get('name')),
        payload
    )


def ledger_autofill_script():
    return u'''<script>
(function portalLedgerFillLogin() {
  var storageKey = "portalLedgerAutofill";
  var raw = sessionStorage.getItem(storageKey);
  if (!raw) return;

  var credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (error) {
    sessionStorage.removeItem(storageKey);
    return;
  }

  function setValue(element, value) {
    if (element.dataset.portalAutofillApplied === "1" && element.value) return true;
    if (element.value === value) return true;
    var prototype = Object.getPrototypeOf(element);
    var descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.dataset.portalAutofillApplied = "1";
    return false;
  }

  function isVisible(element) {
    var style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  }

  function userScore(element) {
    var text = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label")
    ].join(" ").toLowerCase();
    if (/user|account|login|name|phone|mobile|email|账号|帐号|用户|用户名|登录名/.test(text)) return 0;
    return 1;
  }

  var attempts = 0;
  var timer = window.setInterval(function() {
    attempts += 1;
    var inputs = Array.prototype.slice.call(document.querySelectorAll("input"))
      .filter(function(input) {
        return !input.disabled && !input.readOnly && input.type !== "hidden" && isVisible(input);
      });
    var passwordInput = inputs.find(function(input) {
      return String(input.type || "").toLowerCase() === "password";
    });
    var usernameInput = inputs
      .filter(function(input) {
        return String(input.type || "").toLowerCase() !== "password";
      })
      .sort(function(left, right) {
        return userScore(left) - userScore(right);
      })[0];

    var usernameChanged = false;
    var passwordChanged = false;
    if (usernameInput && credentials.username) usernameChanged = setValue(usernameInput, credentials.username);
    if (passwordInput && credentials.password) passwordChanged = setValue(passwordInput, credentials.password);

    if ((usernameInput || !credentials.username) && (passwordInput || !credentials.password)) {
      window.clearInterval(timer);
      window.setTimeout(function() { sessionStorage.removeItem(storageKey); }, 2000);
    }
    if (attempts >= 30) window.clearInterval(timer);
  }, 300);
})();
</script>'''


def inject_ledger_autofill_script(html):
    script = ledger_autofill_script()
    if 'portalLedgerFillLogin' in html:
        return html
    if '</body>' in html:
        return html.replace('</body>', script + '</body>')
    return html + script


def autofill_storage_key(system):
    return 'portalAutofill:%s' % unicode_or_string(system.get('id'))


def proxy_system_prefix(system):
    return '/proxy/%s' % unicode_or_string(system.get('id'))


def get_launch_url(system, profile):
    launch_url = validate_url(profile.get('loginUrl') or system.get('url'), 'loginUrl')
    if not re.match(r'^https?://', launch_url, re.I):
        raise ValueError('Autofill launch URL must be absolute')
    return urlparse.urlparse(launch_url)


def render_autofill_launch_page(system, profile):
    target = get_launch_url(system, profile)
    target_path = target.path or '/'
    use_native_path_proxy = profile.get('proxyMode') == 'native-path'
    proxy_location = target_path if use_native_path_proxy else proxy_system_prefix(system) + target_path
    if target.query:
        proxy_location += '?' + target.query
    if target.fragment:
        proxy_location += '#' + target.fragment
    payload = json.dumps({
        'username': unicode_or_string(profile.get('username')),
        'password': unicode_or_string(profile.get('password')),
        'extraFields': profile.get('extraFields') if isinstance(profile.get('extraFields'), dict) else {}
    }, ensure_ascii=False).replace('<', '\\u003c')
    storage_key = json.dumps(autofill_storage_key(system))
    if use_native_path_proxy:
        root_proxy_cookie = 'document.cookie = "%s=" + encodeURIComponent(%s) + "; path=/; max-age=3600; SameSite=Lax";' % (
            ROOT_PROXY_COOKIE,
            json.dumps(unicode_or_string(system.get('id')))
        )
    else:
        root_proxy_cookie = 'document.cookie = "%s=; path=/; Max-Age=0";' % ROOT_PROXY_COOKIE
    return u'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s - Opening login</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100%% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0; color: #526173; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>Opening %s</h1>
    <p>The saved account and password will be filled on the login page. Please click login manually.</p>
  </main>
  <script>
    const payload = %s;
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
    ].forEach(function(key) { localStorage.removeItem(key); });
    document.cookie = "token=; path=/; Max-Age=0";
    %s
    sessionStorage.setItem(%s, JSON.stringify(payload));
    window.location.replace('%s');
  </script>
</body>
</html>''' % (
        escape_html(system.get('name')),
        escape_html(system.get('name')),
        payload,
        root_proxy_cookie,
        storage_key,
        escape_html(proxy_location)
    )


def autofill_script(system):
    storage_key = json.dumps(autofill_storage_key(system))
    return u'''<script>
(function portalFillLogin() {
  const storageKey = %s;
  const lcapUserInfoKey = storageKey + ":lcapUserInfo";
  const lcapRedirectKey = storageKey + ":lcapRedirected";

  const install_lcap_login_bridge = function() {
    if (window.__portalLcapLoginBridgeInstalled) return;
    window.__portalLcapLoginBridgeInstalled = true;
    let lcapResourcesReady = false;

    const parseJson = function(text) {
      try {
        return JSON.parse(text);
      } catch (error) {
        return null;
      }
    };

    const resourcePaths = function() {
      const appInfo = window.appInfo || {};
      const seen = {};
      const paths = [];
      (appInfo.authResourcePaths || []).concat(appInfo.baseResourcePaths || []).forEach(function(path) {
        const current = String(path || "").trim();
        if (current && !seen[current]) {
          seen[current] = true;
          paths.push(current);
        }
      });
      return paths;
    };

    const lcapResources = function() {
      return resourcePaths().map(function(path) {
        return {
          resourceType: "ui",
          resourceValue: path,
          ResourceType: "ui",
          ResourceValue: path
        };
      });
    };

    const buildLcapUserInfo = function(payload) {
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
        displayName: displayName,
        DepartmentId: department.deptId || department.DepartmentId || mapping.deptId || "",
        DepartmentName: department.name || department.Name || "",
        status: user.status || user.Status || "",
        source: user.source || user.Source || ""
      };
    };

    const getLcapUserInfo = function() {
      return window.__portalLcapUserInfo || parseJson(sessionStorage.getItem(lcapUserInfoKey));
    };

    const applyLcapUserInfo = function(info) {
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

    const storeLcapUserInfo = function(info) {
      if (!info || !info.UserId) return;
      sessionStorage.setItem(lcapUserInfoKey, JSON.stringify(info));
      applyLcapUserInfo(info);
    };

    const hasResourcePath = function(path) {
      const normalized = String(path || "");
      const fullPath = normalized.charAt(0) === "/" ? normalized : "/" + normalized;
      return resourcePaths().some(function(resourcePath) {
        return resourcePath === fullPath || resourcePath + "/" === fullPath || fullPath.indexOf(resourcePath + "/") === 0;
      });
    };

    const installLcapAuthPatch = function() {
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
        return originalGetUserInfo.apply(auth, arguments).then(function(info) {
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

    const redirectAfterLcapLogin = function() {
      const cached = getLcapUserInfo();
      if (!cached || !cached.UserId) return;
      if (!/[/]login[/]?$/.test(window.location.pathname)) return;
      if (sessionStorage.getItem(lcapRedirectKey)) return;
      sessionStorage.setItem(lcapRedirectKey, "1");
      window.setTimeout(function() {
        if (/[/]login[/]?$/.test(window.location.pathname)) {
          window.location.replace("/dashboard/applicationCenter");
        }
      }, 500);
    };

    const handleLcapBridgeResponse = function(url, status, responseText) {
      if (status < 200 || status >= 300) return;
      const textUrl = String(url || "");
      const payload = parseJson(responseText);
      if (textUrl.indexOf("lcplogics/getDeptNameByUserName") !== -1 && payload) {
        storeLcapUserInfo(buildLcapUserInfo(payload));
      }
      if (textUrl.indexOf("/api/login-log") !== -1 || textUrl.indexOf("login-log") !== -1) {
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

    const patchTimer = window.setInterval(function() {
      installLcapAuthPatch();
      if (window.appVM && window.appVM.$auth) {
        applyLcapUserInfo(getLcapUserInfo());
      }
    }, 100);
    window.setTimeout(function() { window.clearInterval(patchTimer); }, 30000);
  };

  install_lcap_login_bridge();

  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return;

  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (error) {
    sessionStorage.removeItem(storageKey);
    return;
  }

  const setValue = function(element, value) {
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

  const isVisible = function(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.offsetParent !== null;
  };

  const fieldText = function(element) {
    return [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute("autocomplete"),
      element.getAttribute("aria-label"),
      element.className
    ].join(" ").toLowerCase();
  };

  const fillableType = function(element) {
    return !/^(hidden|checkbox|radio|button|submit|reset|file|image)$/i.test(String(element.type || ""));
  };

  const passwordScore = function(element) {
    const text = fieldText(element);
    if (String(element.type || "").toLowerCase() === "password") return 0;
    if (/pwd|pass|password|\\u5bc6\\s*\\u7801/.test(text)) return 1;
    return 9;
  };

  const userScore = function(element) {
    const text = fieldText(element);
    if (/org|company|corp|tenant|\\u516c\\u53f8|\\u7ec4\\u7ec7|\\u4f01\\u4e1a|\\u6240\\u5c5e/.test(text)) return 9;
    if (/userid|user_id|user-code|usercode|account|login|username|user|name|email|phone|mobile|id|\\u8d26\\u53f7|\\u5e10\\u53f7|\\u7528\\u6237|\\u7528\\u6237\\u540d|\\u767b\\u5f55\\u540d/.test(text)) return 0;
    if (/user|account|login|name|phone|mobile|email|\\u8d26\\u53f7|\\u5e10\\u53f7|\\u7528\\u6237|\\u7528\\u6237\\u540d|\\u767b\\u5f55\\u540d/.test(text)) return 0;
    return 1;
  };

  const findField = function(key) {
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
      } catch (error) {}
    }
    const normalized = raw.toLowerCase();
    return Array.prototype.slice.call(document.querySelectorAll("input, select, textarea")).find(function(element) {
      return [
        element.id,
        element.name,
        element.placeholder,
        element.getAttribute("aria-label")
      ].join(" ").toLowerCase().includes(normalized);
    }) || null;
  };

  const selectOptionByValueOrText = function(select, value) {
    const expected = String(value || "").trim();
    const options = Array.prototype.slice.call(select.options || []);
    const option = options.find(function(item) {
      return item.value === expected || item.text.trim() === expected;
    });
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    select.dispatchEvent(new Event("blur", { bubbles: true }));
    select.dataset.portalAutofillApplied = "1";
    return select.value === option.value;
  };

  const fillExtraFields = function() {
    const extraFields = credentials.extraFields || {};
    const entries = Object.keys(extraFields).map(function(key) {
      return [key, extraFields[key]];
    }).filter(function(entry) {
      return String(entry[1] || "").trim();
    });
    if (!entries.length) return true;
    return entries.every(function(entry) {
      const key = entry[0];
      const value = entry[1];
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
  const timer = window.setInterval(function() {
    attempts += 1;
    const inputs = Array.prototype.slice.call(document.querySelectorAll("input"))
      .filter(function(input) {
        return !input.disabled && !input.readOnly && fillableType(input) && isVisible(input);
      });
    const passwordInput = inputs.slice().sort(function(left, right) {
      return passwordScore(left) - passwordScore(right);
    }).find(function(input) {
      return passwordScore(input) < 9;
    });
    const usernameInput = inputs
      .filter(function(input) {
        return input !== passwordInput;
      })
      .sort(function(left, right) {
        return userScore(left) - userScore(right);
      })
      .find(function(input) {
        return userScore(input) < 9;
      });

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
      window.setTimeout(function() { sessionStorage.removeItem(storageKey); }, 2000);
    }
    if (attempts >= 120) window.clearInterval(timer);
  }, 300);
})();
</script>''' % storage_key


def inject_autofill_script(system):
    return autofill_script(system)


def parse_proxy_path(pathname):
    match = re.match(r'^/proxy/([^/]+)(/.*)?$', pathname)
    if not match:
        return None
    return {
        'system_id': decode_url_component(match.group(1)),
        'target_path': match.group(2) or '/'
    }


def parse_proxy_referer(handler, pathname):
    referer = handler.headers.get('Referer') or handler.headers.get('Referrer')
    if not referer:
        return None
    parsed = urlparse.urlparse(referer)
    referer_proxy = parse_proxy_path(parsed.path or '')
    if not referer_proxy:
        return None
    return {
        'system_id': referer_proxy.get('system_id'),
        'target_path': pathname or '/'
    }


def is_portal_native_path(pathname):
    if pathname == '/' or re.match(r'^/(index|admin|starbucks)\\.html$', pathname, re.I):
        return True
    if pathname.startswith('/assets/') or pathname.startswith('/docs/'):
        return True
    if (
        pathname == '/api/session' or
        pathname == '/api/login' or
        pathname == '/api/logout' or
        pathname == '/api/config' or
        pathname == '/api/upload' or
        pathname.startswith('/api/launch/') or
        pathname == '/api/systems' or
        pathname.startswith('/api/systems/')
    ):
        return True
    return False


def parse_root_proxy_cookie(handler, pathname):
    if is_portal_native_path(pathname):
        return None
    cookie = parse_cookie(handler.headers.get('Cookie'))
    if ROOT_PROXY_COOKIE not in cookie:
        return None
    system_id = decode_url_component(cookie[ROOT_PROXY_COOKIE].value)
    if not system_id:
        return None
    return {
        'system_id': system_id,
        'target_path': pathname or '/'
    }


def parse_proxy_request(handler, pathname):
    return parse_proxy_path(pathname) or parse_proxy_referer(handler, pathname) or parse_root_proxy_cookie(handler, pathname)


def filter_proxy_cookie_header(value):
    parts = []
    for part in unicode_or_string(value).split(';'):
        current = part.strip()
        if not current:
            continue
        name = current.split('=', 1)[0]
        if name in (ROOT_PROXY_COOKIE, SESSION_COOKIE):
            continue
        parts.append(current)
    return '; '.join(parts)


def rewrite_proxy_url(system, target_origin_value, value):
    raw = unicode_or_string(value)
    use_native_path_proxy = system and system.get('_nativePathProxy')
    if not raw or raw.startswith('#') or re.match(r'^(data|blob|mailto|tel|javascript):', raw, re.I):
        return raw
    if raw.startswith('//'):
        parsed = urlparse.urlparse('http:' + raw)
        origin = urlparse.urlparse(target_origin_value)
        if parsed.netloc == origin.netloc:
            if use_native_path_proxy:
                rewritten = parsed.path or '/'
                if parsed.query:
                    rewritten += '?' + parsed.query
                if parsed.fragment:
                    rewritten += '#' + parsed.fragment
                return rewritten
            rewritten = proxy_system_prefix(system) + (parsed.path or '/')
            if parsed.query:
                rewritten += '?' + parsed.query
            if parsed.fragment:
                rewritten += '#' + parsed.fragment
            return rewritten
        return raw
    if re.match(r'^https?://', raw, re.I):
        parsed = urlparse.urlparse(raw)
        current_origin = '%s://%s' % (parsed.scheme, parsed.netloc)
        if current_origin == target_origin_value:
            if use_native_path_proxy:
                rewritten = parsed.path or '/'
                if parsed.query:
                    rewritten += '?' + parsed.query
                if parsed.fragment:
                    rewritten += '#' + parsed.fragment
                return rewritten
            rewritten = proxy_system_prefix(system) + (parsed.path or '/')
            if parsed.query:
                rewritten += '?' + parsed.query
            if parsed.fragment:
                rewritten += '#' + parsed.fragment
            return rewritten
        return raw
    if raw.startswith('/'):
        if raw.startswith('/proxy/') or raw.startswith('/api/launch/'):
            return raw
        if use_native_path_proxy:
            return raw
        return proxy_system_prefix(system) + raw
    return raw


def rewrite_html_for_proxy(system, target_origin_value, html):
    def replace_attr(match):
        name = match.group(1)
        quote = match.group(2) or ''
        value = match.group(3) or match.group(4)
        return '%s=%s%s%s' % (name, quote, rewrite_proxy_url(system, target_origin_value, value), quote)
    rewritten = re.sub(r'''\b(src|href|action)=(?:(["'])([^"'\s>]+)\2|([^\s>]+))''', replace_attr, html, flags=re.I)
    script = inject_autofill_script(system)
    if 'portalFillLogin' in rewritten:
        return rewritten
    if '</body>' in rewritten:
        return rewritten.replace('</body>', script + '</body>')
    return rewritten + script


def looks_like_html_document(html):
    text = unicode_or_string(html).lstrip()[:2048].lower()
    return (
        text.startswith('<!doctype html') or
        text.startswith('<html') or
        re.search(r'<(head|body|form|input|script|div)\b', text) is not None
    )


def rewrite_css_for_proxy(system, target_origin_value, css):
    def replace_url(match):
        quote = match.group(1) or ''
        value = match.group(2)
        return 'url(%s%s%s)' % (quote, rewrite_proxy_url(system, target_origin_value, value), quote)
    return re.sub(r'''url\((["']?)([^"')]+)\1\)''', replace_url, css, flags=re.I)


def rewrite_proxy_content(system, target_origin_value, content_type, body):
    content_type = unicode_or_string(content_type).lower()
    if 'text/html' in content_type:
        html = body.decode('utf-8')
        if not looks_like_html_document(html):
            return body
        return rewrite_html_for_proxy(system, target_origin_value, html).encode('utf-8')
    if 'text/css' in content_type:
        return rewrite_css_for_proxy(system, target_origin_value, body.decode('utf-8')).encode('utf-8')
    return body


def should_decode_proxy_body(content_type, content_encoding=''):
    content_type = unicode_or_string(content_type).lower()
    content_encoding = unicode_or_string(content_encoding).lower()
    return content_encoding == 'gzip' and ('text/html' in content_type or 'text/css' in content_type)


def gzip_decompress(body):
    stream = gzip.GzipFile(fileobj=io.BytesIO(body))
    try:
        return stream.read()
    finally:
        stream.close()


def should_rewrite_proxy_body(content_type, content_encoding=''):
    content_type = unicode_or_string(content_type).lower()
    content_encoding = unicode_or_string(content_encoding).lower()
    return (
        ('text/html' in content_type or 'text/css' in content_type) and
        (not content_encoding or content_encoding == 'identity' or content_encoding == 'gzip')
    )


def proxy_system_request(handler, proxy_info):
    config = read_config()
    system = None
    for item in config.get('systems', []):
        if item.get('id') == proxy_info.get('system_id'):
            system = item
            break
    if not system:
        proxy_error_response(handler, 404, {'name': proxy_info.get('system_id')}, 'System not found')
        return
    credentials = read_launch_credentials()
    profile = credentials.get(system.get('credentialProfile')) if system.get('credentialProfile') else {}
    if profile and profile.get('proxyMode') == 'native-path':
        system['_nativePathProxy'] = True
    try:
        target_base = get_launch_url(system, profile or {})
    except Exception as exc:
        proxy_error_response(handler, 502, system, unicode_or_string(exc))
        return
    target_origin_value = '%s://%s' % (target_base.scheme, target_base.netloc)
    parsed = urlparse.urlparse(handler.path)
    target_path = proxy_info.get('target_path') or '/'
    target_url = target_origin_value + target_path
    if parsed.query:
        target_url += '?' + parsed.query
    body = None if handler.command in ('GET', 'HEAD') else read_raw_body(handler)
    request = PortalProxyRequest(
        proxy_request_value(target_url),
        data=body,
        headers=proxy_request_headers_for_upstream(set_proxy_referer(proxy_request_headers(handler, body), target_origin_value)),
        method=handler.command
    )
    try:
        target_response = urllib2.urlopen(request, timeout=20)
    except Exception as exc:
        if not hasattr(exc, 'code') or not hasattr(exc, 'read'):
            proxy_error_response(handler, 502, system, unicode_or_string(exc))
            return
        target_response = exc
    response_body = b'' if handler.command == 'HEAD' else target_response.read()
    content_type = unicode_or_string(target_response.info().get('Content-Type') or target_response.info().get('content-type'))
    content_encoding = unicode_or_string(target_response.info().get('Content-Encoding') or target_response.info().get('content-encoding'))
    should_rewrite = should_rewrite_proxy_body(content_type, content_encoding)
    if handler.command != 'HEAD' and should_decode_proxy_body(content_type, content_encoding):
        response_body = gzip_decompress(response_body)
    if handler.command != 'HEAD' and should_rewrite:
        response_body = rewrite_proxy_content(system, target_origin_value, content_type, response_body)
    handler.send_response(getattr(target_response, 'code', 200))
    for name, value in proxy_response_headers(target_response, drop_content_encoding=should_rewrite):
        if name.lower() == 'location':
            value = rewrite_proxy_url(system, target_origin_value, value)
        handler.send_header(name, value)
    if should_rewrite:
        handler.send_header('Cache-Control', 'no-store')
    handler.send_header('Content-Length', str(len(response_body)))
    handler.end_headers()
    if handler.command != 'HEAD':
        handler.wfile.write(response_body)


class PortalProxyRequest(urllib2.Request):
    def __init__(self, url, data=None, headers=None, method=None):
        self._portal_method = method
        urllib2.Request.__init__(self, url, data=data, headers=headers or {})

    def get_method(self):
        if self._portal_method:
            return self._portal_method
        return urllib2.Request.get_method(self)


def get_header_items(headers):
    try:
        return headers.items()
    except Exception:
        return [(name, headers.get(name)) for name in headers.keys()]


def ledger_proxy_path(pathname):
    if pathname == '/ledger':
        return '/'
    if pathname.startswith('/ledger/'):
        rest = pathname[len('/ledger/'):]
        return '/' + rest
    return pathname


def read_raw_body(handler):
    length = int(handler.headers.get('Content-Length') or '0')
    if length > MAX_BODY_BYTES:
        raise ValueError('Request body is too large')
    return handler.rfile.read(length) if length else None


def proxy_request_headers(handler, body):
    skip = set([
        'host',
        'content-length',
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailers',
        'transfer-encoding',
        'upgrade',
        'accept-encoding'
    ])
    headers = {}
    for name, value in get_header_items(handler.headers):
        if name and name.lower() not in skip:
            headers[name] = value
    cookie_header = headers.get('Cookie') or headers.get('cookie')
    if cookie_header:
        filtered_cookie = filter_proxy_cookie_header(cookie_header)
        if 'Cookie' in headers:
            if filtered_cookie:
                headers['Cookie'] = filtered_cookie
            else:
                del headers['Cookie']
        if 'cookie' in headers:
            if filtered_cookie:
                headers['cookie'] = filtered_cookie
            else:
                del headers['cookie']
    headers['Accept-Encoding'] = 'gzip, identity'
    if body:
        headers['Content-Length'] = str(len(body))
    return headers


def proxy_request_headers_for_upstream(headers):
    return dict(
        (proxy_request_value(name), proxy_request_value(value))
        for name, value in headers.items()
    )


def set_proxy_referer(headers, target_origin_value):
    target_referer = target_origin_value.rstrip('/') + '/'
    headers['Referer'] = target_referer
    if 'referer' in headers:
        headers['referer'] = target_referer
    if 'Referrer' in headers:
        headers['Referrer'] = target_referer
    if 'referrer' in headers:
        headers['referrer'] = target_referer
    return headers


def proxy_response_headers(response, drop_content_encoding=False):
    skip = set([
        'connection',
        'keep-alive',
        'proxy-authenticate',
        'proxy-authorization',
        'te',
        'trailers',
        'transfer-encoding',
        'upgrade',
        'content-length'
    ])
    if drop_content_encoding:
        skip.add('content-encoding')
        skip.add('cache-control')
        skip.add('expires')
        skip.add('pragma')
    headers = []
    for name, value in get_header_items(response.info()):
        if name and name.lower() not in skip:
            headers.append((name, value))
    return headers


def proxy_ledger_request(handler):
    parsed = urlparse.urlparse(handler.path)
    proxy_path = ledger_proxy_path(parsed.path or '/')
    query = ('?' + parsed.query) if parsed.query else ''
    target_url = get_ledger_origin() + proxy_path + query
    body = None if handler.command in ('GET', 'HEAD') else read_raw_body(handler)
    request = PortalProxyRequest(
        proxy_request_value(target_url),
        data=body,
        headers=proxy_request_headers_for_upstream(proxy_request_headers(handler, body)),
        method=handler.command
    )
    try:
        target_response = urllib2.urlopen(request, timeout=20)
    except Exception as exc:
        if not hasattr(exc, 'code') or not hasattr(exc, 'read'):
            json_response(handler, 502, {'error': unicode_or_string(exc)})
            return
        target_response = exc
    response_body = b'' if handler.command == 'HEAD' else target_response.read()
    content_type = unicode_or_string(target_response.info().get('Content-Type') or target_response.info().get('content-type'))
    if handler.command != 'HEAD' and 'text/html' in content_type:
        response_body = inject_ledger_autofill_script(response_body.decode('utf-8')).encode('utf-8')
    handler.send_response(getattr(target_response, 'code', 200))
    for name, value in proxy_response_headers(target_response):
        handler.send_header(name, value)
    handler.send_header('Content-Length', str(len(response_body)))
    handler.end_headers()
    if handler.command != 'HEAD':
        handler.wfile.write(response_body)


def render_launch_form(system, profile):
    method = unicode_or_string(profile.get('method') or 'POST').upper()
    if method != 'POST':
        raise ValueError('Only POST launch profiles are supported')
    login_url = validate_url(profile.get('loginUrl') or system.get('url'), 'loginUrl')
    if not login_url or login_url == '#':
        raise ValueError('Launch login URL is not configured')
    fields = profile.get('fields') or {}
    username_field = unicode_or_string(fields.get('username') or 'username').strip()
    password_field = unicode_or_string(fields.get('password') or 'password').strip()
    if not username_field or not password_field:
        raise ValueError('Launch username and password field names are required')
    field_pairs = [
        (username_field, profile.get('username')),
        (password_field, profile.get('password'))
    ]
    for name, value in (profile.get('extraFields') or {}).items():
        field_pairs.append((name, value))
    hidden_fields = '\n        '.join(
        '<input type="hidden" name="%s" value="%s">' % (escape_html(name), escape_html(value))
        for name, value in field_pairs
    )
    return u'''<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>%s - 正在进入系统</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, "Microsoft YaHei", sans-serif; color: #102033; background: #f6f8fb; }
    main { width: min(420px, calc(100%% - 32px)); padding: 28px; border: 1px solid #d9e2ef; border-radius: 12px; background: #fff; box-shadow: 0 24px 60px rgba(16, 32, 51, 0.12); }
    h1 { margin: 0 0 10px; font-size: 20px; }
    p { margin: 0 0 18px; color: #526173; line-height: 1.6; }
    button { border: 0; border-radius: 8px; padding: 10px 16px; color: #fff; background: #0f6f64; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>正在进入 %s</h1>
    <p>系统将通过服务器端测试凭据提交登录表单。若未自动跳转，请点击下方按钮。</p>
    <form id="launch-form" method="post" action="%s">
        %s
      <button type="submit">进入系统</button>
    </form>
  </main>
  <script>document.getElementById('launch-form').submit();</script>
</body>
</html>''' % (
        escape_html(system.get('name')),
        escape_html(system.get('name')),
        escape_html(login_url),
        hidden_fields
    )


class PortalHandler(BaseHTTPServer.BaseHTTPRequestHandler):
    server_version = 'ServicePortal/1.0'

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        proxy_info = parse_proxy_request(self, path)
        if proxy_info:
            proxy_system_request(self, proxy_info)
        elif path.startswith('/api/'):
            self.handle_api()
        elif is_ledger_proxy_path(path):
            proxy_ledger_request(self)
        else:
            self.serve_static()

    def do_POST(self):
        path = self.path.split('?', 1)[0]
        proxy_info = parse_proxy_request(self, path)
        if proxy_info:
            proxy_system_request(self, proxy_info)
        elif path.startswith('/api/'):
            self.handle_api()
        elif is_ledger_proxy_path(path):
            proxy_ledger_request(self)
        else:
            text_response(self, 405, 'Method not allowed')

    def do_PUT(self):
        path = self.path.split('?', 1)[0]
        proxy_info = parse_proxy_request(self, path)
        if proxy_info:
            proxy_system_request(self, proxy_info)
        elif path.startswith('/api/'):
            self.handle_api()
        elif is_ledger_proxy_path(path):
            proxy_ledger_request(self)
        else:
            text_response(self, 405, 'Method not allowed')

    def do_DELETE(self):
        path = self.path.split('?', 1)[0]
        proxy_info = parse_proxy_request(self, path)
        if proxy_info:
            proxy_system_request(self, proxy_info)
        elif path.startswith('/api/'):
            self.handle_api()
        elif is_ledger_proxy_path(path):
            proxy_ledger_request(self)
        else:
            text_response(self, 405, 'Method not allowed')

    def handle_api(self):
        path = self.path.split('?', 1)[0]
        try:
            if path == '/api/session' and self.command == 'GET':
                json_response(self, 200, {'authenticated': is_authenticated(self)})
                return

            launch_match = re.match(r'^/api/launch/([^/]+)$', path)
            if launch_match and self.command == 'GET':
                system_id = decode_url_component(launch_match.group(1))
                config = read_config()
                system = None
                for item in config.get('systems', []):
                    if item.get('id') == system_id:
                        system = item
                        break
                if not system:
                    json_response(self, 404, {'error': 'System not found'})
                    return
                profile_id = unicode_or_string(system.get('credentialProfile')).strip()
                if not profile_id:
                    if not system.get('url') or system.get('url') == '#':
                        json_response(self, 404, {'error': 'System launch is not configured'})
                        return
                    redirect_response(self, system.get('url'))
                    return
                credentials = read_launch_credentials()
                profile = credentials.get(profile_id)
                if not profile:
                    json_response(self, 503, {'error': 'Credential profile is not configured'})
                    return
                html_response(self, 200, render_autofill_launch_page(system, profile))
                return

            if path == '/api/public-config' and self.command == 'GET':
                json_response(self, 200, public_portal_config(read_config()))
                return

            credential_copy_match = re.match(r'^/api/credential-copy/([^/]+)/(username|password)$', path)
            if credential_copy_match and self.command == 'GET':
                config = read_config()
                payload = credential_copy_payload(
                    config,
                    decode_url_component(credential_copy_match.group(1)),
                    decode_url_component(credential_copy_match.group(2))
                )
                if not payload:
                    json_response(self, 404, {'error': 'Credential not found'})
                    return
                json_response(self, 200, payload)
                return

            if path == '/api/login' and self.command == 'POST':
                password = os.environ.get('ADMIN_PASSWORD', '')
                if not password:
                    json_response(self, 503, {'error': 'Admin password is not configured'})
                    return
                body = read_body(self)
                if unicode_or_string(body.get('password')) != password:
                    json_response(self, 401, {'error': 'Invalid password'})
                    return
                sid = session_id()
                SESSIONS[sid] = time.time()
                json_response(self, 200, {'authenticated': True}, {
                    'Set-Cookie': '%s=%s; Path=/; HttpOnly; SameSite=Strict' % (SESSION_COOKIE, sid)
                })
                return

            if path == '/api/logout' and self.command == 'POST':
                cookie = parse_cookie(self.headers.get('Cookie'))
                if SESSION_COOKIE in cookie:
                    SESSIONS.pop(cookie[SESSION_COOKIE].value, None)
                json_response(self, 200, {'authenticated': False}, {
                    'Set-Cookie': '%s=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict' % SESSION_COOKIE
                })
                return

            if path == '/api/config' and self.command == 'GET':
                if not require_auth(self):
                    return
                json_response(self, 200, attach_launch_metadata(read_config()))
                return

            if path == '/api/config' and self.command == 'PUT':
                if not require_auth(self):
                    return
                body = read_body(self)
                config = read_config()
                systems = body.get('systems')
                if not isinstance(systems, list):
                    json_response(self, 400, {'error': 'Systems array is required'})
                    return
                existing_ids = set(item.get('id') for item in config.get('systems', []))
                next_ids = set(item.get('id') for item in systems)
                if len(existing_ids) != len(next_ids) or any(system_id not in next_ids for system_id in existing_ids):
                    json_response(self, 400, {'error': 'Systems payload must contain the same ids'})
                    return
                config['systems'] = systems
                write_config(config)
                json_response(self, 200, {'config': attach_launch_metadata(config)})
                return

            if path == '/api/upload' and self.command == 'POST':
                if not require_auth(self):
                    return
                content, extension = read_upload(self)
                saved_path = write_upload(content, extension)
                json_response(self, 201, {'path': saved_path})
                return

            if path == '/api/upload' and self.command == 'DELETE':
                if not require_auth(self):
                    return
                body = read_body(self)
                delete_upload(body.get('path'))
                json_response(self, 200, {'removed': body.get('path')})
                return

            if path == '/api/systems' and self.command == 'POST':
                if not require_auth(self):
                    return
                config = read_config()
                body = read_body(self)
                system = normalize_system(body)
                ids = set(item.get('id') for item in config.get('systems', []))
                base_id = system['id']
                counter = 2
                while system['id'] in ids:
                    system['id'] = '%s-%s' % (base_id, counter)
                    counter += 1
                config['systems'].append(system)
                sync_launch_credentials(system, body)
                write_config(config)
                admin_config = attach_launch_metadata(config)
                admin_system = None
                for item in admin_config.get('systems', []):
                    if item.get('id') == system.get('id'):
                        admin_system = item
                        break
                json_response(self, 201, {'system': admin_system or system, 'config': admin_config})
                return

            match = re.match(r'^/api/systems/([^/]+)$', path)
            if match and self.command == 'PUT':
                if not require_auth(self):
                    return
                system_id = decode_url_component(match.group(1))
                config = read_config()
                systems = config.get('systems', [])
                for index, item in enumerate(systems):
                    if item.get('id') == system_id:
                        body = read_body(self)
                        system = normalize_system(body, system_id, item)
                        systems[index] = system
                        sync_launch_credentials(system, body)
                        write_config(config)
                        admin_config = attach_launch_metadata(config)
                        admin_system = None
                        for current in admin_config.get('systems', []):
                            if current.get('id') == system.get('id'):
                                admin_system = current
                                break
                        json_response(self, 200, {'system': admin_system or system, 'config': admin_config})
                        return
                json_response(self, 404, {'error': 'System not found'})
                return

            if match and self.command == 'DELETE':
                if not require_auth(self):
                    return
                system_id = decode_url_component(match.group(1))
                config = read_config()
                next_systems = [item for item in config.get('systems', []) if item.get('id') != system_id]
                if len(next_systems) == len(config.get('systems', [])):
                    json_response(self, 404, {'error': 'System not found'})
                    return
                config['systems'] = next_systems
                write_config(config)
                json_response(self, 200, {'removed': system_id, 'config': attach_launch_metadata(config)})
                return

            json_response(self, 404, {'error': 'API route not found'})
        except ValueError as exc:
            json_response(self, 400, {'error': unicode_or_string(exc)})
        except Exception as exc:
            json_response(self, 500, {'error': unicode_or_string(exc)})

    def serve_static(self):
        request_path = self.path.split('?', 1)[0]
        request_path = '/index.html' if request_path == '/' else request_path
        request_path = posixpath.normpath(decode_url_component(request_path)).lstrip('/')
        file_path = os.path.abspath(os.path.join(ROOT_DIR, request_path))
        if not file_path.startswith(ROOT_DIR + os.sep):
            text_response(self, 403, 'Forbidden')
            return
        if not os.path.isfile(file_path):
            text_response(self, 404, 'Not found')
            return
        content_type = mimetypes.guess_type(file_path)[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(os.path.getsize(file_path)))
        self.end_headers()
        with open(file_path, 'rb') as handle:
            shutil.copyfileobj(handle, self.wfile)


class ThreadingHTTPServer(SocketServer.ThreadingMixIn, BaseHTTPServer.HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '80'))
    server = ThreadingHTTPServer(('0.0.0.0', port), PortalHandler)
    print('Service portal listening on %s' % port)
    server.serve_forever()
