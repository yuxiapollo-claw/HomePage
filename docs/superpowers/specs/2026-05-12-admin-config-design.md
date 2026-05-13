# Admin Config Design

## Goal

Add an administrator-only page for maintaining portal system-entry cards. Administrators can create, read, update, and delete cards, including system name, description, category, icon, image, tags, status, and URL.

## Architecture

The current portal is static and reads `assets/config.json`. A client-only password gate would not protect the configuration, so the site will gain a small Node.js HTTP server. The server will serve the existing public files, protect `/admin.html`, expose authenticated JSON APIs, and persist card changes back to `assets/config.json` with atomic writes and timestamped backups.

The admin password is not stored in the repository. It is read from the Linux service environment as `ADMIN_PASSWORD`. Successful login creates an HTTP-only session cookie. API endpoints require that session cookie.

## User Experience

The public Mintlify-style portal remains the default at `/` and `/index.html`. A small "管理配置" entry can be added to the top navigation and points to `/admin.html`. If the visitor is not authenticated, `/admin.html` shows a login view.

After login, the admin page shows:

- A searchable table/list of all system cards.
- A form panel for adding or editing a card.
- Fields for system name, description, category, icon, image URL, target URL, status, and comma-separated tags.
- Buttons for add, save, cancel edit, and delete.
- A live preview card using the same visual language as the public portal.

The admin UI follows the Mintlify-inspired style already used by `index.html`: white surfaces, fine dividers, strong black primary buttons, restrained blue/green accents from the logo, compact controls, and clear spacing.

## Data Flow

Public portal:

1. Browser loads `/index.html`.
2. `assets/app.js` fetches `/assets/config.json`.
3. Cards render from `systems`.

Admin portal:

1. Browser opens `/admin.html`.
2. `admin.js` calls `GET /api/session`.
3. If unauthenticated, login form is shown.
4. `POST /api/login` validates `ADMIN_PASSWORD` server-side and sets session cookie.
5. Authenticated users call `GET /api/config`.
6. Create/update/delete actions call `POST /api/systems`, `PUT /api/systems/:id`, or `DELETE /api/systems/:id`.
7. Server validates payloads, writes `assets/config.json` atomically, and creates backups under `data/backups/`.
8. Public portal reflects changes after refresh because it still reads `assets/config.json`.

## Security

The server must:

- Reject admin API calls without a valid HTTP-only session cookie.
- Never expose `ADMIN_PASSWORD` to client JavaScript or files.
- Require `ADMIN_PASSWORD` to be set before login can succeed.
- Generate session IDs with cryptographically strong randomness.
- Use `SameSite=Strict` cookies.
- Validate card payloads before writing JSON.
- Prevent path traversal by only accepting image URLs or existing relative asset paths, not arbitrary file writes.

This phase does not include multi-user accounts, role management, database storage, or file upload. The "image" field is a configurable image URL/path; upload can be added later when storage rules are clear.

## Testing

Automated tests cover:

- Server requires authentication for admin APIs.
- Login fails with a wrong password and succeeds with the environment password.
- Authenticated CRUD updates `assets/config.json`.
- Server validates required fields.
- Static admin files exist and reference the admin script.
- Admin UI includes fields for name, description, category, icon, image, tags, status, and URL.

## Deployment

The Linux service changes from Python `SimpleHTTPServer` to Node.js:

```ini
Environment=ADMIN_PASSWORD=...
WorkingDirectory=/var/www/service-portal
ExecStart=/usr/bin/node server.js
```

Credentials are configured directly in the systemd unit or an environment file on the server, not in the project repository.
