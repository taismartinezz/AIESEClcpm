// Which environment variables are set, and what breaks without each one.
// Logged once when the server starts (src/instrumentation.ts) so a missing
// variable is named in the Vercel logs instead of failing silently.

export interface EnvVar { name: string; required: boolean; effect: string; publicVar?: boolean }

export const ENV_VARS: EnvVar[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", required: true, publicVar: true, effect: "the app runs in PREVIEW MODE with sample data instead of your database" },
  { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", required: true, publicVar: true, effect: "the app runs in PREVIEW MODE with sample data instead of your database (NEXT_PUBLIC_SUPABASE_ANON_KEY also works)" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", required: true, effect: "invites, event invites, announcements, reminders and the weekly digest can't be sent" },
  { name: "NEXT_PUBLIC_APP_URL", required: true, publicVar: true, effect: "invite links point to http://localhost:3000" },
  { name: "APP_URL", required: true, effect: "links in emails point to http://localhost:3000" },
  { name: "CRON_SECRET", required: true, effect: "the reminder job (/api/cron/notify) refuses to run, so no reminders or digests" },
  { name: "RSVP_SECRET", required: false, effect: "Going / Not going and unsubscribe links in emails fall back to INTERNAL_API_SECRET, and fail if that is missing too" },
  { name: "INTERNAL_API_SECRET", required: false, effect: "server-to-server email calls are refused" },
  { name: "RESEND_API_KEY", required: false, effect: "emails are only written to the server log, never delivered" },
  { name: "EMAIL_FROM", required: false, effect: "emails are sent from notifications@example.com, which Resend will reject" },
];

const present = (name: string, env: Record<string, string | undefined>) =>
  Boolean(env[name]?.trim()) || (name === "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()));

export function missingEnv(env: Record<string, string | undefined> = process.env): EnvVar[] {
  return ENV_VARS.filter((v) => !present(v.name, env));
}

export function envReport(env: Record<string, string | undefined> = process.env): string[] {
  return missingEnv(env).map((v) =>
    `[config] ${v.required ? "MISSING" : "Not set"}: ${v.name}. Without it ${v.effect}.${v.publicVar ? " (Starts with NEXT_PUBLIC_: redeploy after adding it.)" : ""}`);
}
