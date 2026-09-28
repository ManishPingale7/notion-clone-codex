# Cloud hosting

Live application: https://notion-clone-codex.vercel.app

## Architecture

Vercel Hobby serves the Vite frontend and the Express function in `api/index.js`. Neon Free stores accounts, hashed sessions, documents, permissions, history, workspace version markers, and expiring presence. Both services are cloud hosted; no local process or tunnel is required. Database schema migrations run transactionally at startup under a PostgreSQL advisory lock. Cloud sessions use Secure, HttpOnly, SameSite cookies.

`DATABASE_URL` is supplied to the Vercel project by the Neon integration. Do not commit connection strings. `vercel.json` selects cloud polling during builds. Active tabs poll every 2.5 seconds; background tabs every 10 seconds; inactive presence expires after 20 seconds. Revisions reject simultaneous writes to the same block. This is not character-level CRDT merging.

The sanitizer is bundled by `npm ci`'s prepare script to support Vercel's module loader while retaining its patched parser. Node is pinned to major version 24.

## Deploy to your own account

```sh
npm ci
npx vercel login
npx vercel link
npx vercel integration add neon --name notion-clone-db --plan free_v3 --metadata region=iad1 --no-env-pull
npx vercel deploy --prod --yes
```

Accept Neon's terms in your browser when Vercel prompts. Plan identifiers may change; select the plan explicitly labeled Free. The integration attaches database environment variables to the linked project. Deployment uses the repository's build configuration and automatically applies migrations. Subsequent deployments use the same database. The linked GitHub main branch can also trigger Vercel deployments.

Local development needs neither account nor credentials: `npm ci`, `npm run dev`. It uses SQLite unless `DATABASE_URL` is set. Local data is separate from the deployed database; deployment does not upload local accounts or pages.

## Verify the hosted app

```powershell
$env:PLAYWRIGHT_BASE_URL='https://notion-clone-codex.vercel.app'
npx playwright test
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

The suite creates distinct test accounts and content on the target deployment. It does not erase existing user content. For isolated local tests, use `npm run build`, `npm test`, and `npm run test:ui` instead. Browser tests require Chrome (`npx playwright install chrome`).

To check storage across a redeployment, retain the ignored local checkpoint:

```powershell
$env:PLAYWRIGHT_BASE_URL='https://notion-clone-codex.vercel.app'
node tests/cloud-persistence.mjs
npx vercel deploy --prod --yes
node tests/cloud-persistence.mjs --verify
Remove-Item Env:PLAYWRIGHT_BASE_URL
```

## Operational limits

This deployment selected Vercel Hobby and Neon Free without paid upgrades. Provider quotas and usage restrictions still apply; this is not unlimited hosting. Check each provider dashboard for usage. Cold starts may delay the first request. The app is intended for small-scale evaluation and has not been load tested. Authentication throttling is per function instance, rather than a shared global limiter. Back up PostgreSQL through Neon or standard PostgreSQL tooling; redeploying frontend code is not a database backup. Existing local SQLite data has not been migrated.
