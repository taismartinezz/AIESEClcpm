import { APP_NAME } from "@/lib/brand";

// The guided tour: a short core tour, then chapters people pick from, and
// "Show me this page" for the steps on one page. Each step can open a page
// (`route`), click something first (`click`, a tab say), and spotlight the
// first visible element among `targets`, always a `data-tour` anchor or a tab.
//
// Writing rules: the title is the feature's name as the screen says it; the
// body is at most two short sentences, what it is, then the one thing to do.

export type TourRole = "president" | "vp" | "member" | "mc";

/** Who's taking the tour: steps filter on this. */
export interface TourContext {
  role: TourRole;
  /** On an MC's national team (they see National in the menu). */
  onMc?: boolean;
}

export interface TourStep {
  /** Stable id (page tours and tests use it). The helper's one-off steps have none. */
  id?: string;
  title: string;
  body: string;
  /** Page to open first. */
  route?: string;
  /** Selectors to spotlight, first visible one wins. None: the Welcome and Finish cards only. */
  targets?: string[];
  /** Selector to click before spotlighting (a tab, say). Not clicked when the target already shows. */
  click?: string;
  /** Run when leaving the step (close what `click` opened). */
  leave?: () => void;
  /** Its anchor may be absent (a dismissed checklist): then it's left out, and out of the count. */
  optional?: boolean;
  side?: "right" | "left" | "bottom" | "top";
  /** Roles that see it. Default: the LC roles (member, VP, LCP). */
  roles?: TourRole[];
  /** Only for people on an MC. */
  onMcOnly?: boolean;
  /** The anchor is in the side menu: phones open the menu for it. */
  inMenu?: boolean;
  /** Not on phones (under 640px), where the control works differently. */
  wideOnly?: boolean;
  /** An optional "Try it" button: clicks this selector and pauses the tour. */
  tryIt?: { label: string; click: string };
  /** Pages and controls this step covers besides its route (for the coverage test). */
  covers?: string[];
  /** The "Pick what to learn next" card. */
  kind?: "chapters";
}

export interface TourChapter {
  id: string;
  title: string;
  summary: string;
  roles: TourRole[];
  steps: TourStep[];
}

const T = (id: string) => `[data-tour="${id}"]`;
const tab = (id: string) => `[role="tab"][data-tab="${id}"]`;
const HEADER = T("page-header");
const ACTIONS = T("page-actions");
const EXEC: TourRole[] = ["president", "vp"];
const LC: TourRole[] = ["president", "vp", "member"];

// ── Steps used in more than one place ───────────────────────────────────────

const dashboard: TourStep = {
  id: "dashboard", title: "Dashboard", route: "/", targets: [T("dashboard-title")], side: "bottom",
  body: "What's due, what's coming up and what needs you, each time you open the app. Start your day here.",
};
const newButton: TourStep = {
  id: "new", title: "+ New", route: "/", targets: [T("new-button")], side: "left",
  body: "Create a task, a reminder or an exchange from here (VPs and the LCP can add an event too). Press + New to see the list.",
  tryIt: { label: "Open + New", click: T("new-button") },
};
const gettingStarted: TourStep = {
  id: "getting-started", title: "Getting started", route: "/", targets: [T("getting-started")], side: "bottom", optional: true,
  body: "Your setup checklist; it ticks itself off as you go. Do the first unticked item next.",
};
const demoLc: TourStep = {
  id: "demo-lc", title: "Explore a demo LC", route: "/", targets: [T("demo-lc")], side: "bottom", optional: true,
  body: "A separate LC full of sample data, safe to click around in: nothing you do there touches your real LC. Open it to practise.",
};
const search: TourStep = {
  id: "search", title: "Search", targets: [T("search")], side: "bottom",
  body: "Tasks, people, partners, exchanges and files from one box. Press ⌘K (Ctrl+K on Windows) on any page.",
};
const ask: TourStep = {
  id: "ask", title: "Ask", targets: [T("helper")], side: "bottom",
  body: "Ask in your own words, like \"where do I add a partner?\", and it takes you there. Use it whenever you can't find something.",
};
const notifications: TourStep = {
  id: "notifications", title: "Notifications", targets: [T("notifications")], side: "bottom",
  body: "Assignments, mentions, approvals and reminders. Press the bell to see what's new.",
};
const chat: TourStep = {
  id: "chat", title: "Chat", targets: [T("chat")], side: "bottom", covers: ["/chat"],
  body: "Messages with the whole LC, your department or one person, with unread messages counted here. Press it to open the chat window.",
};
const chatWindow: TourStep = {
  id: "chat-window", title: "Open Chat", targets: [T("chat-open-page")], side: "left", wideOnly: true,
  click: T("chat"),
  leave: () => window.dispatchEvent(new Event("chatdock:close")),
  body: "The chat window answers quickly from any page. Open Chat takes you to the full page, with every channel and search.",
};
const getHelp: TourStep = {
  id: "get-help", title: "Get help", targets: [T("get-help")], side: "right", inMenu: true,
  body: "Reach your VP, your LCP or support resources privately. Use it whenever you're stuck or having a hard time.",
};
const pickNext: TourStep = {
  id: "pick-next", title: "Pick what to learn next", kind: "chapters",
  body: "Each chapter takes a minute or two. You'll find them again under Help.",
};

// ── The core tour: about eight steps, then the chapters ─────────────────────

export const CORE: TourStep[] = [
  {
    id: "welcome", title: `Welcome to ${APP_NAME}`, route: "/",
    body: "Your LC's workspace. This short tour shows how to get around; at the end you pick what to learn next.",
  },
  dashboard, newButton, gettingStarted, demoLc, search, ask, chat, getHelp, pickNext,
];

// ── Chapters ────────────────────────────────────────────────────────────────

export const CHAPTERS: TourChapter[] = [
  {
    id: "getting-around", title: "Getting around", roles: LC,
    summary: "The dashboard, + New, Search, Ask, notifications, Chat and Help.",
    steps: [
      dashboard, newButton, search, ask, notifications, chat, chatWindow,
      {
        id: "account", title: "Your account", targets: [T("account")], side: "bottom",
        body: "Your profile, settings and sign out. Open it to add your photo.",
      },
      {
        id: "settings-notifications", title: "Notifications settings", route: "/settings", click: tab("notifications"),
        targets: [T("settings-notifications")], side: "right",
        body: "Choose how much email you get: everything, the Monday digest, or only what's important. Pick one now.",
      },
      {
        id: "help-guides", title: "Guides", route: "/help", targets: [T("help-guides")], side: "top",
        body: "Short how-tos for each part of the app. Open one when you start something new.",
      },
      {
        id: "help-requests", title: "Your requests", route: "/help", targets: [T("help-requests")], side: "top",
        body: "Questions you sent through Ask that the app couldn't answer yet, and what happened to them. Check back here for replies.",
      },
      {
        id: "national", title: "National (MC)", targets: [T("nav:/mc")], side: "right", inMenu: true, onMcOnly: true,
        body: "You're on your MC's national team: this opens the national view. It has its own tour.",
      },
      getHelp,
    ],
  },
  {
    id: "setup", title: "Setting up your LC", roles: EXEC,
    summary: "Departments, invites, importing your trackers, goals and linking to your MC.",
    steps: [
      {
        id: "departments", title: "Departments", route: "/settings", click: tab("lc"), roles: ["president"],
        targets: [T("settings-departments")], side: "right",
        body: "Your departments, their VPs and the exchange products each one runs. Add your departments first.",
      },
      {
        id: "invites", title: "Invites", route: "/settings", click: tab("invites"), roles: ["president"],
        targets: [T("settings-invites")], side: "right",
        body: "Invite links for your VPs and members. Copy a link and send it to your EB.",
      },
      {
        id: "import", title: "Import", route: "/pipeline", targets: [T("import"), ACTIONS], side: "bottom", roles: EXEC,
        body: "Bring in your EXPA export or a Google Sheet; importing again updates instead of duplicating. Press Import exchanges to start.",
        tryIt: { label: "Open Import", click: T("import") },
      },
      {
        id: "goals-setup", title: "Goals", route: "/goals", targets: [ACTIONS, HEADER], side: "bottom", roles: EXEC,
        body: "This term's targets per department; exchange goals count themselves from the pipeline. Press New goal to set one.",
      },
      {
        id: "link-mc", title: "Link to your MC", route: "/settings", click: tab("lc"), roles: ["president"],
        targets: [T("settings-national")], side: "right",
        body: "Paste the LC code your MCP sends you, so the MC sees your LC's numbers. Paste it here once you have it.",
      },
    ],
  },
  {
    id: "exchanges", title: "Exchanges", roles: LC,
    summary: "Pipeline, Import, Outreach, Goals and Partners.",
    steps: [
      {
        id: "pipeline", title: "Pipeline", route: "/pipeline", targets: [T("pipeline-products"), T("tab:/pipeline")], side: "bottom",
        body: "Every exchange per product, from Sign-up to Completed. Pick a product to see its board.",
      },
      {
        id: "import-exchanges", title: "Import", route: "/pipeline", targets: [T("import"), ACTIONS], side: "bottom", roles: EXEC,
        body: "Your EXPA export or a Google Sheet in one go; importing again updates instead of duplicating. Press Import exchanges to start.",
        tryIt: { label: "Open Import", click: T("import") },
      },
      {
        id: "outreach", title: "Outreach", route: "/outreach", click: tab("templates"), targets: [tab("templates"), T("tab:/outreach")], side: "bottom",
        body: "Templates need approval, then sequences email sign-ups on day 0, 3 and 7, stopping on a reply or a stage change. Write a template to start.",
      },
      {
        id: "goals", title: "Goals", route: "/goals", targets: [ACTIONS, T("tab:/goals")], side: "bottom",
        body: "This term's targets; exchange goals count themselves as exchanges move. Check where your department stands.",
      },
      {
        id: "partners", title: "Partners", route: "/partners", targets: [ACTIONS, HEADER], side: "bottom",
        body: "Companies and organisations your LC works with: stage, contacts and follow-ups. Press Add partner to add your first one.",
      },
    ],
  },
  {
    id: "people-events", title: "People & events", roles: LC,
    summary: "People, recruitment and onboarding, Calendar, Events and Tabling.",
    steps: [
      {
        id: "people", title: "People", route: "/team", targets: [T("tab:/team")], side: "bottom",
        body: "Who's who in your LC by department, and how to reach them. Find your department's people here.",
      },
      {
        id: "recruitment", title: "Recruitment & onboarding", route: "/members", targets: [T("import-recruits"), T("page-tabs")], side: "bottom", roles: EXEC,
        body: "Applicants move from Applied to Joined, new members tick off the onboarding checklist, and Activity flags who's drifting. Press Import applications to bring in your form.",
      },
      {
        id: "my-onboarding", title: "Recruitment & onboarding", route: "/members", targets: [T("my-onboarding")], side: "right", roles: ["member"],
        body: "Your onboarding checklist for your first weeks in the LC. Tick each item off as you do it.",
      },
      {
        id: "calendar", title: "Calendar", route: "/scheduling", targets: [T("tab:/scheduling")], side: "bottom",
        body: "Meetings, LC events and tabling shifts in one place. Add your availability so meetings fit you.",
      },
      {
        id: "events", title: "Events", route: "/attendance", targets: [T("new-event"), T("page-tabs")], side: "bottom", roles: EXEC,
        body: "Invite a department or a role and tick \"Email the invite\": people answer Going / Not going, and reminders go out by themselves. Press + Event to make one.",
      },
      {
        id: "announcements", title: "Announcements", route: "/attendance", targets: [ACTIONS], side: "bottom", roles: EXEC,
        body: "Email the whole LC, a department or a role at once. Press Announcement to write one.",
      },
      {
        id: "my-events", title: "Events", route: "/attendance", targets: [T("page-tabs")], side: "bottom", roles: ["member"],
        body: "LC events you're invited to, and your attendance. Answer Going or Not going here or from the email.",
      },
      {
        id: "tabling", title: "Tabling", route: "/tabling", targets: [T("new-slot"), T("page-tabs")], side: "bottom", roles: EXEC,
        body: "Shifts at the LC's stand: members sign up and get a reminder the day before, and you mark who came afterwards. Press New slot to add one.",
      },
      {
        id: "my-tabling", title: "Tabling", route: "/tabling", targets: [T("page-tabs")], side: "bottom", roles: ["member"],
        body: "Sign up for a shift at the LC's stand; only shifts you attended count as hours. Pick a free slot in Week.",
      },
    ],
  },
  {
    id: "running", title: "Running the LC", roles: LC,
    summary: "Tasks, Reminders, Planning, Finance, Drive and Handover.",
    steps: [
      {
        id: "tasks", title: "Tasks", route: "/tasks", targets: [T("scope:personal"), ACTIONS, HEADER], side: "right",
        body: "Your department's board, from Backlog to Done; Mine shows your own tasks and anything assigned to you. Press Mine to see yours.",
      },
      {
        id: "reminders", title: "Reminders", route: "/reminders", targets: [T("scope:personal"), ACTIONS, HEADER], side: "right",
        body: "Private to-dos with a date, separate from the shared Tasks board; Mine adds any assigned to you. Add one for something only you need to do.",
      },
      {
        id: "planning", title: "Planning", route: "/plan", targets: [T("tab:/plan")], side: "bottom",
        body: "Who your EB is, where the LC stands and each month's priorities: the plan behind Goals' numbers and the Calendar's dates. Read this month's priorities.",
      },
      {
        id: "routines", title: "Routines", route: "/routines", targets: [T("tab:/routines")], side: "bottom",
        body: "What repeats in your LC and who does it; each one becomes a task a few days before it's due. See which ones are yours.",
      },
      {
        id: "compliance", title: "Membership criteria", route: "/compliance", targets: [T("tab:/compliance")], side: "bottom",
        body: "What your LC needs to keep full-member status, and how it stands today. Check what's still red.",
      },
      {
        id: "finance-claim", title: "Finance", route: "/finance", targets: [T("new-claim"), HEADER], side: "bottom", roles: ["member"],
        body: "Paid for something for the LC? Submit an expense claim with the receipt: press New claim.",
      },
      {
        id: "finance-approve", title: "Finance", route: "/finance", targets: [tab("claims"), T("new-claim"), HEADER], side: "bottom", roles: EXEC,
        body: "Members' expense claims wait under Claims for the VP Finance or the LCP to approve. Open Claims to review them, or add your own.",
      },
      {
        id: "drive", title: "Drive", route: "/drive", targets: [ACTIONS, T("tab:/drive")], side: "bottom",
        body: "Templates, brand kit and the links your LC needs, in one place. Add a link so everyone finds it here.",
      },
      {
        id: "handover", title: "Handover", route: "/handover", targets: [T("tab:/handover")], side: "bottom",
        body: "Each VP leaves notes for the next exec board, one per department per term. Write yours before the term ends.",
      },
    ],
  },
  {
    id: "wellbeing", title: "Wellbeing & privacy", roles: LC,
    summary: "The check-in, the Pulse and getting help.",
    steps: [
      {
        id: "checkin", title: "Check-in", route: "/checkin", targets: [T("checkin-grid")], side: "top",
        body: "Six quick questions every two weeks; leaders only ever see averages, never your answers. Answer them now, it takes a minute.",
      },
      {
        id: "pulse", title: "Pulse", route: "/", targets: [T("pulse")], side: "top", roles: EXEC, optional: true,
        body: "The check-in's averages per department, shown only when enough people answered. Look for drops and start a conversation.",
      },
      {
        id: "settings-wellbeing", title: "Wellbeing settings", route: "/settings", click: tab("wellbeing"), roles: ["president"],
        targets: [T("settings-wellbeing")], side: "right",
        body: "How often the check-in runs and which questions it asks. Turn off any question that doesn't fit your LC.",
      },
      getHelp,
    ],
  },
];

// ── The national view (MC) ──────────────────────────────────────────────────

export const MC_TOUR: TourStep[] = [
  { id: "mc-welcome", title: "The national view", route: "/mc", body: "Every LC in your country, side by side. What you see depends on your role on the MC." },
  { id: "mc-codes", title: "Codes and linking", route: "/mc", targets: [T("mc-codes")], side: "bottom", optional: true, body: "Send the LC code to each LCP so they link their LC; the member code is for your national team. Copy the LC code to start." },
  { id: "mc-by-lc", title: "Goals and pace", route: "/mc", targets: [T("mc-by-lc")], side: "top", optional: true, body: "Each LC's approvals and realizations per product, against the MCP's targets. Export CSV from here." },
  { id: "mc-attention", title: "Needs attention", route: "/mc", targets: [T("mc-attention")], side: "bottom", optional: true, body: "LCs that need a call: no approvals lately, far behind pace, or data that's out of date. Call the first one this week." },
  { id: "mc-funnel", title: "Where LCs lose people", route: "/mc", targets: [T("mc-funnel")], side: "top", optional: true, body: "Applied → Accepted → Approved → Realized → Completed per LC. Coach each LC on its weakest step." },
  { id: "mc-team-numbers", title: "Beyond exchanges", route: "/mc", targets: [T("mc-team-numbers")], side: "top", optional: true, body: "What EXPA can't show, as counts only: members, who's active, handover notes and recruitment." },
  { id: "mc-messages", title: "Messages to LCs", route: "/mc", targets: [T("mc-messages")], side: "top", optional: true, body: "Announcements and reminders that show on LC dashboards. Send one when there's a deadline." },
  { id: "mc-team", title: "Your national team", route: "/mc", targets: [T("mc-team")], side: "top", optional: true, body: "Who's on the MC; the MCP names the VP Finance and hands the MC over at the end of the term." },
  { id: "mc-finance", title: "Finance", route: "/mc", click: tab("finance"), targets: [T("mc-finance")], side: "top", optional: true, body: "For the MCP and VP Finance: every LC's account and university money at a glance. Open an LC for its statement." },
  { id: "mc-ask", title: "Ask", route: "/mc", click: tab("exchanges"), targets: [T("helper")], side: "bottom", body: "Looking for something? Ask in your own words; if the app can't do it yet, it goes to the team as a request." },
  { id: "mc-done", title: "You're set", route: "/mc", body: "That's the national view. Replay this tour from the button at the top of the page." },
];

// ── Choosing steps ──────────────────────────────────────────────────────────

/** Steps this person should see, in order. */
export function stepsFor(steps: TourStep[], ctx: TourContext): TourStep[] {
  return steps.filter((s) => (s.roles ?? LC).includes(ctx.role) && (!s.onMcOnly || ctx.onMc));
}

export function chaptersFor(ctx: TourContext): TourChapter[] {
  return CHAPTERS.filter((c) => c.roles.includes(ctx.role) && stepsFor(c.steps, ctx).length > 0);
}

/** A chapter's steps, ending on the "Pick what to learn next" card. */
export function chapterSteps(id: string, ctx: TourContext): TourStep[] {
  const chapter = CHAPTERS.find((c) => c.id === id);
  return chapter ? [...stepsFor(chapter.steps, ctx), pickNext] : [];
}

const samePage = (a: string, b: string) => a.split("?")[0] === b.split("?")[0];

/** "Show me this page": every step on this page, once each, in chapter order. */
export function pageSteps(pathname: string, ctx: TourContext): TourStep[] {
  if (samePage(pathname, "/mc")) return MC_TOUR;
  const seen = new Set<string>();
  const out: TourStep[] = [];
  for (const s of [...CORE, ...CHAPTERS.flatMap((c) => c.steps)]) {
    if (!s.route || !samePage(s.route, pathname) || !s.targets || seen.has(s.id ?? s.title)) continue;
    seen.add(s.id ?? s.title);
    out.push(s);
  }
  return stepsFor(out, ctx);
}

// ── Progress, per user ──────────────────────────────────────────────────────

const progressKey = (userId: string) => `aiesec_chapters_done:${userId}`;

/** Chapters this person has finished ("core" for the core tour). */
export function readProgress(userId: string | null | undefined): string[] {
  if (!userId) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(progressKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}

export function markDone(userId: string | null | undefined, id: string) {
  if (!userId) return;
  const done = readProgress(userId);
  if (done.includes(id)) return;
  try { localStorage.setItem(progressKey(userId), JSON.stringify([...done, id])); } catch { /* storage blocked */ }
  window.dispatchEvent(new Event("app:tour-progress"));
}
