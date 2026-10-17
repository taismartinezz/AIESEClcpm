# AIESEClcpm

Project management and wellbeing for **AIESEC Local Committees (LCs)**. One place for an LC's tasks, reminders, chat and shared links, plus a private check-in that shows the LCP and VPs how their teams are doing without ever exposing anyone's individual answers.

> The product name lives in one constant, `APP_NAME` in `src/lib/brand.ts`. Change it there to rebrand.

## Roles

Everyone can belong to several LCs and has a role **in each one**:

| Role | Who | Can |
| --- | --- | --- |
| **President** | the LCP | manage the LC: invites, roles, departments, groups, settings and privacy thresholds |
| **VP** | executive board | lead one or more departments and see their departments' wellbeing averages |
| **Member** | team member | belongs to one department and reports to its VP |

**Departments.** A new LC starts without departments: the president creates them in Settings → Departments (e.g. oGX, oGT, oGV, Marketing…), with the usual AIESEC departments offered as one-click suggestions. The president chooses which VP leads each one, which exchange products it runs (for the pipeline) and which one handles finance.

**Groups.** Inside an LC you can create groups (a project team, an organising committee, …) with their own tasks, reminders, chat channel and bookmarks.

## Modules

- **Dashboard**: today's agenda, LC wins and opportunities, and role-aware wellbeing cards.
- **Tasks**: a board running Backlog → To do → In progress → Review → Done, with assignees, due dates, subtasks, files, comments and an optional department tag and filter.
- **Check-in**: a one-minute check-in every two weeks (or weekly, per LC). One answer per person per period, editable until the period ends.
- **Journal**: an optional private diary, encrypted so only its author can read it.
- **Chat**: LC-wide, group and direct messages.
- **Reminders**: personal, LC-wide and group reminders, including an automatic check-in reminder.
- **LC Drive**: links and uploaded files (templates, brand kit, job descriptions…) in LC folders, plus personal and group items. `/bookmarks` redirects here.
- **Handover**: one note per department per term for whoever takes over next.
- **Members** (Talent Management): recruitment intake, onboarding checklists, term dates and activity signals.
- **Import**: bring Google Sheets trackers (exchanges, partners, tasks, recruitment) in from a link or CSV.
- **Outreach**: approved email templates and sequences for oGX sign-ups, with consent, unsubscribe and results per sequence.
- **Events**: invites to the LC, a department, a role or chosen people, RSVP from the email, calendar files and reminders.
- **National (MC)**: an MC sees every linked LC's exchange numbers side by side (counts only).
- **Learning the app**: a short tour per role, a getting-started checklist, a demo LC with sample data and `/help`.
- **Team**: the directory, grouped into Executive Board and one section per department.
- **Finance**: income and expense ledger with running balance, month and year-to-date totals, spend by category and department, filters and CSV export. Any member can submit an **expense claim** with a receipt photo or PDF; the person in charge of finance approves or rejects it (a rejection needs a reason), and an approved claim creates the matching ledger entry. Members see only their own claims; other VPs see their departments' claims and spend.
- **Attendance**: LC events and conferences. VPs and the LCP log who attended (searchable, or a whole department at once); views by event, by member (with totals per event type this term) and a sortable, exportable table. Members see only their own history; VPs see their departments.
- **Tabling**: shift slots (one-off or weekly) that members sign up for until the slot starts. Capacity is enforced in the database, so two people can't both take the last place. After the slot, its creator or the LCP marks attended / no-show and adds walk-ins; only attended time counts as hours. Signing up creates a reminder the day before.

**In charge of finance** means the LCP, or the VP of the department marked as the finance department (Finance & Legality by default; change it in Settings → Departments). The rule lives in `is_finance_lead()` in SQL and `isFinanceLead()` in `src/lib/permissions.ts`.

## Wellbeing and privacy

- Journal text is encrypted in the browser and readable only by its author.
- Check-in scores (1–5) are only ever shown as **averages**: per question, per check-in period (two weeks by default) and as a trend over the last 8 periods.
- **Member Pulse**: members' averages per department. Each VP sees their own departments; the LCP sees every department and the LC total.
- **Exec Pulse**: VPs' averages, seen only by the LCP. The LCP's own answers are never counted anywhere.
- A period is hidden ("Not enough responses this fortnight to protect privacy") when fewer people than the LC's threshold responded (default 3 for the executive board and for each department; the president can change both).
- These rules are enforced in Postgres (SECURITY DEFINER functions that check the caller's role, plus RLS), not just in the interface. Anyone can opt out of being counted from the Check-in page.

## Tech stack

- Next.js 16 (App Router), React 19, TypeScript
- Supabase: Postgres, Auth and Row-Level Security
- CSS custom properties for design tokens (AIESEC blue accent), Lucide icons, @dnd-kit
- Vitest + Testing Library, PGlite for database tests, Playwright + Cucumber for end-to-end tests

## Development

```bash
npm install
cp .env.example .env.local   # fill in your own project's values
npm run dev
```

Without Supabase env vars the app runs in **demo mode** with a fictional LC (`src/lib/mock-data`).

| Command | What it does |
| --- | --- |
| `npm run lint` | ESLint |
| `npx tsc --noEmit` | type-check |
| `npm run test:unit` | unit tests + database tests (migrations and RLS in PGlite) |
| `npm run test:e2e` | Playwright |
| `npm run db:bundle` | regenerate `supabase/full_schema.sql` from the migrations |
| `SEED_PASSWORD=… npm run db:seed` | create a demo LC (members, departments, check-ins, finance, events, tabling) with fictional `@example.com` accounts in your **development** project |
| `npm run db:seed:reset` | delete those demo accounts again |

## Setting up a fresh Supabase project

This app must run on its **own** Supabase project. Never point it at another app's database.

1. **Create a new Supabase project** at [supabase.com](https://supabase.com).
2. **Run the migrations in order.** Either apply every file in `supabase/migrations/` in filename order (they sort chronologically, starting with `20260701000_baseline.sql`) using the Supabase CLI (`supabase link`, then `supabase db push`) or the SQL editor, **or** paste the single generated file `supabase/full_schema.sql` into the SQL editor of the empty project. Both produce the same database. Don't run `supabase/schema.sql`, which is kept only as a historical reference.
3. **Set the env vars.** Copy `.env.example` to `.env.local` (and to your hosting provider) and fill in your project's URL, anon key, service-role key and the other secrets listed there.
4. Set the auth **Site URL** and **Redirect URLs** as described in `docs/AUTH_SETUP.md`.
5. **Storage.** The finance migration creates a private `receipts` bucket (10 MB, images and PDF) with its access policies. Nothing else to configure: receipts are only ever opened through short-lived signed URLs.

`npm run test:unit` builds a throwaway database from the same migrations (in-process, via PGlite) to check that the chain and the bundle still apply cleanly.

## Removed modules

The original app's **Literature** module (shared paper library, Zotero import, PDF annotation, browser extension) was removed from the UI, API and types. Its tables (`literature_items`, `lit_*`, `project_libraries`, `user_zotero_credentials`) are **not dropped**, so existing data is preserved; drop them by hand if you don't need it. **Scheduling** (availability grid, finding a time, meeting proposals, the LC calendar) is back, without the Google Calendar sync.

## Emails to members

Event invites (with Going / Not going buttons and a calendar file), reminders,
the Monday digest and announcements are sent through [Resend](https://resend.com).

1. Verify your domain in Resend, then set `RESEND_API_KEY` and `EMAIL_FROM`
   (e.g. `AIESEClcpm <notifications@your-domain.org>`). Without a key, emails
   are only logged to the server console.
2. Set `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `RSVP_SECRET`.
3. Each LC president can set the sender name (Settings → LC settings), e.g.
   "AIESEC at Northwestern". Replies go to the person who sent the email.
4. Members choose how much email they get (Settings → Notifications):
   everything, the Monday digest only, or only important emails. Event
   invites and reminders, overdue tasks and announcements always go out.

### The reminder job

`GET /api/cron/notify` (with `Authorization: Bearer <CRON_SECRET>`) sends
whatever is due: event reminders 24 h and 1 h before, tasks due tomorrow and
overdue (the department's VP is copied after 3 days), check-in open and
"closes in 2 days" nudges, and the Monday digest. Every email is logged, so the
job can run as often as you like without sending anything twice.

`vercel.json` runs it once a day (07:30 UTC), which works on Vercel's free plan
but is too rare for the 1-hour reminders. To run it every 15 minutes, either
use Vercel Pro and change the schedule to `*/15 * * * *`, or schedule it from
Supabase (Database → Extensions: enable `pg_cron` and `pg_net`, then in the SQL
editor):

```sql
select cron.schedule('aiesec-notify', '*/15 * * * *', $$
  select net.http_get(
    url := 'https://YOUR-DEPLOYMENT/api/cron/notify',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET')
  );
$$);
```

## Deploying on Vercel: environment variables

Without the two `NEXT_PUBLIC_SUPABASE_*` variables the app runs in **preview
mode**: a sample LC that lives in the browser, with a banner saying so. When
the server starts it logs every missing variable by name (Vercel → your
project → Logs, search for `[config]`).

Add these in Vercel → Settings → Environment Variables (environment:
Production, and Preview if you use preview deployments), then **Redeploy**.
Variables starting with `NEXT_PUBLIC_` are built into the app, so they only
take effect after a new deployment.

| Name | Where to find the value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API (or Data API) → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys → Publishable key (`sb_publishable_…`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → Secret key (`sb_secret_…`). Never give it a `NEXT_PUBLIC_` name. |
| `NEXT_PUBLIC_APP_URL` and `APP_URL` | Your site's address, e.g. `https://aiese-clcpm.vercel.app` (no trailing slash) |
| `JOURNAL_KEY_SECRET` | Any long random string (`openssl rand -base64 32`). Keep it forever: changing it makes saved journal entries unreadable. |
| `CRON_SECRET` | Any long random string |
| `RSVP_SECRET` | Any long random string |
| `INTERNAL_API_SECRET` | Any long random string |
| `RESEND_API_KEY` | Resend → API Keys → Create API key (after verifying your domain in Resend → Domains) |
| `EMAIL_FROM` | An address on the domain you verified, e.g. `AIESEClcpm <notifications@your-domain.org>` |

Also in Supabase → Authentication → URL Configuration: set Site URL to your
site's address and add `https://your-site/**` to Redirect URLs.
