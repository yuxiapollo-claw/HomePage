# 服务跳转门户设计规格

Date: 2026-05-11

## Goal

Build a polished static web portal for internal system navigation. The first release will ship with configurable placeholder entries; real system names, URLs, categories, and descriptions will be provided later.

The portal must be easy to deploy on a Linux server as static files, with no database or backend requirement for the initial version.

## Brand Inputs

- Unit logo: `E:\onedriver\OneDrive\work\计算机化系统清单项目\logo.jpg`
- Extracted logo colors:
  - Deep blue: `#003888`
  - Institutional green: `#009838`
- The page should keep the unit identity visible in the first viewport through logo placement, title, and color accents.

## Theme Scope

Two theme variants will be implemented from the same content configuration.

### Theme 1: Mintlify-Inspired Default

Reference: local `$ad` style `mintlify`.

This is the default route and primary recommendation. It should feel modern, clean, lightweight, and documentation-grade:

- White canvas with a soft blue-green atmospheric hero gradient.
- Inter-style typography with clean 16px body copy and strong but not heavy headings.
- Pill buttons and search controls.
- 12px rounded system cards with thin borders.
- Mintlify green usage adapted to the logo green `#009838`.
- Logo deep blue `#003888` used for brand title, selected states, and focused highlights.
- Dense but readable system cards, modeled after documentation/product cards rather than marketing tiles.

### Theme 2: Starbucks-Inspired Alternate

Reference: local `$ad` style `starbucks`.

This alternate version should feel warm, ceremonial, and green-forward while still belonging to the medical institute:

- Warm cream canvas instead of pure white.
- Four-tier green system adapted from Starbucks:
  - Brand heading green: `#006241` where appropriate.
  - CTA green: logo green `#009838`.
  - Deep band green: `#1E3932`.
  - Soft green wash: `#d4e9e2`.
- Full-pill buttons with a subtle `scale(0.95)` active state.
- 12px cards with whisper-soft shadow.
- Dark green feature band for the main portal callout.
- No coffee imagery or Starbucks brand assets; only borrow the visual language.

## Information Architecture

Both themes use the same page sections:

1. Top navigation
   - Unit logo.
   - Portal name.
   - Theme switch links or buttons.
   - Optional management/help placeholder actions.

2. Hero area
   - Title: `系统服务导航门户`.
   - Subtitle explaining it is a centralized entry for internal systems.
   - Prominent search input.
   - Quick status metrics using placeholder values, such as `12 个系统入口`, `4 个分类`, `内网访问`.

3. System navigation area
   - Category filter pills.
   - Search by name, description, or tag.
   - Card grid for system entries.
   - Placeholder categories:
     - 常用系统
     - 业务办理
     - 数据查询
     - 管理工具

4. Footer
   - Unit name.
   - Maintenance note.
   - Static deployment note.

## Data Model

System entries must be driven by a single `config.json` file so later updates do not require changing page layout code.

Initial placeholder shape:

```json
{
  "organization": {
    "name": "中国医学科学院医学生物学研究所",
    "portalName": "系统服务导航门户",
    "subtitle": "统一入口，快速访问常用业务系统"
  },
  "categories": [
    { "id": "common", "name": "常用系统" },
    { "id": "business", "name": "业务办理" },
    { "id": "data", "name": "数据查询" },
    { "id": "admin", "name": "管理工具" }
  ],
  "systems": [
    {
      "id": "placeholder-1",
      "name": "系统入口占位",
      "description": "后续替换为实际系统名称、说明和访问地址。",
      "category": "common",
      "url": "#",
      "status": "待配置",
      "tags": ["占位", "内网"]
    }
  ]
}
```

## Behavior

- Search filters cards immediately on the client.
- Category pills filter cards without page reload.
- Empty search result shows a polished empty state with reset action.
- Clicking a real configured system URL opens that URL in the current tab by default.
- Placeholder URLs use `#` and show as visually disabled or "待配置".
- Both theme pages load the same `config.json`.

## Architecture

Initial implementation should be a static site:

- `index.html`: Mintlify-inspired default.
- `starbucks.html`: Starbucks-inspired alternate.
- `assets/styles.css`: shared base styles and theme-specific sections.
- `assets/app.js`: load config, render cards, search, category filters.
- `assets/config.json`: editable portal data.
- `assets/logo.jpg`: copied from the provided logo path.

No build system is required unless implementation reveals a strong reason. This keeps deployment simple on Linux with Nginx or any static file server.

## Linux Deployment

Target server: `10.1.18.55`.

Deployment should copy the static folder to a web root such as `/var/www/service-portal` and serve it through Nginx. Credentials are operational secrets and must not be committed, written into project files, or stored in memory.

Expected post-deployment URL will depend on Nginx configuration. If the server already serves port 80, use a site path or alternate port chosen during implementation/deployment.

## Accessibility And Responsive Requirements

- Works at desktop, tablet, and mobile widths.
- No horizontal scrolling at 375px viewport width.
- Interactive elements have clear focus states and at least 44px touch target height on mobile.
- Logo has descriptive alt text.
- Search input has an accessible label.
- Theme switch controls are keyboard accessible.
- Color contrast must be readable on both light and dark/green surfaces.

## Non-Goals

- No login or permission system in the initial release.
- No backend API.
- No database.
- No automatic health checking of target systems.
- No storage of server credentials in source files or memory.

## Open Configuration Items

These are intentionally left as editable content, not blockers for implementation:

- Final system names.
- Final system URLs.
- Final category names.
- Whether links should open in the current tab or a new tab.
- Production Nginx domain/path.

