// What the app can do and where: the helper answers from this list only, so it
// never invents a page. Keep it in step with the app: one entry per thing
// people look for, in the words on the screen. `route` must be a real page;
// `target` is what "Show me" spotlights there (defaults to the page header).

export type GuideRole = "member" | "vp" | "president" | "mc";

export interface GuideEntry {
  id: string;
  title: string;
  /** The page it lives on. */
  route: string;
  /** How to get there, as the screen says it: "People → Recruitment & onboarding". */
  where: string;
  /** One to three short steps once there. */
  how: string[];
  /** Who can do it. Everyone can read every entry; the helper says when it's not for them. */
  roles: GuideRole[];
  keywords: string[];
  target?: string[];
  /** For a tab inside the page: the tab to click first. */
  click?: string;
}

const ALL_LC: GuideRole[] = ["member", "vp", "president"];
const LEADS: GuideRole[] = ["vp", "president"];
const ACTIONS = ['[data-tour="page-actions"]', '[data-tour="page-header"]'];
const tab = (id: string) => `[role="tab"][data-tab="${id}"]`;

export const APP_GUIDE: GuideEntry[] = [
  // ── Everyday ───────────────────────────────────────────────────────────────
  { id: "dashboard", title: "Your dashboard", route: "/", where: "Dashboard", roles: ALL_LC, keywords: ["home", "today", "due", "overview", "this week", "checklist", "getting started"],
    how: ["What's due today, your onboarding checklist and what's coming up. Presidents also get the setup checklist and the Pulse."], target: ["main"] },
  { id: "tasks", title: "Tasks and the department board", route: "/tasks", where: "Tasks", roles: ALL_LC, keywords: ["task", "todo", "board", "kanban", "assign", "backlog", "done", "mine", "deadline"],
    how: ["Add a task with the button at the top; assign people and a due date.", "Use \"Mine\" to see only your tasks and those assigned to you."], target: ACTIONS },
  { id: "tasks-import", title: "Import tasks from a sheet", route: "/tasks", where: "Tasks → Import", roles: LEADS, keywords: ["import tasks", "google sheet", "csv", "spreadsheet"],
    how: ["Tasks → Import, paste the Google Sheets link (shared as Anyone with the link) or upload a CSV, check the columns, Import."], target: ACTIONS },
  { id: "reminders", title: "Personal reminders", route: "/reminders", where: "Reminders", roles: ALL_LC, keywords: ["reminder", "remind me", "private todo", "note to self"],
    how: ["Add a reminder with a date; only you see it unless you share it."], target: ACTIONS },
  { id: "chat", title: "Chat with the LC, a department or a person", route: "/chat", where: "Chat", roles: ALL_LC, keywords: ["chat", "message", "dm", "direct message", "pin", "talk", "channel"],
    how: ["Pick the whole LC, a department or a person on the left. Pin important messages; search old ones."], target: ["main"] },
  { id: "calendar", title: "Calendar and finding a meeting time", route: "/scheduling", where: "Calendar", roles: ALL_LC, keywords: ["calendar", "meeting", "schedule", "availability", "when2meet", "find a time", "google calendar"],
    how: ["Calendar shows meetings, LC events and tabling together.", "Schedule a meeting to find a time that works for everyone."], target: ['nav[aria-label="Calendar"]', '[data-tour="page-header"]'] },
  { id: "events", title: "LC events and email invites", route: "/attendance", where: "Calendar → Events", roles: ALL_LC, keywords: ["event", "invite", "rsvp", "going", "attendance", "who came", "general assembly"],
    how: ["Events → new event: pick who it's for and tick \"Email the invite\". People answer Going / Not going from the email.", "After the event, log who came."], target: ACTIONS },
  { id: "announcement", title: "Email an announcement to the LC", route: "/attendance", where: "Calendar → Events → Announcement", roles: LEADS, keywords: ["announcement", "email everyone", "newsletter", "broadcast", "mass email"],
    how: ["Exec board: Events → Announcement, choose the LC, a department or a role, write it and send."], target: ACTIONS },
  { id: "tabling", title: "Tabling shifts", route: "/tabling", where: "Calendar → Tabling", roles: ALL_LC, keywords: ["tabling", "shift", "booth", "sign up", "volunteer hours", "stand"],
    how: ["VPs create shifts (optionally weekly); members sign up and get a reminder the day before.", "The shift's creator marks who came; only attended shifts count as hours."], target: ACTIONS },
  { id: "people", title: "People directory", route: "/team", where: "People → Directory", roles: ALL_LC, keywords: ["people", "members", "directory", "who is", "contact", "phone", "email", "department", "exec board", "team"],
    how: ["Everyone in your LC by department, with how to reach them."], target: ['nav[aria-label="People"]', '[data-tour="page-header"]'] },
  { id: "recruitment", title: "Recruitment: applicants to members", route: "/members", where: "People → Recruitment & onboarding → Recruitment", roles: LEADS, keywords: ["recruitment", "applicants", "application form", "intake", "new members", "joined", "interview"],
    how: ["Import your application form responses, then move people from Applied to Joined."], click: tab("recruitment") },
  { id: "onboarding", title: "Onboarding checklist for new members", route: "/members", where: "People → Recruitment & onboarding → Onboarding", roles: LEADS, keywords: ["onboarding", "checklist", "new member steps", "induction"],
    how: ["Edit the checklist; new members tick it off from their dashboard."], click: tab("onboarding") },
  { id: "activity", title: "Member activity and term dates", route: "/members", where: "People → Recruitment & onboarding → Activity & terms", roles: LEADS, keywords: ["activity", "inactive", "not seen", "no-show", "term end", "retention", "alumni"],
    how: ["Gentle signals (not seen lately, missed events, no-shows) and each member's term dates."], click: tab("activity") },
  { id: "drive", title: "LC Drive: templates and links", route: "/drive", where: "Drive → Files", roles: ALL_LC, keywords: ["drive", "files", "templates", "brand kit", "logo", "documents", "links", "job description", "folder"],
    how: ["Templates, the brand kit, job descriptions and the links your LC needs."] },
  { id: "handover", title: "Handover notes for the next term", route: "/handover", where: "Drive → Handover", roles: LEADS, keywords: ["handover", "transition", "next term", "successor", "notes for next vp"],
    how: ["Each VP writes notes for their department; the LCP writes the LC-wide one."] },
  { id: "checkin", title: "The check-in", route: "/checkin", where: "Check-in", roles: ALL_LC, keywords: ["check-in", "checkin", "wellbeing", "survey", "how are you", "pulse", "anonymous", "burnout"],
    how: ["Every two weeks, six questions. Leaders only see averages, only when enough people answered."] },
  { id: "pulse", title: "Exec and Member Pulse", route: "/", where: "Dashboard → Pulse", roles: ["president"], keywords: ["pulse", "wellbeing results", "averages", "team mood", "exec pulse"],
    how: ["On the president's dashboard: department averages from the check-in, never anyone's answers."], target: ["main"] },
  { id: "search", title: "Search everything", route: "/", where: "Search (⌘K / Ctrl+K)", roles: ALL_LC, keywords: ["search", "find", "look up", "cmd k", "ctrl k"],
    how: ["Press ⌘K (Ctrl+K) or the search box at the top: tasks, people, partners, exchanges and files."], target: ['button[aria-label="Open search"]'] },
  { id: "get-help", title: "Reach a person for help", route: "/", where: "Get help (lifebuoy in the menu)", roles: ALL_LC, keywords: ["help", "support", "talk to someone", "struggling", "counseling", "mental health", "ask my vp"],
    how: ["Get help lets you reach your VP, your LCP or support resources privately."], target: ['button[aria-label="Get help"]'] },
  { id: "guides", title: "Guides and replaying the tour", route: "/help", where: "Help", roles: ALL_LC, keywords: ["guide", "tutorial", "tour", "how to", "video", "what's new", "release notes"],
    how: ["Short guides per feature, What's new, and Replay the tour."] },

  // ── Exchanges ──────────────────────────────────────────────────────────────
  { id: "pipeline", title: "Exchange pipeline", route: "/pipeline", where: "Pipeline", roles: ALL_LC, keywords: ["pipeline", "exchange", "ogv", "ogta", "ogte", "igv", "igta", "igte", "applicants", "approved", "realized", "stage", "stuck", "conversion", "ep"],
    how: ["Each product has its board, from Sign-up to Completed. Move someone with the arrow or the stage menu.", "\"Stuck\" means applied or accepted 14+ days ago without moving on."], target: ['nav[aria-label="Pipeline"]', '[data-tour="page-header"]'] },
  { id: "pipeline-add", title: "Add or import exchanges", route: "/pipeline", where: "Pipeline → Add exchange / Import exchanges", roles: LEADS, keywords: ["add exchange", "import", "expa export", "tracker", "upload", "google sheet", "bulk"],
    how: ["Add exchange for one person, or Import exchanges to bring your EXPA export or tracker in. Importing again updates instead of duplicating."], target: ACTIONS },
  { id: "expa", title: "Connect EXPA", route: "/pipeline", where: "Pipeline → Connect EXPA", roles: LEADS, keywords: ["expa", "connect expa", "sync", "aiesec.org", "podio"],
    how: ["Pipeline → Connect EXPA, then follow the steps to link your EXPA account."], target: ACTIONS },
  { id: "outreach", title: "Outreach email sequences", route: "/outreach", where: "Pipeline → Outreach", roles: ALL_LC, keywords: ["outreach", "email sequence", "follow up", "sign-ups", "template", "drip", "automatic emails", "nurture"],
    how: ["Templates: write an email with merge fields; your VP, LCP or MC approves it.", "Sequences: pick the stage and the emails for day 0, 3, 7…, then Start and enroll people."] },
  { id: "goals", title: "Term goals", route: "/goals", where: "Pipeline → Goals", roles: ALL_LC, keywords: ["goals", "targets", "kpi", "objectives", "plan", "okr"],
    how: ["Set this term's targets. Exchange goals count themselves from the pipeline."] },
  { id: "partners", title: "Partners and companies", route: "/partners", where: "Partners", roles: LEADS, keywords: ["partner", "company", "b2b", "sponsor", "crm", "organisation", "organization", "follow-up", "contact"],
    how: ["Add a partner or Import your partner tracker; track stage, contacts and follow-ups."], target: ACTIONS },

  // ── Money ──────────────────────────────────────────────────────────────────
  { id: "claim", title: "Submit an expense claim", route: "/finance", where: "Finance → My expense claims → New claim", roles: ALL_LC, keywords: ["expense", "claim", "reimbursement", "receipt", "paid with my money", "refund", "get paid back"],
    how: ["Finance → New claim: amount, what it was for, and a photo of the receipt."], target: ACTIONS },
  { id: "claims-approve", title: "Approve expense claims", route: "/finance", where: "Finance → Claims", roles: ["president", "mc"], keywords: ["approve claim", "pending claims", "reject claim", "reimburse"],
    how: ["Finance → Claims: approve or reject each pending claim. Approved claims show in the ledger."], click: tab("claims") },
  { id: "ledger", title: "The LC account (ledger and balance)", route: "/finance", where: "Finance → Overview & ledger", roles: LEADS, keywords: ["balance", "ledger", "budget", "money", "account", "bank", "income", "spending", "finance", "transactions", "how much money"],
    how: ["The president and VPs read the LC account here. Your MC's VP Finance keeps it, as in the National Finance Tracker."], click: tab("ledger") },
  { id: "university-money", title: "University money", route: "/finance", where: "Finance → University money", roles: LEADS, keywords: ["university money", "university funding", "student government", "grant", "school funds", "university account"],
    how: ["Optional: the LC's finance lead turns it on in Finance → University money, then records it as its own account."], click: tab("university") },

  // ── Setup ──────────────────────────────────────────────────────────────────
  { id: "invite", title: "Invite people to your LC", route: "/settings", where: "Settings → Invites", roles: ["president"], keywords: ["invite", "add member", "invite link", "join code", "onboard people", "add vp"],
    how: ["Settings → Invites: send an invite link, or copy the code. Each person gets their own link."], click: tab("invites") },
  { id: "departments", title: "Departments and VPs", route: "/settings", where: "Settings → LC & departments", roles: ["president"], keywords: ["department", "vp", "create department", "roles", "exec board", "products"],
    how: ["Settings → LC & departments: create departments, pick each one's VP and its exchange products."], click: tab("lc") },
  { id: "lc-settings", title: "LC name, country, currency and term dates", route: "/settings", where: "Settings → LC & departments → LC settings", roles: ["president"], keywords: ["lc name", "rename lc", "country", "currency", "term dates", "term start", "university"],
    how: ["Settings → LC & departments, then LC settings: name, university, country, currency and term dates."], click: tab("lc") },
  { id: "link-mc", title: "Link your LC to your MC", route: "/settings", where: "Settings → LC & departments → National (MC)", roles: ["president"], keywords: ["link mc", "lc code", "national", "mc code", "connect to mc", "member committee"],
    how: ["Paste the LC code your MCP sent you and press Link. Your MC then sees your numbers (never names)."], click: tab("lc") },
  { id: "notifications", title: "Email and notification settings", route: "/settings", where: "Settings → Notifications", roles: ALL_LC, keywords: ["notifications", "emails", "too many emails", "unsubscribe", "digest", "monday email", "mute"],
    how: ["Settings → Notifications: everything, the Monday digest only, or only important emails."], click: tab("notifications") },
  { id: "profile", title: "Your profile, photo and theme", route: "/settings", where: "Settings → Profile", roles: ALL_LC, keywords: ["profile", "photo", "avatar", "name", "dark mode", "theme", "light mode", "pronouns", "password"],
    how: ["Settings → Profile: your name, photo and the light/dark theme."], click: tab("profile") },
  { id: "switch-lc", title: "Switch LC or create another", route: "/", where: "LC switcher (top of the menu)", roles: ALL_LC, keywords: ["switch lc", "another lc", "workspace", "create lc", "join another lc", "change lc"],
    how: ["Open the LC switcher at the top of the menu to switch, create or join another LC."], target: ['button[aria-label="Switch workspace"]'] },

  // ── National (MC) ──────────────────────────────────────────────────────────
  { id: "mc-join", title: "Join or set up your MC", route: "/mc", where: "National (MC)", roles: ["mc", "president"], keywords: ["mc", "national", "member committee", "join mc", "create mc", "member code", "mcp"],
    how: ["Join with the member code from your MCP, or (MCP) set up your MC by picking your country."] },
  { id: "mc-codes", title: "MC codes and linking LCs", route: "/mc", where: "National → Codes / LCs", roles: ["mc"], keywords: ["lc code", "member code", "link lcs", "invite lcs", "not linked", "copy code", "new member code"],
    how: ["Send the LC code to each LCP; the member code is for your national team. The LCs panel shows who hasn't linked, with a reminder to copy."], target: ['[data-tour="mc-codes"]'] },
  { id: "mc-goals", title: "National targets and pace per LC", route: "/mc", where: "National → By LC", roles: ["mc"], keywords: ["national targets", "lc targets", "pace", "on track", "behind", "set goals for lcs", "csv"],
    how: ["The MCP sets each LC's targets per product; each LC shows whether it's on track. Export CSV from the same panel."], target: ['[data-tour="mc-by-lc"]'] },
  { id: "mc-attention", title: "LCs that need attention", route: "/mc", where: "National → Needs attention", roles: ["mc"], keywords: ["needs attention", "struggling lcs", "behind", "no approvals", "stale data", "alerts"],
    how: ["LCs with no approvals lately, approvals not realizing, far behind pace, or data not updated."], target: ['[data-tour="mc-attention"]', '[data-tour="mc-by-lc"]'] },
  { id: "mc-funnel", title: "Where each LC loses people (funnel)", route: "/mc", where: "National → Where each LC loses people", roles: ["mc"], keywords: ["funnel", "conversion", "coach", "drop off", "applied to approved"],
    how: ["Applied → Accepted → Approved → Realized → Completed per LC, and the step to coach on."], target: ['[data-tour="mc-funnel"]'] },
  { id: "mc-team-numbers", title: "LC team numbers (members, activity, handover)", route: "/mc", where: "National → Beyond exchanges", roles: ["mc"], keywords: ["lc members", "membership", "active members", "retention", "handover notes", "recruitment numbers"],
    how: ["Counts only: members, who's active, handover notes and recruitment per LC."], target: ['[data-tour="mc-team-numbers"]'] },
  { id: "mc-messages", title: "Send a message to LCs", route: "/mc", where: "National → Messages to LCs", roles: ["mc"], keywords: ["message lcs", "announcement to lcs", "remind lcs", "broadcast", "communicate with lcps"],
    how: ["Write an announcement or reminder; it shows on the LCs' dashboards."], target: ['[data-tour="mc-messages"]'] },
  { id: "mc-team", title: "The national team, VP Finance and MCP handover", route: "/mc", where: "National → National team", roles: ["mc"], keywords: ["mc team", "vp finance", "hand over", "handover mcp", "next mcp", "transfer", "remove member", "leave mc"],
    how: ["The MCP names the VP Finance and, at term end, chooses Make MCP next to the next MCP; they accept and take over."], target: ['[data-tour="mc-team"]'] },
  { id: "mc-finance", title: "National finance: every LC's account", route: "/mc", where: "National → Finance", roles: ["mc"], keywords: ["national finance", "finance tracker", "lc balances", "every lc", "all lcs", "each lc", "vp finance", "statement", "account statement", "university money", "review lc finance"],
    how: ["MCP and VP Finance: every LC's balance at a glance; open an LC for its statement. The VP Finance adds transactions and marks LCs reviewed."], click: tab("finance"), target: ['[data-tour="mc-finance"]'] },
];

const byId = new Map(APP_GUIDE.map((e) => [e.id, e]));
export const guideEntry = (id: string) => byId.get(id) ?? null;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["a", "an", "the", "i", "do", "how", "can", "where", "is", "to", "my", "of", "in", "on", "for", "and", "it", "what", "be", "find", "want", "need", "there", "way", "app", "add", "see", "get", "with", "we", "our", "me", "you", "your", "this", "that", "does", "have", "any", "s", "or"]);

/**
 * Keyword match, used when no AI is configured and to give the AI a shortlist.
 * Scores whole keyword phrases highest, then title words.
 */
export function searchGuide(question: string, limit = 5, role: GuideRole | null = null): { entry: GuideEntry; score: number }[] {
  const q = ` ${norm(question)} `;
  const words = norm(question).split(" ").filter((w) => w.length > 1 && !STOP.has(w));
  if (words.length === 0) return [];
  return APP_GUIDE.map((entry) => {
    let score = 0;
    for (const k of entry.keywords) {
      const nk = norm(k);
      if (q.includes(` ${nk} `)) score += nk.includes(" ") ? 6 : 4;
      else if (nk.length > 3 && words.some((w) => w.length > 3 && (nk.startsWith(w) || w.startsWith(nk)))) score += 1.5;
    }
    const title = norm(entry.title);
    for (const w of words) if (` ${title} `.includes(` ${w} `)) score += 2;
    // What the asker can use comes first (an MC member asking about balances means the national view).
    if (score > 0 && role && entry.roles.includes(role)) score += 2;
    return { entry, score };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/** A confident keyword answer (no AI): the top hit, clearly ahead. */
export function keywordAnswer(question: string, role: GuideRole | null = null): GuideEntry | null {
  const [top, second] = searchGuide(question, 2, role);
  if (!top || top.score < 4) return null;
  if (second && second.score >= top.score && second.entry.route !== top.entry.route) return top.score >= 6 ? top.entry : null;
  return top.entry;
}
