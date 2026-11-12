import type { UserRole } from "@/types";

// The side menu, in order. AppShell adds the icons. Every item here (and every
// tab in SectionTabs, and every top-bar control below) needs a tour step: a
// unit test checks, so a new page can't ship without one.
export const NAV_ITEMS: { href: string; label: string }[] = [
  { href: "/",           label: "Dashboard" },
  { href: "/tasks",      label: "Tasks" },
  { href: "/chat",       label: "Chat" },
  { href: "/reminders",  label: "Reminders" },
  // Calendar = Scheduling + Events + Tabling, People = Team + Members, Pipeline = Pipeline +
  // Outreach + Goals, Drive = Files + Handover: one menu item each, tabs inside (SectionTabs).
  { href: "/scheduling", label: "Calendar" },
  { href: "/pipeline",   label: "Pipeline" },
  { href: "/partners",   label: "Partners" },
  { href: "/team",       label: "People" },
  { href: "/finance",    label: "Finance" },
  { href: "/drive",      label: "Drive" },
  { href: "/checkin",    label: "Check-in" },
  // Planning = the LC plan + Routines + Membership criteria (from the LC planning template).
  { href: "/plan",       label: "Planning" },
  { href: "/mc",         label: "National (MC)" },
];

/**
 * What each role sees first; everything else sits under "More" (folded until
 * opened, or while you're on one of its pages). A member gets their own day to
 * day, a VP adds the department's tools, the president the LC-wide ones.
 */
export const PRIMARY: Record<UserRole, string[]> = {
  member:    ["/", "/tasks", "/chat", "/reminders", "/scheduling", "/team", "/drive", "/checkin"],
  vp:        ["/", "/tasks", "/chat", "/reminders", "/scheduling", "/pipeline", "/partners", "/team", "/finance", "/plan", "/drive", "/checkin"],
  president: ["/", "/tasks", "/chat", "/reminders", "/scheduling", "/pipeline", "/partners", "/team", "/finance", "/plan", "/drive", "/checkin"],
};

// National is in the main list for MC members only. Chat is primary for every role.
export const NOT_IN_MORE = ["/mc"];

/** The top bar's and the menu's own controls, by their data-tour anchor. */
export const SHELL_CONTROLS = ["helper", "search", "chat", "notifications", "account", "get-help"];
