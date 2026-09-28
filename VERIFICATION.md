# Verification report

Executed September 28, 2026 on Windows with Node 24.18.0, npm 11.16.0, and Google Chrome through Playwright 1.63.0. Initial browser tests used the real frontend and local production server with SQLite. Cloud verification below used the publicly deployed Vercel application and Neon PostgreSQL. No API response mocks were used.

## Cloud deployment verification

Executed September 28, 2026 against **https://notion-clone-codex.vercel.app**.

- Provisioned Neon resource `notion-clone-db` with the explicitly selected `free_v3` (Free) plan, connected to Vercel project `notion-clone-codex` under the Hobby team.
- Applied all three SQL migrations successfully to PostgreSQL. Frontend and Express API run on Vercel, with no computer-hosted backend or tunnel.
- `npm test`: **19 passed, 0 failed** (16 API integration cases and 3 origin-security cases). Added permission-filtered cloud presence, revocation, version invalidation, and simultaneous-write coverage.
- Cloud polling build against the local production server: **7 browser workflows passed**. After the database-save fix, the targeted database workflow passed again with deliberate 350 ms PATCH delays.
- `$env:PLAYWRIGHT_BASE_URL='https://notion-clone-codex.vercel.app'; npx playwright test`: **7 passed, 0 failed**, final run **2.6 minutes**. This includes accounts, nested pages, block editing, search/favorites/trash/history, typed database properties and five views, two-user collaboration and revocation, workspace memberships, mobile dark-mode editing/login, Markdown import/export, and anonymous publishing/revocation.
- `node tests/cloud-persistence.mjs`: cloud concurrent edits returned exactly one HTTP 200 and one HTTP 409. After an actual Vercel redeployment, `node tests/cloud-persistence.mjs --verify` confirmed the retained login session and saved block still worked.
- Hosted frontend returned HTTP 200; anonymous `/api/me` returned HTTP 401. Deployment is publicly accessible without Vercel login.
- Vercel clean installation and production build passed with **0 audit vulnerabilities**. Local formatting and whitespace checks passed.
- Visually reviewed hosted database-board and mobile dark-mode screenshots. Test accounts and test content remain isolated in their own cloud workspaces.

Failures found and fixed in this phase: SQL byte-order markers rejected by PostgreSQL; Vercel's runtime loader rejecting the sanitizer's ESM dependency (fixed by bundling the current patched sanitizer); quick successive property edits losing an earlier field under network latency (fixed through queued writes using current property state and navigation waiting for page saves). The first hosted browser run was 6/7; the final run above passed all seven.

See [HOSTING.md](HOSTING.md) for exact deployment and hosted test commands. Earlier local-only results below are retained as the implementation history.

## Initial local results

- `npm ci --offline`: clean lockfile installation passed using the local npm cache; 173 packages installed and no vulnerabilities reported.
- `npm run build`: passed; Vite produced the production frontend.
- `npm test`: **14 passed, 0 failed**. Final run completed in approximately 3.3 seconds.
- `npm run test:ui`: **7 passed, 0 failed**. Final complete run took 31.5 seconds.
- Browser viewport coverage: 1440 x 1000 desktop and 390 x 844 mobile.
- Desktop editor, database board, and mobile dark-mode screenshots were opened and visually reviewed.
- `npm run format:check`: passed.
- Development startup smoke: HTML returned 200, the compiled React module returned 200, and the unauthenticated API correctly returned 401.
- Production startup smoke: HTML returned 200 and the unauthenticated API returned 401. The application was left running locally at `http://127.0.0.1:3000` when delivered.

## API integration coverage

1. Register three independent accounts; verify authenticated sessions, password rejection, and private workspace separation.
2. Reject unauthorized nested-page creation and page moves that would create a hierarchy cycle.
3. Inherit page grants; enforce view/comment/edit differences; reject unauthorized sharing; change and revoke grants.
4. Sanitize malicious block HTML; reject stale block revisions and invalid reorder requests.
5. Add workspace members; expose workspace-visible content while keeping private pages inaccessible; reject member invitations by non-owners.
6. Create a database and record pages; persist property values and multiple view configurations.
7. Search saved block text; exclude content inaccessible to the requesting account.
8. Trash a parent, hide descendants, restore them, and duplicate an entire database subtree with property values.
9. Persist user-specific favorites; create history snapshots and restore a previous block state.
10. Connect two authenticated Socket.IO clients; receive presence and live invalidation events.
11. Stop the server process, restart it against the same SQLite file, and verify session, block, and database-record persistence.
12. Revoke a session on logout; reject a state-changing request from an unrelated origin.
13. Publish a parent and child; read anonymously; exclude account metadata; reject anonymous writes; revoke the public link.
14. Import real Markdown blocks; verify task/code conversion; ensure a collaborator-created child does not retain access after the parent grant is revoked.

## Browser workflows actually executed

| Workflow                           | Actions and assertions                                                                                                                                                                                                                                                                          | Result |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Editor and organization            | Register, open and rename a page, edit/save/reload text, check a task, use slash conversion, create a heading, format text, favorite, create a nested page, search block content, open history, trash and restore the parent, verify the child and saved heading.                               | Passed |
| Database                           | Create a database, open a new record as a page, rename it, set status/date, add a numeric property, edit its value, add board/gallery/list/calendar views, change filters, reload and verify saved settings and record visibility. Verify only one page title renders and the board is in view. | Passed |
| Two-user collaboration             | Register separate users in separate browser contexts, invite an editor, open a shared page, verify two presence avatars, observe a live block update, add/resolve a live comment, downgrade to read-only, revoke access and verify the guest loses the page.                                    | Passed |
| Workspace/preferences/mobile/login | Change to dark mode, create and switch workspace, create a page, reload at mobile width, edit content, check horizontal overflow, log out and log back in.                                                                                                                                      | Passed |
| Import/export/public links         | Import headings/tasks/code, download Markdown and inspect its actual contents, add a nested page, publish, browse anonymously in another browser context, verify no editable content, revoke and verify the public link fails.                                                                  | Passed |
| Block behavior                     | Split text at the caret, create a toggle with indented child content, collapse/expand it, reload, duplicate/delete a block, drag reorder and verify the changed order, reload and verify saved toggle content.                                                                                  | Passed |
| Workspace membership               | Add a real second account as a member, switch that account into the workspace, see team pages without seeing private pages, edit shared content live, remove membership and verify access is revoked.                                                                                           | Passed |

## Visual evidence

These screenshots were generated by the browser workflows, not design mockups:

- [Desktop editor](docs/screenshots/editor-desktop.png)
- [Database board](docs/screenshots/database-board.png)
- [Mobile dark mode](docs/screenshots/mobile-dark.png)

## Failures found and corrected during implementation

Earlier test runs exposed and helped fix:

- Initial contenteditable blocks rendering empty even though the server had saved content.
- Ambiguous SQLite ordering in comments/history joins.
- Inaccessible form labels for select controls.
- Asynchronous checkbox handlers reading a reverted value.
- A slash-conversion revision mismatch causing a false concurrent-edit conflict.
- Duplicate React sibling keys causing database titles to accumulate after updates.
- Stale block fetches replacing newer revision state.
- Guest-created child pages incorrectly keeping independent ownership after a parent grant was revoked.
- Browser test races that typed into the previous page or block before navigation/insertion finished; these now wait for the resulting UI state.
- Windows browser-runner server shutdown hanging; the test runner now owns and stops its direct server process.

## Limits of verification

No load, penetration, accessibility-audit, Firefox, Safari, native mobile, or offline testing was performed. Same-block concurrency rejection is tested at the API level; collaborative UI tests use different editing sessions and verify live synchronization and revocation, but do not exhaust all simultaneous-keystroke schedules. Native browser rich-text behavior can differ across browsers.

The implementation intentionally differs from Notion in the areas listed in [README.md](README.md#differences-from-actual-notion). Passing these tests demonstrates the supported workflows, not full Notion feature parity.
