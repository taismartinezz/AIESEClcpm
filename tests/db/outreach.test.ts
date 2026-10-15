// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const OGV = "Outgoing Global Volunteer";
let tpl: string;
let seq: string;
const ex: Record<string, string> = {};

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "olga", "otto", "mark", "mcp"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.olga, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.otto, { department: OGV });
  await addMember(db, lc, u.mark, { department: "Marketing" });
  const rows = [
    { expa_id: "A", person_name: "Ana", email: "ana@x.example", stage: "signed_up", email_consent: true },
    { expa_id: "B", person_name: "Ben", email: "ben@x.example", stage: "signed_up" },
    { expa_id: "C", person_name: "Cai", stage: "signed_up", email_consent: true },
  ];
  await asUserCommit(db, u.otto, () => db.query("select * from import_exchanges($1, 'ogv', $2)", [lc.id, JSON.stringify(rows)]));
  for (const r of (await db.query<{ id: string; expa_id: string }>("select id, expa_id from exchanges")).rows) ex[r.expa_id] = r.id;
}, 60_000);

describe("templates", () => {
  it("members write drafts; only approvers approve; editing an approved template sends it back", async () => {
    tpl = await asUserCommit(db, u.otto, async () => (await db.query<{ id: string }>(
      "insert into outreach_templates (project_id, department_id, name, subject, body, created_by, status) values ($1, $2, 'Welcome', 'Hi {first_name}', 'Saw you signed up', $3, 'pending') returning id",
      [lc.id, lc.departments[OGV], u.otto])).rows[0].id);
    await expect(asUser(db, u.otto, (tx) => tx.query("update outreach_templates set status = 'approved' where id = $1", [tpl]))).rejects.toThrow(/Only the president/);
    await expect(asUser(db, u.mark, async (tx) => (await tx.query("select 1 from outreach_templates")).rows.length)).resolves.toBe(0);
    await asUserCommit(db, u.olga, () => db.query("update outreach_templates set status = 'approved' where id = $1", [tpl]));
    const edited = await asUser(db, u.otto, async (tx) => (await tx.query<{ status: string }>("update outreach_templates set body = 'changed' where id = $1 returning status", [tpl])).rows[0].status);
    expect(edited).toBe("draft");
  });

  it("an MC member of the LC's MC can approve too", async () => {
    const mc = await asUserCommit(db, u.mcp, async () => (await db.query<{ create_mc: string }>("select create_mc('MC')")).rows[0].create_mc);
    const { rows } = await db.query<{ lc_code: string }>("select lc_code from mcs where id = $1", [mc]);
    await asUserCommit(db, u.pres, () => db.query("select link_lc_to_mc($1, $2)", [lc.id, rows[0].lc_code]));
    const status = await asUser(db, u.mcp, async (tx) => (await tx.query<{ status: string }>("update outreach_templates set status = 'approved' where id = $1 returning status", [tpl])).rows[0]?.status);
    expect(status).toBe("approved");
  });
});

describe("sequences and enrollment", () => {
  it("can't start until every step's template is approved, then enrolls only consenting sign-ups with an email", async () => {
    const draft = await asUserCommit(db, u.olga, async () => (await db.query<{ id: string }>(
      "insert into outreach_templates (project_id, department_id, name, subject, body, created_by) values ($1, $2, 'Nudge', 'Still keen?', 'x', $3) returning id", [lc.id, lc.departments[OGV], u.olga])).rows[0].id);
    seq = await asUserCommit(db, u.olga, async () => {
      const id = (await db.query<{ id: string }>("insert into outreach_sequences (project_id, name, product, created_by) values ($1, 'oGV sign-ups', 'ogv', $2) returning id", [lc.id, u.olga])).rows[0].id;
      await db.query("insert into outreach_steps (sequence_id, step_no, delay_days, template_id) values ($1, 1, 0, $2), ($1, 2, 3, $3)", [id, tpl, draft]);
      return id;
    });
    await expect(asUser(db, u.olga, (tx) => tx.query("update outreach_sequences set active = true where id = $1", [seq]))).rejects.toThrow(/approved template/);
    await asUserCommit(db, u.olga, () => db.query("update outreach_templates set status = 'approved' where id = $1", [draft]));
    await asUserCommit(db, u.olga, () => db.query("update outreach_sequences set active = true where id = $1", [seq]));

    const res = await asUserCommit(db, u.otto, async () => (await db.query<{ enrolled: number; skipped: number; reasons: string[] }>(
      "select * from enroll_in_sequence($1, $2)", [seq, [ex.A, ex.B, ex.C]])).rows[0]);
    expect(res.enrolled).toBe(1);
    expect(res.reasons.join(" | ")).toMatch(/Ben: no consent.*Cai: no email/);
  });

  it("stops when the person applies or unsubscribes, and counts it in the results", async () => {
    await asUserCommit(db, u.otto, () => db.query("update exchanges set stage = 'applied' where id = $1", [ex.A]));
    const { rows } = await db.query<{ status: string; stop_reason: string }>("select status, stop_reason from outreach_enrollments where exchange_id = $1", [ex.A]);
    expect(rows[0]).toEqual({ status: "stopped", stop_reason: "stage_changed" });
    const stats = await asUser(db, u.olga, async (tx) => (await tx.query<{ enrolled: number; moved_on: number; applied: number }>("select enrolled, moved_on, applied from outreach_stats($1)", [lc.id])).rows[0]);
    expect(stats).toEqual({ enrolled: 1, moved_on: 1, applied: 1 });
  });
});
