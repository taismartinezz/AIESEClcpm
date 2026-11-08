// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser } from "./fixtures";

let db: PGlite;
const u: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["ana", "bo"]) u[n] = await createUser(db, n);
  await db.query("insert into google_connections (user_id, google_email, access_token, scope) values ($1, 'ana@gmail.com', 'secret', 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events')", [u.ana]);
  await db.query("insert into google_connections (user_id, google_email, access_token, scope) values ($1, 'bo@gmail.com', 'secret', 'https://www.googleapis.com/auth/calendar.readonly')", [u.bo]);
  await db.query("insert into google_event_links (user_id, event_id, google_event_id) values ($1, gen_random_uuid(), 'g1')", [u.ana]);
}, 60_000);

describe("LC events in Google Calendar", () => {
  it("the status says whether the connection may add events, and the switch starts on", async () => {
    const status = (who: string) => asUser(db, u[who], async (tx) => (await tx.query<{ can_add_events: boolean; add_events: boolean }>("select can_add_events, add_events from google_calendar_status()")).rows[0]);
    expect(await status("ana")).toEqual({ can_add_events: true, add_events: true });
    expect(await status("bo")).toEqual({ can_add_events: false, add_events: true });      // read-only: reconnect
  });

  it("links between LC and Google events are for the server only", async () => {
    await expect(asUser(db, u.ana, (tx) => tx.query("select * from google_event_links"))).rejects.toThrow(/permission denied/);
  });
});
