# Cloud development environment

Use the existing `/workspace/AIESEClcpm` checkout. Each cloud task is already
isolated; do not create Git worktrees unless explicitly requested.

Node.js 24 is required (`.nvmrc`). Refresh dependencies without changing the
lockfile:

```bash
cd /workspace/AIESEClcpm
npm ci --cache /tmp/aiesec-npm-cache --no-audit --no-fund
npx next typegen
```

For demo development, leave `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` unset.
Do not copy the placeholders from `.env.example`. Run `npm run dev` from the
checkout in a persistent terminal. Verify the page with a local HTTP request and
Chromium; a listening port alone does not validate the app. Processes must restart
in a restored environment. Onboarding does not support localhost preview links.

Database tests use isolated PGlite instances and need no external credentials:

```bash
npm run test:unit -- --maxWorkers=2
npm run lint
npx next typegen
npx tsc --noEmit
```

The image has `/usr/bin/chromium`. Stop only app servers you started on port 3000
before running browser suites; Playwright starts its own server:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/e2e/onboarding-permissions.spec.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:demo
```

A normal production build (`npm run build`) fetches Lato through `next/font/google`.
Allow `fonts.googleapis.com` and `fonts.gstatic.com` in environment settings.
Without these destinations the production build fails; development uses Next.js's
built-in fallback font. Keep TLS and package-integrity verification enabled.

Hosted Supabase and live EXPA OAuth are optional integrations for this demo/test
workflow. Configure them securely using the README and a dedicated development
project. Never apply this app's migrations to an unrelated database.

During onboarding, dependency installation, type generation and Chromium tests
were exercised on the current machine. The environment configuration service
could not verify its draft or confirm saving `install_script` / `start_skill`.
These instructions preserve the reusable steps locally; they do not establish
that a reusable environment configuration was saved or published.
