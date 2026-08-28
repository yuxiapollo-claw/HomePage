#!/usr/bin/env python
# -*- coding: utf-8 -*-
from __future__ import print_function

try:
    import BaseHTTPServer
except ImportError:
    import http.server as BaseHTTPServer
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
try:
    from urllib import unquote
except ImportError:
    from urllib.parse import unquote

try:
    text_type = unicode
except NameError:
    text_type = str

ROOT_DIR = os.path.abspath(os.path.dirname(__file__))
CONFIG_PATH = os.path.join(ROOT_DIR, 'assets', 'config.json')
SESSION_COOKIE = 'portal_admin_session'
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


def normalize_system(payload, existing_id=None):
    name = unicode_or_string(payload.get('name')).strip()
    description = unicode_or_string(payload.get('description')).strip()
    category = unicode_or_string(payload.get('category')).strip()
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
        'tags': normalize_tags(payload.get('tags'))
    }


def static_cache_control(file_path):
    normalized = file_path.replace(os.sep, '/')
    extension = os.path.splitext(file_path)[1].lower()
    if normalized.endswith('/assets/config.json'):
        return 'no-store'
    if extension == '.html':
        return 'no-cache'
    if extension in ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg', '.ico']:
        return 'public, max-age=31536000, immutable'
    if extension in ['.js', '.css']:
        return 'public, max-age=86400'
    return 'no-cache'


class PortalHandler(BaseHTTPServer.BaseHTTPRequestHandler):
    server_version = 'ServicePortal/1.0'

    def do_GET(self):
        if self.path.startswith('/api/'):
            self.handle_api()
        else:
            self.serve_static()

    def do_POST(self):
        self.handle_api()

    def do_PUT(self):
        self.handle_api()

    def do_DELETE(self):
        self.handle_api()

    def handle_api(self):
        path = self.path.split('?', 1)[0]
        try:
            if path == '/api/session' and self.command == 'GET':
                json_response(self, 200, {'authenticated': is_authenticated(self)})
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
                json_response(self, 200, read_config())
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
                json_response(self, 200, {'config': config})
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
                system = normalize_system(read_body(self))
                ids = set(item.get('id') for item in config.get('systems', []))
                base_id = system['id']
                counter = 2
                while system['id'] in ids:
                    system['id'] = '%s-%s' % (base_id, counter)
                    counter += 1
                config['systems'].append(system)
                write_config(config)
                json_response(self, 201, {'system': system, 'config': config})
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
                        system = normalize_system(read_body(self), system_id)
                        systems[index] = system
                        write_config(config)
                        json_response(self, 200, {'system': system, 'config': config})
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
                json_response(self, 200, {'removed': system_id, 'config': config})
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
        self.send_header('Cache-Control', static_cache_control(file_path))
        self.end_headers()
        with open(file_path, 'rb') as handle:
            shutil.copyfileobj(handle, self.wfile)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '80'))
    server = BaseHTTPServer.HTTPServer(('0.0.0.0', port), PortalHandler)
    print('Service portal listening on %s' % port)
    server.serve_forever()
