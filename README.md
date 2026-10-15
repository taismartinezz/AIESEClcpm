# Canopy

A research lab management platform built for trauma, psychology, and sensitive-population research teams. Canopy replaces the scattered collection of Slack threads, email chains, and spreadsheets that most labs rely on — bringing tasks, scheduling, journaling, and literature into one privacy-respecting tool.

## Screenshots

**Dashboard** — daily overview of upcoming events, team activity, and task status
![Dashboard](screenshots/dashboard.png)

**Tasks** — Kanban board across the research lifecycle
![Tasks board](screenshots/tasks-board.png)

**Scheduling** — team availability heat map showing overlap across members
![Team availability](screenshots/team-availability.png)

**Journal** — private, encrypted weekly check-ins and reflective prompts
![Journal](screenshots/journal.png)

## Product context

Research teams working with vulnerable populations (trauma survivors and other sensitive-population studies) were coordinating tasks, scheduling, and emotional check-ins across tools that were never built to protect participant or researcher privacy. Before writing any code, I ran 2 contextual inquiries and a competitive analysis to understand how these teams actually worked day to day, then designed the product privacy-first from the start rather than bolting privacy on later.

I built and shipped an MVP, then iterated based on usability testing with real users. Canopy is now live and continuously deployed (154+ deployments), and I'm currently leading an IRB submission for a 20+ participant study to formally evaluate it with research teams.

## Modules

**Tasks** — Kanban board for managing lab work across the full research lifecycle: protocol development, data collection, analysis, and publication. Supports drag-and-drop, priorities, assignees, due dates, file attachments, and real-time activity feeds.

**Scheduling** — Team availability coordination without the email back-and-forth. Members set their weekly availability on a simple grid (when2meet-style). The PI and team can see a live heat map of when everyone overlaps. Any member can propose a meeting time and invite others; invitees accept or decline in-app. Optionally sync with Google Calendar for automatic free/busy — event titles and details are never shared with anyone.

**Journal** — Private weekly check-ins and reflective prompts designed to help researchers process the emotional weight of sensitive fieldwork. The PI can suggest prompts but never sees individual responses.

**Literature** — A shared lab library for papers, books, and preprints. Tag, rate, annotate, and organize by collection. Supports both lab-wide and personal-scope items.

**Bookmarks** — Save and share links, resources, and references relevant to the lab's work.

**Team** — Member directory with weekly status updates and a real-time activity feed showing who moved what.

## Tech stack

- Framework: Next.js 15 (App Router)
- Database & Auth: Supabase (Postgres + Row-Level Security)
- Styling: CSS custom properties — no CSS framework, consistent design tokens throughout
- Drag & drop: @dnd-kit/core
- Icons: Lucide React
- Fonts: Lora (headings) + Roboto (UI)

## Design principles

- **Privacy first.** Researchers work with vulnerable populations. Personal calendar events are never visible to teammates. The PI sees only free/busy status — never what someone is doing, why they're blocked, or how they're feeling in their journal.
- **Internal-only scheduling.** There are no public booking links. Meeting proposals are between lab members only.
- **No noise.** The interface stays out of the way. One navy accent color, no gradients, no animations beyond what aids comprehension.
- **Prototype-ready.** Pages fall back to empty states (not mock data) when no database is connected, so UX can be validated in user studies before infrastructure is finalized.

## Setting up a fresh Supabase project

This app must run on its **own** Supabase project — never point it at another app's database.

1. **Create a new Supabase project** at [supabase.com](https://supabase.com).
2. **Run the migrations in order.** Apply every file in `supabase/migrations/` in filename order (they sort chronologically, starting with `20260701000_baseline.sql`), either with the Supabase CLI (`supabase link` then `supabase db push`) or by pasting each file into the SQL editor. Do not run `supabase/schema.sql`; it's a historical reference only.
3. **Set the env vars.** Copy `.env.example` to `.env.local` (and to your hosting provider) and fill in your project's URL, anon key, service-role key, and the other secrets listed there.
4. Set the auth **Site URL** and **Redirect URLs** as described in `docs/AUTH_SETUP.md`.

`npm run test:unit` builds a throwaway database from the same migrations (in-process, via PGlite) to check that the chain still applies cleanly.

## Removed modules

The original app's **Scheduling** (availability grid, meeting proposals, Google Calendar sync) and **Literature** (shared paper library, Zotero import, PDF annotation, browser extension) modules were removed from the UI, API and types. Their database tables (`schedule_events`, `user_availability`, `meeting_proposals`, `literature_items`, `lit_*`, `project_libraries`, `user_zotero_credentials`) are **not dropped**, so existing data is preserved. Nothing reads or writes them any more; drop them by hand if you don't need the data.
