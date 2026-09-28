# Notion Local

A working, independently built Notion recreation: React frontend, Node backend, SQLite (local) or PostgreSQL (cloud) storage, accounts, nested pages, a block editor, databases, sharing, and live collaboration. Runs entirely on your computer with no paid services, API keys, or external identity provider.

This is **not feature-complete Notion**. The supported flows below are implemented against persistent server data. The differences section describes what is intentionally absent or simplified.

## Cloud deployment

The hosted app is **https://notion-clone-codex.vercel.app**. Frontend and Express API run on Vercel Hobby; persistent PostgreSQL runs on Neon Free in US East. The computer can be switched off. Create an account on the hosted site; local SQLite accounts and content are not automatically copied to the cloud.

See [HOSTING.md](HOSTING.md) for deployment, environment variables, and hosted verification commands.

## Install and run

Requires **Node.js 24.x** and npm. Run these commands in a terminal:

```sh
git clone https://github.com/ManishPingale7/notion-clone-codex.git
cd notion-clone-codex
npm ci
npm run dev
```

Open **http://127.0.0.1:3000** and create an account. Registration creates your own workspace and an editable getting-started page in SQLite. There are no fixed demo credentials. To evaluate collaboration, create a second account in a separate browser profile or private window, then invite that account's email.

For a production build:

```sh
npm run build
npm start
```

The same server serves the API, WebSocket connection, and frontend. Stop it with Ctrl+C. Data survives stopping and restarting both development and production servers.

### Optional configuration

Defaults work without a configuration file. To change them, copy `.env.example` to `.env`:

```powershell
# PowerShell
Copy-Item .env.example .env
```

```sh
# macOS / Linux
cp .env.example .env
```

| Variable        | Default                | Purpose                                             |
| --------------- | ---------------------- | --------------------------------------------------- |
| `PORT`          | `3000`                 | HTTP port                                           |
| `HOST`          | `127.0.0.1`            | Listen address; use `0.0.0.0` to expose on your LAN |
| `DATABASE_PATH` | `./data/notion.sqlite` | Persistent SQLite file, relative to the repository  |
| `COOKIE_SECURE` | `0`                    | Set to `1` when served over HTTPS                   |

Published links use the host you open in your browser. A `127.0.0.1` link is reachable only on that computer. No hosting or email service is required.

### Migrations and backups

The server automatically applies versioned SQL migrations in `server/migrations` on startup, recording applied names in the `migrations` table. SQLite uses foreign keys, WAL mode, and a busy timeout. No separate database installation or migration command is needed.

For a simple backup, stop the app and copy the `data` directory. Restore by stopping the app and replacing it with the backup. Do not commit the database, sessions, or `.env`; they are ignored by Git. Tests use separate temporary databases and do not modify your application data.

## What works end to end

| Area                 | Working behavior                                                                                                                                                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts             | Register, log in, log out; unique emails; salted scrypt password hashes; 30-day server-side sessions in HttpOnly SameSite cookies. Separate accounts and private content.                                                                                                                            |
| Workspaces           | Create and switch between workspaces, rename your workspace, add existing registered users as members, remove members. Owner/member/guest access is enforced by the server.                                                                                                                          |
| Pages                | Create, rename, nest, navigate with sidebar and breadcrumbs, move within a workspace with cycle prevention, duplicate a page and descendants, add emoji icons and color covers, toggle full width.                                                                                                   |
| Organization         | Private, workspace-visible, shared, and favorite sections; recently edited home; per-user favorites; soft-delete pages, inherited trash visibility, restore from trash.                                                                                                                              |
| Block editor         | Persistent text, three heading sizes, bulleted/numbered lists, tasks, nested collapsible toggles, quotes, callouts, dividers, code, URL images, and bookmarks.                                                                                                                                       |
| Editing interactions | Slash menu with search and keyboard selection; margin block menu; type conversion; Enter splits text at the caret; Shift+Enter inserts a line break; Tab/Shift+Tab indent/outdent; Markdown shortcuts; block duplicate, delete, drag reorder, move up/down. Text autosaves after 650 ms and on blur. |
| Rich text            | Bold, italic, underline, strike-through, and links through the selection toolbar; native browser editing shortcuts. Pasted content is plain text; saved HTML is allowlist-sanitized.                                                                                                                 |
| Search               | Ctrl/Cmd+K opens workspace search across accessible page titles and saved block content. Private pages do not appear to other users.                                                                                                                                                                 |
| Databases            | Database pages with child pages as records. Add/remove text, number, select, date, checkbox, and URL properties; edit values in views or record pages. Numbers, dates, select values, URLs, and checkboxes receive server validation.                                                                |
| Database views       | Named table, board, gallery, list, and calendar views; add, rename, delete, and switch views. Saved name sorting and select filtering. Local title search. Board drag/drop updates a record's select value; calendar dates create records; records open as full editable pages.                      |
| Sharing              | Invite an existing account by email with view/comment/edit rights; change and revoke grants. Workspace visibility and parent-page permissions are inherited. Only a page owner can manage its grants.                                                                                                |
| Public links         | Explicitly publish a page and its descendants with an unguessable read-only link; browse nested published pages/databases without logging in; revoke the link. Publishing grants no write or comment access.                                                                                         |
| Collaboration        | Authenticated presence avatars and live updates across sessions; Socket.IO locally, database-backed polling on Vercel. Per-block and per-page revisions reject stale writes with HTTP 409. Same-block conflicts retain local text and offer copy/reload controls instead of silently overwriting.    |
| Comments             | Persistent page discussions, live updates, resolve/reopen, and resolved-comment filtering. View-only users cannot comment; comment-only users cannot edit.                                                                                                                                           |
| History              | Latest 50 block-change snapshots; inspect and restore the title and blocks. Restoring first snapshots current content.                                                                                                                                                                               |
| Import/export        | Import a Markdown file or pasted Markdown as real blocks; export a page as Markdown or a database as a Markdown table. Export is permission-checked.                                                                                                                                                 |
| Appearance           | Notion-like sidebar, document canvas, hover controls, dialogs, breadcrumbs and database layouts; light/dark themes; collapsible mobile sidebar and responsive editing.                                                                                                                               |

### Permission model

A top-level page is private by default. The creator owns it. Nested pages inherit their parent owner's ownership and all ancestor grants; a collaborator who creates a sub-page cannot keep access simply by having created it after their parent grant is revoked. Workspace-visible pages grant edit rights to workspace members. Private pages stay private even from other workspace members. Explicit and inherited grants combine using the strongest permission, so removing one grant does not remove another still-valid source of access.

Public publishing is separate from account permissions and includes all non-trashed descendants. A public response excludes account IDs, membership information, comments, and page history. Trashing a page also makes its published content unavailable. Revocation is checked on subsequent requests; it cannot retract content already downloaded by a visitor.

## Differences from actual Notion

- No Notion AI, agents, automations, integrations, teamspaces, inbox, reminders, mentions, backlinks, synced blocks, buttons, equations, advanced embeds, or separate Notion Calendar/Mail apps. There are no fake controls for these.
- Application email/password accounts only. Invitations immediately grant access to an existing account on the same installation; no outgoing email, email verification, password reset, SSO, billing, or account deletion UI.
- Live collaboration uses server invalidation plus optimistic revisions, **not a CRDT**. Different blocks can be edited independently; simultaneous changes to the same block can conflict and require explicit resolution. No shared cursors, offline queue, or offline editing. Wait for save completion before closing the tab.
- The editor is a custom contenteditable block editor, not Notion's complete editing engine. No multi-column layouts, multi-block selection, full rich-paste fidelity, cross-block undo stack, or drag-and-drop page placement in the sidebar. Indentation is limited to five levels. Toggle children are contiguous indented blocks; dragging a toggle moves that block independently of its children. Native browser undo works within editable content.
- Page covers are solid colors; images are embedded by HTTP(S) URL. No binary file/image upload, image crop/resize, file management, or link preview scraping.
- Database filtering and board grouping use the first select property; sorting uses the page name; calendar uses the first date property. No compound filters, per-property sorting, saved view-specific property visibility, multi-select, people, relations, rollups, formulas, timeline, forms, templates, charts, or linked database sources. Calendar pages without a date are counted below the calendar.
- Page history covers title and blocks only, not database record history, properties, sharing settings, or workspace-wide undo. Snapshots are generated on block changes, capped at 50, not Notion's time-based history retention.
- Import supports block-level Markdown; inline Markdown syntax is retained as text. Export simplifies inline formatting and exports only the selected page's content (or database rows), not a recursive workspace archive. No HTML/PDF/CSV export.
- Search scans accessible content in the database rather than using a large-scale search index. Results cap at 50. No fuzzy search or external content search.
- Trash is recoverable and has no automatic expiry or permanent-deletion UI. Page order in the sidebar follows creation order; page moves use the page action menu.
- No production-scale load testing. Cloud instances coordinate through PostgreSQL versions and presence. The application is intended for local evaluation and small self-hosted use. Chrome was used for browser verification; other browsers were not tested.

## Architecture and design decisions

- **React 19 + Vite:** single-page frontend with Lucide icons and hand-written CSS. Hash routes support direct page links without a routing service. Browser localStorage holds only theme/workspace preferences; application content lives on the server.
- **Node 24 + Express 5:** same-origin JSON API, static production hosting, Vite middleware in development. A single command starts the whole stack.
- **SQLite through `node:sqlite` locally, PostgreSQL through `pg` on Vercel:** persistent users, sessions, workspaces, memberships, pages, blocks, shares, favorites, comments, history, and public-link tokens. No Docker, native addon compilation, hosted database, or secret management service required.
- **Collaboration:** local Socket.IO or cloud polling (2.5 seconds in active tabs, 10 seconds in background tabs) delivers presence and invalidation events. PostgreSQL persists cloud presence and workspace versions across instances. Clients refetch through the same permission-checked APIs. Events do not broadcast document contents; inaccessible page IDs are omitted.
- **Permissions in one server function:** every page read/write, search result, child creation, export, comment, history action, and collaboration subscription is checked. Client-side controls reflect the same access level but are not the security boundary.
- **Concurrency:** atomic compare-and-swap revisions on pages and blocks, serialized frontend page writes, stale block protection, transactions for migrations, registration, subtree duplication, history restore, and Markdown import.
- **Input handling:** parameterized SQL, restricted HTML tags and URL schemes, payload limits, authentication attempt throttling, same-origin checks for state-changing HTTP requests, HttpOnly cookies, hashed session tokens, and no passwords in API responses.

Source map: `server/db.js` owns database setup; `server/index.js` owns HTTP/socket behavior; `src/main.jsx` owns the app shell/accounts/dialogs; `src/Editor.jsx` owns blocks; `src/Database.jsx` owns views; `src/PublicPage.jsx` renders published pages; `src/style.css` owns the visual system.

## Test commands

```sh
npm run build
npm test
npm run test:ui
```

`npm test` runs API integration tests in a temporary SQLite database, including actually stopping and restarting the server. `npm run test:ui` starts its own isolated production server on port 3101, uses Chrome, runs Playwright, and cleans up the test database. Port 3102 is reserved for API tests. Both ports must be free.

Browser tests use your installed Google Chrome. If Chrome is not installed:

```sh
npx playwright install chrome
```

To use Playwright's bundled Chromium instead, set the browser channel in `playwright.config.js` to `undefined`, then run `npx playwright install chromium`.

```sh
# Individual browser workflow
npm run test:ui -- --grep "two users"
# Inspect the latest report or a failure trace
npx playwright show-report
# Format source
npm run format
```

Test reports and screenshots are written to ignored `playwright-report/` and `test-results/`. The browser suite exercises the rendered UI, not mocked API responses. See [VERIFICATION.md](VERIFICATION.md) for the exact executed workflows and final results.

## Product research

The implementation was guided by Notion's current official documentation and interface references, accessed September 28, 2026:

- [Intro to workspaces](https://www.notion.com/help/intro-to-workspaces): workspace switcher, sidebar organization, favorites and nested pages.
- [Writing and editing basics](https://www.notion.com/help/writing-and-editing-basics): block handles, slash menu, block conversion, block types, and shortcuts.
- [Database views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts): views over a shared collection of records.
- [Sharing and permissions](https://www.notion.com/help/sharing-and-permissions): page grants, inherited access, guests and public links.

This project is independent of Notion and is not endorsed by Notion Labs.
