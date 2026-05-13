# Admin Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a password-protected admin page and backend CRUD API for configuring portal system-entry cards.

**Architecture:** Add a small dependency-free Node.js HTTP server that serves static files, manages HTTP-only sessions, validates admin API payloads, and writes `assets/config.json` atomically. Add a Mintlify-style admin page backed by `assets/admin.js` and admin CSS in `assets/styles.css`.

**Tech Stack:** Node.js built-in `http`, `fs/promises`, `crypto`, browser HTML/CSS/JavaScript, `node:test`.

---

### Task 1: Backend Auth And CRUD Tests

**Files:**
- Modify: `tests/portal.test.mjs`
- Create: `server.js`

- [ ] Add tests proving unauthenticated API calls are rejected, login works with `ADMIN_PASSWORD`, and authenticated CRUD writes JSON.
- [ ] Run `npm test` and verify the new tests fail because `server.js` does not exist or lacks handlers.
- [ ] Implement minimal `server.js` exports and HTTP handlers.
- [ ] Run `npm test` and verify backend tests pass.

### Task 2: Admin Static UI Tests

**Files:**
- Modify: `tests/portal.test.mjs`
- Create: `admin.html`
- Create: `assets/admin.js`
- Modify: `assets/styles.css`

- [ ] Add tests requiring `admin.html`, `assets/admin.js`, and admin field labels/selectors.
- [ ] Run `npm test` and verify the UI tests fail.
- [ ] Implement `admin.html`, `assets/admin.js`, and admin styles.
- [ ] Run `npm test` and verify UI tests pass.

### Task 3: Public Portal Integration

**Files:**
- Modify: `assets/app.js`
- Modify: `tests/portal.test.mjs`

- [ ] Add tests for card image rendering and admin navigation link.
- [ ] Run `npm test` and verify the tests fail.
- [ ] Update the portal renderer so configured card images appear in cards, with stable dimensions and accessible alt text.
- [ ] Add a nav link to `/admin.html`.
- [ ] Run `npm test` and verify all tests pass.

### Task 4: Deployment Documentation

**Files:**
- Modify: `DEPLOY.md`
- Modify: `package.json`
- Modify: `tests/portal.test.mjs`

- [ ] Add tests that deployment docs mention Node server and `ADMIN_PASSWORD`.
- [ ] Run `npm test` and verify the docs test fails.
- [ ] Add `start` script and update deployment instructions for `server.js`.
- [ ] Run `npm test` and verify all tests pass.

### Task 5: Deploy And Verify

**Files:**
- Deploy: `server.js`, `admin.html`, `index.html`, `starbucks.html`, `assets/`, `package.json`, `DEPLOY.md`

- [ ] Upload changed files to `/var/www/service-portal`.
- [ ] Configure `ADMIN_PASSWORD` in the Linux service environment.
- [ ] Update `service-portal.service` to run `/usr/bin/node server.js`.
- [ ] Restart the service.
- [ ] Verify `http://10.1.18.55/index.html` loads.
- [ ] Verify `http://10.1.18.55/admin.html` shows login when unauthenticated.
- [ ] Verify `POST /api/login` succeeds with the configured password.
