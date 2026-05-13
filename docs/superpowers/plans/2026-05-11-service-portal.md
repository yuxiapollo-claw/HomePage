# Service Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static, Linux-deployable system navigation portal with Mintlify and Starbucks-inspired theme pages backed by one editable config file.

**Architecture:** The site is a no-build static app. `index.html` and `starbucks.html` define theme shells, `assets/app.js` loads `assets/config.json` and renders identical portal data into both shells, and `assets/styles.css` contains shared layout plus theme-specific styling.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Node.js smoke tests using built-in `node:test`.

---

## File Structure

- Create `package.json`: defines smoke-test command.
- Create `tests/portal.test.mjs`: verifies required files, config structure, theme shells, rendering hooks, and credential hygiene.
- Create `index.html`: Mintlify-inspired default static shell.
- Create `starbucks.html`: Starbucks-inspired alternate static shell.
- Create `assets/config.json`: placeholder organization, categories, and system entries.
- Create `assets/app.js`: shared client renderer, search, category filters, empty state, disabled placeholder handling.
- Create `assets/styles.css`: shared base, Mintlify theme, Starbucks theme, responsive rules.
- Copy `E:\onedriver\OneDrive\work\计算机化系统清单项目\logo.jpg` to `assets/logo.jpg`.
- Create `DEPLOY.md`: Linux/Nginx deployment notes without credentials.

## Task 1: Smoke Test Harness

**Files:**
- Create: `package.json`
- Create: `tests/portal.test.mjs`

- [ ] **Step 1: Add package script**

Create `package.json` with:

```json
{
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [ ] **Step 2: Write failing smoke tests**

Create `tests/portal.test.mjs` with tests that require all planned files and validate no credential-like strings appear:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const files = [
  'index.html',
  'starbucks.html',
  'assets/config.json',
  'assets/app.js',
  'assets/styles.css',
  'assets/logo.jpg',
  'DEPLOY.md'
];

test('static portal files exist', () => {
  for (const file of files) {
    assert.equal(existsSync(file), true, `${file} should exist`);
  }
});

test('config contains organization, categories, and placeholder systems', async () => {
  const config = JSON.parse(await readFile('assets/config.json', 'utf8'));
  assert.equal(config.organization.portalName, '系统服务导航门户');
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

test('client app implements search, category filters, and empty state hooks', async () => {
  const app = await readFile('assets/app.js', 'utf8');
  assert.match(app, /function renderSystems/);
  assert.match(app, /function filterSystems/);
  assert.match(app, /function renderCategories/);
  assert.match(app, /empty-state/);
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
```

- [ ] **Step 3: Run test and verify RED**

Run: `npm test`

Expected: FAIL because `index.html` and other planned files do not exist yet.

## Task 2: Shared Content And Shells

**Files:**
- Create: `assets/config.json`
- Create: `index.html`
- Create: `starbucks.html`
- Copy: `assets/logo.jpg`

- [ ] **Step 1: Copy logo**

Copy the provided logo to `assets/logo.jpg`.

- [ ] **Step 2: Create shared config**

Create `assets/config.json` with organization text, four categories, and at least eight placeholder systems across the categories.

- [ ] **Step 3: Create Mintlify shell**

Create `index.html` with `data-theme="mintlify"`, `id="portal-root"`, a noscript fallback, links to `assets/styles.css`, and script `assets/app.js`.

- [ ] **Step 4: Create Starbucks shell**

Create `starbucks.html` with `data-theme="starbucks"`, `id="portal-root"`, a noscript fallback, links to `assets/styles.css`, and script `assets/app.js`.

- [ ] **Step 5: Run smoke tests**

Run: `npm test`

Expected: still FAIL because `assets/app.js`, `assets/styles.css`, and `DEPLOY.md` are not implemented.

## Task 3: Client Renderer

**Files:**
- Create: `assets/app.js`

- [ ] **Step 1: Implement config loading**

Use `fetch('assets/config.json')` and show a readable error state if loading fails.

- [ ] **Step 2: Implement render functions**

Define `renderCategories`, `filterSystems`, `renderSystems`, and supporting helpers. Render top navigation, hero, filters, card grid, and footer into `#portal-root`.

- [ ] **Step 3: Implement interactions**

Wire search input and category buttons to update rendered cards. Use current-tab navigation for configured URLs and disabled styling for `#` placeholder URLs.

- [ ] **Step 4: Run smoke tests**

Run: `npm test`

Expected: still FAIL only until styles and deployment doc exist.

## Task 4: Theme Styling

**Files:**
- Create: `assets/styles.css`

- [ ] **Step 1: Add shared base styles**

Include reset, font stack, accessible focus states, layout primitives, card grid, and responsive breakpoints.

- [ ] **Step 2: Add Mintlify theme**

Use white canvas, soft blue-green hero gradient, pill search, thin bordered cards, and logo blue/green accents.

- [ ] **Step 3: Add Starbucks theme**

Use warm cream canvas, deep green feature band, full-pill buttons, whisper-soft card shadows, and Starbucks-inspired green mapping adapted to the unit brand.

- [ ] **Step 4: Run smoke tests**

Run: `npm test`

Expected: FAIL only until `DEPLOY.md` exists.

## Task 5: Deployment Notes And Verification

**Files:**
- Create: `DEPLOY.md`

- [ ] **Step 1: Create deployment notes**

Document static deployment to `/var/www/service-portal`, a sample Nginx server block, and commands using placeholders only. Do not include credentials.

- [ ] **Step 2: Run full smoke tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Serve locally**

Run: `python -m http.server 4173`

Expected: local site available at `http://localhost:4173/` and `http://localhost:4173/starbucks.html`.

- [ ] **Step 4: Manual browser check**

Open both pages and confirm logo, cards, category filters, search, empty state, and theme switch links work.

## Notes

- Current directory is not a git repository, so commit steps are not available unless a repository is initialized later.
- Server credentials must stay out of all files and memory.
- Deployment can be executed after local verification if the server has SSH available from this machine.

