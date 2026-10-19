# App QA and bug-fix report

Date: October 18, 2026. Repository: `taismartinezz/AIESEClcpm`.

The app builds and the tested workflows work in the local cloud environment. The follow-up clears every remaining ESLint error and warning, removes the Next.js middleware deprecation, and adds regressions for state, navigation and search. The earlier journal confidentiality and dependency fixes remain verified. The remaining release limitation is the upstream development-tool advisory described below; live external integrations were not tested.

## Final verification

| Check | Result | What it demonstrates |
| --- | --- | --- |
| Fresh `npm ci` from the updated lockfile | PASS | Installation is reproducible with Node 24; package integrity verification remains enabled. |
| Production build | PASS | Next.js 16.4.2 builds successfully, including TypeScript checking and downloading Lato. Both browser suites build their own production configuration. |
| Unit and database suite | PASS: 301 tests, 46 files | 28 unit-test files and 18 PGlite database-test files; no failed, skipped, or unhandled-error outcomes. |
| Mocked-backend browser suite | PASS: 72 tests | Existing role, auth-screen, form, privacy-display and mobile regression scenarios, plus LC permission refresh and API proxy checks, against the production app. |
| Actual demo-backend browser suite | PASS: 10 tests | No data mocks: task creation/status/reset, chat send/restoration, check-in submit/update, journal save, search navigation/reopening, availability autosave and navigation preferences, plus all demo routes at desktop and phone widths. |
| Route sweep | PASS: 24 routes × 2 viewports | HTTP 200, a visible page heading, no captured uncaught browser exceptions, and no horizontal document overflow at 1440×1000 and 390×844. |
| `next typegen` then `tsc --noEmit` | PASS | Next.js route types generate; application, test, and configuration types compile. CI now generates types before checking them. |
| `git diff --check` | PASS | No patch whitespace errors. |
| Production dependency audit | PASS: 0 known vulnerabilities | Registry audit of the installed production dependency graph; this is not an exploit test. |
| Full dependency audit | OPEN: 5 high, 0 critical, 0 moderate | All five affected package entries belong to the development lint-tool dependency chain described below. |
| ESLint, with `--max-warnings=0` | PASS: 0 errors, 0 warnings | Cleared the prior 47 errors and 55 warnings. The initial baseline was 90 errors and 54 warnings. No rules were disabled to achieve this. |

Browser checks used system Chromium at `/usr/bin/chromium`. Runtime: Node 24.19.0 and npm 11.9.0. Next.js and `eslint-config-next` are pinned to 16.4.2. The updated lockfile installs Vitest 4.1.12. The `.nvmrc` and GitHub Actions jobs now select Node 24; the installed `lint-staged` version requires at least Node 22.22.1, which the former Node 20 CI configuration did not satisfy.

## Confirmed defects fixed

| ID | Priority | Trigger and previous behavior | Fix and evidence |
| --- | --- | --- | --- |
| QA-01 | High | A real deployment without `JOURNAL_KEY_SECRET` returned `{ disabled: true }`. The journal accepted that response and could write plaintext while claiming the entry was encrypted. | The key route returns HTTP 503 with `Cache-Control: no-store`. Entry and draft saves require a key outside demo mode, including when an older server returns the disabled sentinel. Tests verify that no insert or draft write occurs in either case. |
| QA-02 | High | Saving a draft wrote plaintext under the shared `aiesec_journal_draft` browser key. The page restored it without establishing its owner, allowing a later account on the same browser to see it. | New drafts use an authenticated-user-specific key and AES-GCM encryption. Tests check ciphertext does not contain the reflection, decrypt it with the expected key, restore it, and ignore unowned legacy/other-account drafts. |
| QA-03 | Medium | A session could change after the journal loaded its encryption key, leaving the editor with a key from the previous account. | Saving is blocked if the current session is absent or belongs to a different user. A regression test changes the session after typing and verifies the insert is blocked while the text remains in the editor. |
| QA-04 | Medium | A realtime update to a message's content reset the edit draft through an effect, discarding an in-progress correction. | Message editing now captures the current content when the user starts editing. Server updates do not overwrite the local edit. A test changes the message prop while editing and verifies the typed correction is preserved and submitted. |
| QA-05 | Medium | Reading or writing the theme preference could throw when browser storage was blocked; system-theme resolution also duplicated state updates through effects. | Preference access is guarded; the selected theme continues to work in memory. System-theme changes use a subscription with cleanup. Tests cover blocked storage, restored dark/compact settings, media-query updates, and listener removal. |
| QA-06 | Low | Saving a journal entry immediately selected its read-only view, unmounting the save bar that contained the success message. | The saved-entry view now retains an accessible save confirmation. The browser test verifies the confirmation, saved reflection, and an empty editor after choosing New Entry. The save bar also wraps its controls on narrow screens. |
| QA-07 | Low | Demo journal text claimed encryption even though demo entries were held as plaintext sample data in browser memory. | The UI explicitly warns against private information and explains the different lifetimes of demo entries and browser drafts. The actual demo backend remains usable without server secrets. |
| QA-08 | Test reliability | Journal-save tests mocked `.contains()` but the app queried `.eq()`, producing three unhandled rejections even though assertions passed. Tests also bypassed encryption via the disabled sentinel. | The query mock matches the app, and save tests now exercise actual WebCrypto encryption. All 301 tests pass without unhandled rejections. |
| QA-09 | Test reliability | Browser tests depended on externally supplied public Supabase values and could reuse a default demo server. That silently changed the auth/data mode under test. An autofill test also let a signup request leave the browser. | Mocked tests start a dedicated server with dummy public settings, and intercept signup. Demo tests run separately with public Supabase settings cleared. CI builds and starts with the same settings for each suite. Existing Chromium can be selected explicitly. |
| QA-10 | Dependency security | `npm audit` reported 17 affected package entries: 1 critical, 13 high, and 3 moderate, including the pinned Next.js runtime. | Next.js and its ESLint package were upgraded together to 16.4.2. Compatible transitive fixes and a patched Vitest version were installed and locked. A fresh installation and all required app checks were repeated. Production audit is now zero; the remaining development chain is disclosed below. |

Additional React/static-analysis cleanup removes render-time reads of task-menu DOM refs and timezone-list refs, moves sidebar separators and drag indicators to stable component definitions, replaces mount-state effects with a hydration-safe external-store hook, cleans up tooltip timers, and escapes JSX text. Generated Playwright result/report directories are explicitly excluded from ESLint to avoid a directory-deletion race when browser checks run concurrently. These changes do not suppress source diagnostics.

## Follow-up fixes and refactors

| Area | Change | Regression evidence |
| --- | --- | --- |
| Search schema and request races | Reminder reads use `due_at`; LC chat reads filter on `channel`, not a nonexistent `project_id`. Removed the invalid query against encrypted journal entries' nonexistent `title`. Debounce state is instance-local and old responses cannot replace newer search results. Internal results use client navigation, retaining in-memory demo changes. | Unit test resolves requests out of order and checks the query shape. Production demo creates a task, finds it, opens/closes its detail, then finds and opens it again. |
| Entity and scope state | Task-detail editors remount by task ID; team and chat workspaces remount when their LC/scope changes. Posts synchronize changed inputs through a bounded render adjustment, not effects. Removed obsolete disconnected-demo loaders now replaced by the actual preview backend. | Existing role/module suites and all demo routes pass. Chat returns to its selected DM after navigating away and back. |
| Async loading | Chat/message and project-member reads separate loading from the active entity and ignore stale responses after effect cleanup. Loaded state is committed asynchronously. | Browser chat/message flows and unit suite pass. |
| Availability | Loaded availability is the source until the user creates a draft. Only a matching edited draft schedules a debounced write; scope changes cancel it. Team selection derives from current members until explicitly changed. Grid cells now support keyboard input and expose selected state. | Production demo changes a slot using Space, observes autosave, switches tabs, and confirms the saved selection is retained. |
| LC switching | A new LC selection remounts provider state and navigates through the router instead of reloading the document. The next LC's role/membership is loaded afresh. | Browser test switches from an LC presidency to membership in another LC: admin settings disappear and a document marker survives. |
| Navigation preferences | Folded sections now use `aiesec_nav_sections`; sidebar collapse continues to use `aiesec_nav_collapsed`. Compatible legacy section arrays can still be read, without treating booleans as arrays. | Browser test confirms a sections array is saved and remains unchanged when collapsing and expanding the sidebar. |
| Speech support and layout | Speech availability derives after hydration. Tour spotlight geometry is measured from a DOM ref in a layout effect. Removed unnecessary effects, stale-ref cleanup and hook-dependency diagnostics. | Unit/browser suites and strict lint pass. |
| Types, images and dead code | Added typed profile/workspace view records, removed explicit-any query casts, converted applicable images to Next Image, and removed unused helpers/imports/props/constants and obsolete lint comments. | Standalone type check and strict lint pass. |
| API proxy | Migrated `src/middleware.ts` to `src/proxy.ts`, preserving the API bearer gate and separately authenticated/public endpoints. Prefix lookalikes cannot enter the bypass list. | Eleven unit cases plus HTTP browser checks verify missing/malformed bearer rejection, allowed passthrough and exception boundaries. Production builds no longer emit the middleware deprecation. |
| Regression gates | `npm run lint` now fails on warnings as well as errors. CI runs lint, Next.js type generation and TypeScript before the unit suite. Browser fixtures can represent multiple LCs and correctly return singular profile/project objects. | Commands executed locally; CI workflow saved for review, not run remotely. |


## Journal data handling and compatibility

The existing server HKDF derivation and AES-GCM entry format are unchanged, so existing encrypted entries remain compatible with the same `JOURNAL_KEY_SECRET`. Tests verify stable per-user derivation, different keys for different users, encryption/decryption, and rejection of decryption with another user's key.

This patch prevents new plaintext writes to a real database. It does **not** migrate any historical database entries: no live database was accessed. If an earlier deployment stored plaintext entries, those rows need a separate, backed-up migration using that deployment's existing secret.

The old unscoped browser draft is left untouched for recovery by its original author on a trusted browser. It is not automatically imported into any account because its ownership is unknown. After recovery, the original author should remove the old `aiesec_journal_draft` key. New drafts use `aiesec_journal_draft:<user-id>` and are encrypted for real accounts. Demo drafts are explicitly described as unencrypted browser-local sample data. See the updated README for operational instructions; never include draft text or encryption secrets in logs or bug reports.

## Browser coverage

The existing browser scenarios cover sign-in and password-reset screens, autofill, mocked OAuth callback behavior, Settings navigation and role visibility, notifications/messaging Escape behavior, finance claims and ledger display, attendance/events and RSVP interactions, tabling capacity/display, pipeline/goals, partner and exchange validation, Drive/bookmark redirect, handover, membership/import, MC totals, help, and role-dependent wellbeing suppression. The 72-case mocked suite also checks 18 routes at phone width, LC role switching, and the API authentication gate. They do not exercise a live Supabase or Google account.

The added demo suite uses the app's actual in-browser PostgREST/auth stand-in. It verifies visible changes after writes, not merely server availability:

- Create a task, change it to Done through the list status menu, and confirm it disappears after a full reload, as demo reset behavior promises.
- Send a chat message and verify it appears and clears the composer.
- Answer all six check-in questions, submit, change one score, and verify the update confirmation.
- Save a journal reflection, verify the save confirmation and displayed content, then open a new empty entry.
- Search for an in-session task, open/close/reopen its detail without a document reload, restore the selected chat channel after navigating away, autosave keyboard availability edits across tab changes, and preserve independent sidebar preferences.
- Render the following routes at desktop and phone widths: `/`, `/tasks`, `/chat`, `/reminders`, `/scheduling`, `/pipeline`, `/outreach`, `/goals`, `/partners`, `/team`, `/members`, `/attendance`, `/tabling`, `/finance`, `/drive`, `/handover`, `/import`, `/checkin`, `/journal`, `/help`, `/settings`, `/profile`, `/mc`, `/privacy`.

The route tests skip first-run tour/release overlays through explicit fixture state; they do not treat those intended overlays as application bugs. Browser results are for Chromium, not Safari or Firefox. A route-render check does not establish that every control on that page works.

## Remaining findings and follow-up

### Development dependency advisory

`npm audit` still flags this development-only chain:

`eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces`

The underlying advisory is [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), stack exhaustion through deeply nested patterns. The five entries are a dependency cascade, not five separately reproduced exploits. The registry reports no compatible fixed `braces` release in this graph. npm suggests force-downgrading the Next.js ESLint configuration to 14.2.35; that breaks the version alignment with Next.js 16 and was not applied. Review or replace the affected development-tool chain when a compatible fix is available. The production-only audit is clear, but the full audit still exits nonzero.

### Static analysis and runtime convention warnings: resolved

Strict lint reports **0 errors and 0 warnings** across the repository, including the new tests. The former 36 synchronous-effect diagnostics, two purity diagnostics, nine explicit-any errors, and 55 warnings are cleared. No broad rule overrides or new diagnostic suppressions were added. Dead code and unused imports were removed rather than renamed to hide diagnostics. The machine-readable [qa-findings.json](qa-findings.json) now contains an empty lint-findings list and preserves the earlier counts for comparison.

`src/proxy.ts` now uses the supported Next.js convention, and the API gate is covered by unit and HTTP checks. Application configuration logs about absent real-service credentials are expected in demo mode; they are distinct from source lint diagnostics. Node's inherited color-environment notice is runner output, not an application lint or build failure.

### Live integrations and checks not executed

No production credentials were supplied, and no production data was accessed or modified. The following remain unverified against actual external services: Supabase Auth/OAuth, hosted Postgres/RLS under the platform's runtime, object-storage uploads and signed URLs, Resend delivery, Google Calendar refresh, and scheduled cron delivery. PGlite tests exercise migrations and database policies in process; they do not substitute for a staging Supabase integration run.

The separate Cucumber runner, cross-browser matrix, load/concurrency testing, and a dedicated accessibility audit were not run. This report does not claim complete behavioral or security coverage. Existing Playwright assertions and new targeted regressions ran without disabled assertions, retries masking failures, or test skips.

## Reproduce the checks

Use Node 24 and the existing checkout. Do not run both browser suites at once: they own port 3000 and build their own Next.js output. Stop any development server you started before launching them.

```bash
cd /workspace/AIESEClcpm
npm ci --cache /workspace/.npm-cache --no-audit --no-fund
npm run test:unit -- --maxWorkers=2
CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:demo
npx next typegen
npx tsc --noEmit
npm run lint
npm audit --omit=dev --cache /workspace/.npm-cache
npm audit --cache /workspace/.npm-cache
```

The full `npm audit` still exits nonzero for the disclosed development-only upstream advisory. Lint, type generation, type checking, both production browser suites and the production-only audit pass. On machines without system Chromium, install Playwright's Chromium and omit `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. No real Supabase keys are necessary for these automated suites.

All changes remain local for review. No commit, push, deployment, or environment publication was performed. Existing reusable cloud startup commands remain applicable; the report is their current source of validation results. No new environment-variable or network settings are required by this follow-up.
