// Help content and release notes. Videos are short (30–60 s) screen recordings;
// paste a Loom / YouTube / Drive link into `video` when one exists.

export interface HelpTopic {
  id: string;
  title: string;
  /** Roles this topic matters to most; everyone can read every topic. */
  forRoles: ("president" | "vp" | "member" | "mc")[];
  steps: string[];
  video: string;
}

export const HELP_TOPICS: HelpTopic[] = [
  {
    id: "start", title: "Setting up your LC", forRoles: ["president"], video: "",
    steps: [
      "Settings → Departments: create your departments (oGX, oGV, Marketing…) or use the suggestions, pick each one's VP and exchange products.",
      "Settings → Invite: send your VPs and members an invite link.",
      "Import: paste the link of your Google Sheets trackers.",
      "Goals: set this term's targets. Exchange goals count themselves from the pipeline.",
    ],
  },
  {
    id: "import", title: "Importing a Google Sheet", forRoles: ["president", "vp"], video: "",
    steps: [
      "Open the sheet, pick the tab with the data. The first row must be the column names.",
      "Share → General access → Anyone with the link (Viewer). Or File → Download → CSV.",
      "In the app: Import → choose what the sheet contains → paste the link → Load.",
      "Check the guessed columns, then Import. Importing again later updates instead of duplicating.",
    ],
  },
  {
    id: "pipeline", title: "The exchange pipeline", forRoles: ["president", "vp", "member"], video: "",
    steps: [
      "Each product (oGV, oGTa, iGV…) has its own board, from Sign-up to Completed.",
      "Move someone with the arrow or the stage menu; the date each stage was reached is saved.",
      "The numbers on top are this term: approved, realized, and conversion from application to approval.",
      "\"Stuck\" means applied or accepted 14+ days ago without moving on.",
    ],
  },
  {
    id: "checkin", title: "Check-in and privacy", forRoles: ["vp", "member"], video: "",
    steps: [
      "Every two weeks, six questions, about a minute.",
      "Your VP and LCP only see averages, and only when enough people answered.",
      "Nobody can see whether you did the check-in, or your answers.",
    ],
  },
  {
    id: "members", title: "Members: recruitment, onboarding, activity", forRoles: ["president", "vp"], video: "",
    steps: [
      "Recruitment: import your application form responses and move people from Applied to Joined.",
      "Onboarding: edit the checklist; new members tick it off from their dashboard.",
      "Activity: gentle signals (not seen lately, missed events, no-shows) to start a conversation.",
    ],
  },
  {
    id: "tabling", title: "Tabling and events", forRoles: ["vp", "member"], video: "",
    steps: [
      "VPs create shifts (optionally every week); members sign up and get a reminder the day before.",
      "After the shift, its creator marks who came. Only attended shifts count as hours.",
      "Attendance: log who came to LC events.",
    ],
  },
  {
    id: "emails", title: "Events, invites and emails", forRoles: ["president", "vp", "member"], video: "",
    steps: [
      "Events → new event: pick who it's for and tick \"Email the invite\". People answer Going / Not going from the email.",
      "Reminders go out 24 h and 1 h before, except to people who said no.",
      "Settings → Notifications: everything, the Monday digest only, or only important emails.",
      "Exec board: Events → Announcement to email the LC, a department or a role.",
    ],
  },
  {
    id: "outreach", title: "oGX outreach sequences", forRoles: ["president", "vp", "member"], video: "",
    steps: [
      "Outreach → Templates: write an email with merge fields like {first_name}; your VP, LCP or MC approves it.",
      "Sequences: choose the stage (e.g. sign-ups) and which template goes out on day 0, 3, 7…, then Start.",
      "Enroll people who signed up and agreed to be contacted. Emails go out from your name; replies come to you.",
      "It stops when they move stage, unsubscribe, or you press \"They replied\" on their card. Results compare sequences.",
    ],
  },
  {
    id: "national", title: "The national view (MC)", forRoles: ["mc", "president"], video: "",
    steps: [
      "MCP: go to National, create the MC and share the LC code with LC presidents.",
      "LCP: Settings → National (MC) → paste the LC code.",
      "The MC sees counts per LC and product only, never names or wellbeing data.",
    ],
  },
];

export interface Release { id: string; date: string; title: string; items: string[] }

/** Newest first. Bump the first id to show "What's new" again. */
export const RELEASES: Release[] = [
  {
    id: "2026-10-simpler", date: "2026-10-21", title: "A simpler menu",
    items: [
      "Calendar now holds meetings, LC events and tabling shifts, with filters; Events and Tabling are tabs inside it.",
      "People is Team and Members together. Pipeline has Outreach and Goals as tabs; Drive has Handover.",
      "Import lives on each page (Pipeline, Partners, People, Tasks). The Journal is gone; the Check-in stays.",
      "Tasks and Reminders have a \"Mine\" filter: your private items plus anything assigned to you.",
    ],
  },
  {
    id: "2026-10-emails", date: "2026-10-21", title: "Emails, invites and outreach",
    items: [
      "Events: invite a department, a role or chosen people; they answer Going / Not going from the email and get reminders.",
      "Choose how much email you get in Settings: everything, the Monday digest, or only what's important.",
      "Outreach: approved email sequences for oGX sign-ups that stop when someone applies or replies.",
      "Tasks open on your own department; the Member Pulse also shows Outgoing, Incoming and Support.",
    ],
  },
  {
    id: "2026-10-tutorial", date: "2026-10-19", title: "Import, Members and a national view",
    items: [
      "Import your Google Sheets trackers: exchanges, partners, tasks and recruitment.",
      "Members: recruitment intake, onboarding checklists, term dates and activity signals.",
      "National (MC): every LC's approvals and realizations side by side.",
      "A getting-started checklist and a demo LC to explore safely.",
    ],
  },
  {
    id: "2026-10-pipeline", date: "2026-10-18", title: "A pipeline worth checking on Monday",
    items: [
      "New Completed stage, term numbers and conversion rates per product.",
      "Import from EXPA, and a This week card on the dashboard.",
    ],
  },
];
