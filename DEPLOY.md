# Linux Deployment

This project is a service portal with a public static UI and an authenticated admin API.

## Files To Deploy

Deploy these project files to `/var/www/service-portal`:

- `server.py`
- `server.js`
- `index.html`
- `starbucks.html`
- `admin.html`
- `package.json`
- `assets/`

The default page is the Mintlify-inspired version at `/`. The Starbucks-inspired alternate page is `/starbucks.html`. The administrator page is `/admin.html`.

## Runtime

The CentOS 7 deployment can use `server.py`, which is compatible with the system Python 2.7 runtime and has no third-party dependencies:

```bash
cd /var/www/service-portal
PORT=80 python server.py
```

`server.js` is also provided for environments that already have Node.js available:

```bash
cd /var/www/service-portal
npm start
```

The admin password must be configured outside the repository with the `ADMIN_PASSWORD` environment variable. Do not write real passwords into this project.

## API Summary

- `POST /api/login` validates the administrator password and sets an HTTP-only session cookie.
- `POST /api/logout` clears the session cookie.
- `GET /api/session` reports whether the current browser is authenticated.
- `GET /api/config` returns configuration for authenticated administrators.
- `POST /api/systems` creates a system-entry card.
- `PUT /api/systems/:id` updates a system-entry card.
- `DELETE /api/systems/:id` deletes a system-entry card.

## Systemd Service

Example service file:

```ini
[Unit]
Description=Service Portal
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/service-portal
Environment=PORT=80
EnvironmentFile=/etc/service-portal/admin.env
ExecStart=/usr/bin/python server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and restart it:

```bash
mkdir -p /etc/service-portal
chmod 700 /etc/service-portal
# Create /etc/service-portal/admin.env with the ADMIN_PASSWORD variable on the server.
chmod 600 /etc/service-portal/admin.env
systemctl daemon-reload
systemctl enable service-portal.service
systemctl restart service-portal.service
```

If firewalld is enabled:

```bash
firewall-cmd --add-service=http --permanent
firewall-cmd --reload
```

## Updating System Entries

Use `/admin.html` after logging in. Changes are written to `assets/config.json` and timestamped backups are created in `data/backups/`.

The public portal reads `assets/config.json`, so a browser refresh shows saved changes.

## Operational Notes

- Keep `ADMIN_PASSWORD` only in the server environment or a protected systemd environment file.
- Keep `assets/config.json` valid JSON.
- Admin sessions are stored in memory; restarting the service logs administrators out.
- The image field accepts an existing relative asset path such as `assets/logo.jpg` or an HTTP/HTTPS image URL.
