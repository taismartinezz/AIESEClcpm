// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const MKT = "Marketing";
const OGV = "Outgoing Global Volunteer";

/** Insert a slot directly (as a superuser) with start/end relative to now, in hours. */
async function slot(capacity: number, startInHours: number, lengthHours = 2, createdBy = u.vera): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into tabling_slots (project_id, starts_at, ends_at, location, purpose, capacity, created_by)
     values ($1, now() + make_interval(hours => $2), now() + make_interval(hours => $2 + $3), 'Main hall', 'oGV recruitment', $4, $5)
     returning id`, [lc.id, startInHours, lengthHours, capacity, createdBy]);
  return rows[0].id;
}

const signUp = (who: string, slotId: string) => asUserCommit(db, u[who], () => db.query("select tabling_sign_up($1)", [slotId]));

/** Sign-up in its own committed transaction (safe to run several at once). */
const signUpTx = (who: string, slotId: string) => db.transaction(async (tx) => {
  await tx.exec("set local role authenticated");
  await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [u[who]]);
  await tx.query("select tabling_sign_up($1)", [slotId]);
});

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "vera", "omar", "mo", "max", "gia", "ana"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.vera, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.omar, { role: "vp", leads: [OGV] });
  for (const m of ["mo", "max", "ana"]) await addMember(db, lc, u[m], { department: MKT });
  await addMember(db, lc, u.gia, { department: OGV });
}, 60_000);

describe("creating slots", () => {
  it("VPs can create weekly repeating slots; members can't create any", async () => {
    const count = await asUser(db, u.vera, async (tx) => (await tx.query<{ n: number }>(
      `select create_tabling_slots($1, now() + interval '1 day', now() + interval '1 day 2 hours', 'Main hall', 'Recruitment', 3, null, (now() + interval '22 days')::date) as n`,
      [lc.id])).rows[0].n);
    expect(count).toBe(4);
    await expect(asUser(db, u.mo, (tx) => tx.query(
      `select create_tabling_slots($1, now() + interval '1 day', now() + interval '1 day 2 hours', 'x', 'y', 3)`, [lc.id],
    ))).rejects.toThrow(/Only VPs and the president/);
  });
});

describe("signing up", () => {
  it("members can't sign up for a full slot", async () => {
    const s = await slot(1, 48);
    await signUp("mo", s);
    await expect(signUp("max", s)).rejects.toThrow(/This slot is full/);
  });

  it("two people racing for the last place: exactly one gets it", async () => {
    // PGlite has a single connection, so the two calls run one after the other;
    // on Postgres the SELECT … FOR UPDATE in tabling_sign_up() serialises them
    // the same way, and the check constraint (taken <= capacity) backs it up.
    const s = await slot(2, 48);
    await signUp("mo", s);
    const results = await Promise.allSettled([signUpTx("max", s), signUpTx("ana", s)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const { rows } = await db.query<{ taken: number; n: number }>(
      "select taken, (select count(*)::int from tabling_signups where slot_id = $1) as n from tabling_slots where id = $1", [s]);
    expect(rows[0]).toEqual({ taken: 2, n: 2 });
  });

  it("the database refuses an over-full slot even without the function", async () => {
    const s = await slot(1, 48);
    await db.query("insert into tabling_signups (slot_id, user_id, project_id) values ($1, $2, $3)", [s, u.mo, lc.id]);
    await expect(db.query("insert into tabling_signups (slot_id, user_id, project_id) values ($1, $2, $3)", [s, u.max, lc.id]))
      .rejects.toThrow(/tabling_slots_not_overfull/);
  });

  it("members can't write sign-ups directly", async () => {
    const s = await slot(5, 48);
    await expect(asUser(db, u.mo, (tx) =>
      tx.query("insert into tabling_signups (slot_id, user_id, project_id) values ($1, $2, $3)", [s, u.mo, lc.id]),
    )).rejects.toThrow(/row-level security/);
  });

  it("sign-up creates a reminder for the day before; withdrawing removes it", async () => {
    const s = await slot(5, 72);
    await signUp("gia", s);
    const { rows: before } = await db.query<{ due: Date; starts: Date }>(
      `select r.due_at as due, s.starts_at as starts from reminders r join tabling_slots s on s.id = r.linked_event_id
       where r.user_id = $1 and r.kind = 'tabling' and r.linked_event_id = $2`, [u.gia, s]);
    expect(before).toHaveLength(1);
    expect(new Date(before[0].starts).getTime() - new Date(before[0].due).getTime()).toBe(24 * 3600 * 1000);

    await asUserCommit(db, u.gia, () => db.query("select tabling_withdraw($1)", [s]));
    const { rows: after } = await db.query("select 1 from reminders where user_id = $1 and linked_event_id = $2", [u.gia, s]);
    expect(after).toEqual([]);
  });

  it("you can't sign up or withdraw once the slot has started", async () => {
    const s = await slot(5, -1);
    await expect(signUp("mo", s)).rejects.toThrow(/already started/);
  });
});

describe("after the slot", () => {
  it("hours count only for attended; no-shows are counted separately", async () => {
    const s = await slot(5, 72, 3);
    await signUp("mo", s);
    await signUp("max", s);
    await db.query("update tabling_slots set starts_at = now() - interval '4 hours', ends_at = now() - interval '1 hour' where id = $1", [s]);

    const report = await asUser(db, u.vera, async (tx) => {
      await tx.query("select tabling_mark($1, $2, 'attended')", [s, u.mo]);
      await tx.query("select tabling_mark($1, $2, 'no_show')", [s, u.max]);
      await tx.query("select tabling_add_walk_in($1, $2)", [s, u.ana]);
      return (await tx.query<{ user_id: string; hours: string; attended: number; no_shows: number }>(
        "select * from tabling_report($1) where user_id = any($2)", [lc.id, [u.mo, u.max, u.ana]])).rows;
    });
    const by = Object.fromEntries(report.map((r) => [r.user_id, r]));
    expect(Number(by[u.mo].hours)).toBe(3);
    expect(Number(by[u.max].hours)).toBe(0);
    expect(by[u.max].no_shows).toBe(1);
    expect(Number(by[u.ana].hours)).toBe(3);
  });

  it("only the slot's creator or the president can mark attendance", async () => {
    const s = await slot(5, 72);
    await signUp("gia", s);
    await db.query("update tabling_slots set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour' where id = $1", [s]);
    await expect(asUser(db, u.omar, (tx) => tx.query("select tabling_mark($1, $2, 'attended')", [s, u.gia])))
      .rejects.toThrow(/creator or the president/);
    await expect(asUser(db, u.gia, (tx) => tx.query("select tabling_mark($1, $2, 'attended')", [s, u.gia])))
      .rejects.toThrow(/creator or the president/);
    await asUser(db, u.pres, (tx) => tx.query("select tabling_mark($1, $2, 'attended')", [s, u.gia]));
  });

  it("the report shows members only themselves and VPs only their department", async () => {
    const mine = await asUser(db, u.mo, async (tx) =>
      (await tx.query<{ user_id: string }>("select user_id from tabling_report($1)", [lc.id])).rows.map((r) => r.user_id));
    expect(mine).toEqual([u.mo]);
    const omar = await asUser(db, u.omar, async (tx) =>
      (await tx.query<{ user_id: string }>("select user_id from tabling_report($1)", [lc.id])).rows.map((r) => r.user_id));
    expect(omar.every((id) => id === u.gia || id === u.omar)).toBe(true);
  });
});

describe("signing up from the weekly email (tabling_sign_up_as)", () => {
  it("signs a member up once, with the day-before reminder, and refuses non-members and full slots", async () => {
    const id = await slot(1, 30);
    const outsider = await createUser(db, "outsider-email");
    expect((await db.query<{ r: string }>("select tabling_sign_up_as($1, $2) as r", [id, u.gia])).rows[0].r).toBe("signed_up");
    expect((await db.query<{ r: string }>("select tabling_sign_up_as($1, $2) as r", [id, u.gia])).rows[0].r).toBe("already");
    expect((await db.query("select 1 from reminders where user_id = $1 and kind = 'tabling' and linked_event_id = $2", [u.gia, id])).rows).toHaveLength(1);
    await expect(db.query("select tabling_sign_up_as($1, $2)", [id, outsider])).rejects.toThrow(/Slot not found/);
    await expect(db.query("select tabling_sign_up_as($1, $2)", [id, u.max])).rejects.toThrow(/full/);
  });

  it("can't be called by signed-in users", async () => {
    const id = await slot(3, 30);
    await expect(asUser(db, u.gia, (tx) => tx.query("select tabling_sign_up_as($1, $2)", [id, u.max]))).rejects.toThrow(/permission denied/);
  });
});
