import { APP_NAME } from "@/lib/brand";

// The guided tour, per role. Each step can open a page (`route`), click
// something first (`click`, e.g. a tab), and spotlight the first visible
// element among `targets`. A step whose targets aren't there for this person
// (a button only some roles have) is skipped when `optional`, or shown as a
// centred card otherwise. Keep the text short: one idea per step, in the words
// on the screen.

export type TourRole = "president" | "vp" | "member" | "mc";

export interface TourStep {
  title: string;
  body: string;
  /** Page to open first. */
  route?: string;
  /** Selectors to spotlight, first visible one wins. None = centred card. */
  targets?: string[];
  /** Selector to click before spotlighting (a tab, say). */
  click?: string;
  /** Skip this step when none of its targets is on the page. */
  optional?: boolean;
  side?: "right" | "left" | "bottom" | "top";
}

const HEADER = '[data-tour="page-header"]';
const ACTIONS = '[data-tour="page-actions"]';
const nav = (href: string) => `aside a[href="${href}"], nav a[href="${href}"]`;
const tabs = (label: string) => `nav[aria-label="${label}"]`;

// ── Shared stops ─────────────────────────────────────────────────────────────

const search: TourStep = {
  title: "Search everything", targets: ['button[aria-label="Open search"]'], side: "bottom",
  body: "Tasks, people, partners, exchanges and files from one box. Press ⌘K (Ctrl+K on Windows) from any page.",
};
const helper: TourStep = {
  title: "Ask the helper", targets: ['[data-tour="helper"]'], side: "bottom", optional: true,
  body: "Can't find something? Ask in your own words (\"where do I add a partner?\") and it takes you there. If the app can't do it yet, your question goes to the team as a feature request.",
};
const notifications: TourStep = {
  title: "Notifications", targets: ['button[aria-label^="Notifications"]'], side: "bottom",
  body: "Assignments, mentions, approvals and reminders. Choose how much email you get in Settings → Notifications.",
};
const getHelp: TourStep = {
  title: "Get help from a person", targets: ['button[aria-label="Get help"]'], side: "right",
  body: "Stuck or having a hard time? Reach your VP, your LCP or support resources privately from here.",
};
const checkin: TourStep = {
  title: "Check-in", route: "/checkin", targets: [HEADER], side: "bottom",
  body: "Every two weeks, six questions, about a minute. Leaders only ever see averages, and only when enough people answered. Nobody sees whether you did it.",
};
const calendar: TourStep = {
  title: "Calendar", route: "/scheduling", targets: [tabs("Calendar"), HEADER], side: "bottom",
  body: "Meetings, LC events and tabling shifts in one place. Events and Tabling are tabs: sign up for a shift and you get a reminder the day before.",
};
const chat: TourStep = {
  title: "Chat", route: "/chat", targets: ["main", HEADER], side: "left",
  body: "Talk with the whole LC, your department or one person. Pin what matters; search old messages.",
};
const drive: TourStep = {
  title: "Drive and handover", route: "/drive", targets: [tabs("Drive"), HEADER], side: "bottom",
  body: "Templates, brand kit and the links your LC needs. The Handover tab is where each VP leaves notes for the next term.",
};
const settings: TourStep = {
  title: "Settings and your profile", targets: ['button[aria-label="Profile menu"]'], side: "bottom",
  body: "Your profile, notifications and theme live here. You can replay this tour any time from Help or Settings.",
};
const national: TourStep = {
  title: "National (MC)", targets: [nav("/mc")], optional: true,
  body: "You're also on your MC's national team: this opens the national view, with its own tour.",
};
const done = (route: string, body: string): TourStep => ({ title: "You're set", route, body });

// ── Per role ─────────────────────────────────────────────────────────────────

export const TOURS: Record<TourRole, TourStep[]> = {
  member: [
    { title: `Welcome to ${APP_NAME}`, route: "/", body: "Your LC's workspace. This tour opens each part you'll use, about a minute in all. Use the arrow keys or the buttons; you can skip any time." },
    { title: "Your dashboard", route: "/", targets: ["main"], side: "left", body: "What's due today, your onboarding checklist, the check-in when it opens, and what's coming up in the LC." },
    { title: "Tasks", route: "/tasks", targets: [ACTIONS, HEADER], side: "bottom", body: "Your department's work, from Backlog to Done. \"Mine\" shows your own tasks and anything assigned to you." },
    { title: "Reminders", route: "/reminders", targets: [ACTIONS, HEADER], side: "bottom", body: "Private to-dos with a date. Only you see them unless you share one." },
    calendar,
    chat,
    { title: "People", route: "/team", targets: [tabs("People"), HEADER], side: "bottom", body: "Who's who in your LC by department, how to reach them, and your onboarding." },
    drive,
    checkin,
    search, helper, notifications, getHelp, settings, national,
    done("/", "That's the tour. Replay it from Help any time, or ask the helper when you're looking for something."),
  ],
  vp: [
    { title: `Welcome to ${APP_NAME}`, route: "/", body: "Everything for running your department. This tour opens each page you'll use, about two minutes in all." },
    { title: "This week", route: "/", targets: ["main"], side: "left", body: "Every Monday: your departments' approvals against last week, stuck exchanges and overdue tasks." },
    { title: "Pipeline", route: "/pipeline", targets: [tabs("Pipeline"), HEADER], side: "bottom", body: "Every exchange per product (oGV, oGTa, iGV…), from Sign-up to Completed. Outreach and Goals are tabs here." },
    { title: "Bring your trackers in", route: "/pipeline", targets: [ACTIONS], side: "bottom", optional: true, body: "Import your EXPA export or Google Sheet in one go, or add an exchange by hand. Importing again updates instead of duplicating." },
    { title: "Outreach", route: "/outreach", targets: [HEADER], side: "bottom", body: "Approved email sequences for sign-ups. They stop when someone applies, unsubscribes, or you mark that they replied." },
    { title: "Goals", route: "/goals", targets: [HEADER], side: "bottom", body: "This term's targets. Exchange goals count themselves from the pipeline." },
    { title: "Partners", route: "/partners", targets: [ACTIONS, HEADER], side: "bottom", body: "Companies and organisations you work with: stage, contacts and follow-ups." },
    { title: "Tasks", route: "/tasks", targets: [ACTIONS, HEADER], side: "bottom", body: "Your department's board. Assign people, set dates, and import tasks from a sheet." },
    { title: "People", route: "/team", targets: [tabs("People"), HEADER], side: "bottom", body: "Your department's members. Recruitment & onboarding is a tab: move applicants to Joined and keep the onboarding checklist." },
    calendar,
    { title: "Finance", route: "/finance", targets: [HEADER], side: "bottom", body: "Submit expense claims with a receipt. If you lead Finance, you also see the LC account and, if your university funds the LC, its university money." },
    chat, drive, checkin,
    search, helper, notifications, getHelp, settings, national,
    done("/", "That's the tour. Replay it from Help any time, or ask the helper when you're looking for something."),
  ],
  president: [
    { title: `Welcome to ${APP_NAME}`, route: "/", body: "Set up and run your LC. This tour opens every part of the app, about three minutes in all. The checklist on your dashboard walks you through setup." },
    { title: "Your dashboard", route: "/", targets: ["main"], side: "left", body: "This week's numbers, the getting-started checklist, the Exec and Member Pulse, and anything your MC sends." },
    { title: "Settings: your LC", route: "/settings", targets: [HEADER], side: "bottom", body: "Departments and their VPs, invites, term dates, currency, and linking your LC to your MC (LC & departments → National (MC))." },
    { title: "Pipeline", route: "/pipeline", targets: [tabs("Pipeline"), HEADER], side: "bottom", body: "Every exchange per product, with this term's approvals, realizations and conversion. Outreach and Goals are tabs." },
    { title: "Import your trackers", route: "/pipeline", targets: [ACTIONS], side: "bottom", optional: true, body: "Pipeline, Partners, People and Tasks each have Import: paste a Google Sheets link or your EXPA export." },
    { title: "Goals", route: "/goals", targets: [HEADER], side: "bottom", body: "Set this term's targets. Exchange goals count themselves; your MC may set national targets too." },
    { title: "Partners", route: "/partners", targets: [ACTIONS, HEADER], side: "bottom", body: "Every company and organisation the LC works with, with stage and follow-ups." },
    { title: "People", route: "/team", targets: [tabs("People"), HEADER], side: "bottom", body: "Your exec board and departments. Recruitment & onboarding has applicants, the onboarding checklist and gentle activity signals." },
    { title: "Tasks", route: "/tasks", targets: [ACTIONS, HEADER], side: "bottom", body: "Every department's board. Filter by department, or \"Mine\"." },
    calendar,
    { title: "Finance", route: "/finance", targets: [HEADER], side: "bottom", body: "Approve expense claims and read the LC account your MC VP Finance keeps. If your university funds the LC, turn on University money and keep it here." },
    chat, drive,
    { title: "Check-in and the Pulse", route: "/checkin", targets: [HEADER], side: "bottom", body: "Members answer every two weeks; you see department averages on the dashboard, never anyone's answers." },
    search, helper, notifications, getHelp, settings, national,
    done("/", "That's the tour. Replay it from Help any time, or ask the helper when you're looking for something."),
  ],
  mc: [
    { title: "The national view", route: "/mc", body: "Every LC in your country, side by side. This tour walks through it, about two minutes. What you see depends on your role on the MC." },
    { title: "Codes and linking", route: "/mc", targets: ['[data-tour="mc-codes"]'], side: "bottom", optional: true, body: "Send the LC code to each LCP so they link their LC; the member code is for your national team. The LC list shows who hasn't linked yet, with a reminder you can copy." },
    { title: "Goals and pace", route: "/mc", targets: ['[data-tour="mc-by-lc"]'], side: "top", optional: true, body: "Each LC's approvals and realizations per product. The MCP sets targets; each LC shows whether it's on track for this point in the term. Export CSV from here." },
    { title: "Needs attention", route: "/mc", targets: ['[data-tour="mc-attention"]'], side: "bottom", optional: true, body: "LCs that need a call: no approvals lately, approvals not turning into realizations, far behind pace, or data that hasn't been updated." },
    { title: "Where LCs lose people", route: "/mc", targets: ['[data-tour="mc-funnel"]'], side: "top", optional: true, body: "Applied → Accepted → Approved → Realized → Completed per LC, and the step to coach each LC on." },
    { title: "Beyond exchanges", route: "/mc", targets: ['[data-tour="mc-team-numbers"]'], side: "top", optional: true, body: "What EXPA can't show, as counts only: members, who's active, handover notes and recruitment." },
    { title: "Messages to LCs", route: "/mc", targets: ['[data-tour="mc-messages"]'], side: "top", optional: true, body: "Announcements and reminders that show on LC dashboards. You also get a Monday email with last week and what needs attention." },
    { title: "Your national team", route: "/mc", targets: ['[data-tour="mc-team"]'], side: "top", optional: true, body: "Who's on the MC. The MCP names the VP Finance and, at the end of the term, hands the MC over to the next MCP here." },
    { title: "Finance", route: "/mc", click: '[role="tab"][data-tab="finance"]', targets: ['[data-tour="mc-finance"]'], side: "top", optional: true, body: "For the MCP and VP Finance: every LC's account and university money at a glance. Open an LC for its statement; the VP Finance keeps the books there." },
    { title: "Ask the helper", route: "/mc", click: '[role="tab"][data-tab="exchanges"]', targets: ['[data-tour="helper"]'], side: "bottom", optional: true, body: "Looking for something? Ask in your own words. If it isn't in the app yet, your question goes to the team as a request." },
    done("/mc", "That's the national view. Replay this tour from the button at the top of the page."),
  ],
};
