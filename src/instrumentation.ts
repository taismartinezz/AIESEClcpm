import { envReport } from "@/lib/env-check";

// Runs once when the server starts: name every missing environment variable
// in the logs (Vercel → your project → Logs) instead of failing silently.
export function register() {
  if (process.env.NODE_ENV === "test") return;
  const lines = envReport();
  if (lines.length === 0) {
    console.info("[config] All environment variables are set.");
    return;
  }
  for (const line of lines) console.warn(line);
}
