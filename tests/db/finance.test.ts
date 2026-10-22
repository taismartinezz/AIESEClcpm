// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser, type Tx } from "./harness";
import { createUser, createLc, addMember, asUserCommit, type Lc } from "./fixtures";

// LC with: president, Fiona (VP of Finance & Legality), Vera (VP of Marketing),
// Omar (VP of oGV), members Mo (Marketing) and Gia (oGV). The LC is linked to an
// MC whose VP Finance is Val; Max is a plain MC member.

let db: PGlite;
let lc: Lc;
let other: Lc;            // a second LC, not linked to any MC
const u: Record<string, string> = {};
const MKT = "Marketing";
const OGV = "Outgoing Global Volunteer";
const FL = "Finance & Legality";

async function submitClaim(who: string, department: string, amount = 25): Promise<string> {
  const path = `${lc.id}/${u[who]}/${crypto.randomUUID()}.pdf`;
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [u[who]]);
  try {
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)", [path, u[who]]);
    const { rows } = await db.query<{ id: string }>(
      `insert into expense_claims (project_id, submitted_by, amount, currency, description, department_id, receipt_path)
       values ($1, $2, $3, 'USD', 'Printing posters', $4, $5) returning id`,
      [lc.id, u[who], amount, lc.departments[department], path],
    );
    return rows[0].id;
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

const review = (tx: Tx, claimId: string, status: string, reason: string | null = null) =>
  tx.query("select review_expense_claim($1, $2, $3)", [claimId, status, reason]);

const addEntry = (tx: Tx, who: string, amount: number, description = "Entry") => tx.query(
  `insert into finance_entries (project_id, type, amount, currency, recorded_by, description, area) values ($1, 'income', $2, 'USD', $3, $4, 'OGX') returning id`,
  [lc.id, amount, u[who], description]);

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "fiona", "vera", "omar", "mo", "gia", "val", "max", "pres2"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  other = await createLc(db, u.pres2, "Unlinked LC");
  await addMember(db, lc, u.fiona, { role: "vp", leads: [FL] });
  await addMember(db, lc, u.vera, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.omar, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.mo, { department: MKT });
  await addMember(db, lc, u.gia, { department: OGV });

  // The MC: Max creates it (MCP), Val joins and is named VP Finance; the LCP links the LC.
  const mc = await asUserCommit(db, u.max, async () => (await db.query<{ id: string }>("select create_mc('AIESEC in Testland') as id")).rows[0].id);
  const codes = (await db.query<{ member_code: string; lc_code: string }>("select member_code, lc_code from mcs where id = $1", [mc])).rows[0];
  await asUserCommit(db, u.val, () => db.query("select join_mc($1)", [codes.member_code]));
  await asUserCommit(db, u.max, () => db.query("select set_mc_member_role($1, $2, 'vp_finance')", [mc, u.val]));
  await asUserCommit(db, u.pres, () => db.query("select link_lc_to_mc($1, $2)", [lc.id, codes.lc_code]));
}, 60_000);

describe("who keeps the books", () => {
  it("is the MC VP Finance of the LC's MC, and only for linked LCs", async () => {
    const check = (who: string, project: string) => asUser(db, u[who], async (tx) =>
      (await tx.query<{ ok: boolean }>("select is_mc_vp_finance($1) as ok", [project])).rows[0].ok);
    expect(await check("val", lc.id)).toBe(true);
    expect(await check("val", other.id)).toBe(false);
    for (const who of ["pres", "fiona", "max"]) expect(await check(who, lc.id)).toBe(false);
  });

  it("only the MCP can name a VP Finance", async () => {
    const mc = (await db.query<{ id: string }>("select id from mcs limit 1")).rows[0].id;
    await expect(asUser(db, u.val, (tx) => tx.query("select set_mc_member_role($1, $2, 'vp_finance')", [mc, u.val]))).rejects.toThrow(/Only the MCP/);
  });

  it("tells the LC whether it has one (the banner when it doesn't)", async () => {
    const keeper = (who: string, project: string) => asUser(db, u[who], async (tx) =>
      (await tx.query<{ has_keeper: boolean }>("select has_keeper from lc_finance_keeper($1)", [project])).rows[0]?.has_keeper);
    expect(await keeper("pres", lc.id)).toBe(true);
    expect(await keeper("pres2", other.id)).toBe(false);
  });

  it("lists the LCs the MC VP Finance keeps", async () => {
    const lcs = await asUser(db, u.val, async (tx) => (await tx.query<{ name: string }>("select name from mc_finance_lcs()")).rows);
    expect(lcs.map((l) => l.name)).toEqual(["LC Test"]);
  });
});

describe("the ledger", () => {
  it("the MC VP Finance adds, edits and deletes entries", async () => {
    const out = await asUser(db, u.val, async (tx) => {
      const id = (await addEntry(tx, "val", 10)).rows[0].id as string;
      const edited = (await tx.query("update finance_entries set amount = 12 where id = $1 returning id", [id])).rows.length;
      const deleted = (await tx.query("delete from finance_entries where id = $1 returning id", [id])).rows.length;
      return { edited, deleted };
    });
    expect(out).toEqual({ edited: 1, deleted: 1 });
  });

  it("the LCP, VP F&L, other VPs and members can't write, even calling the API directly", async () => {
    const id = await asUserCommit(db, u.val, async () => (await addEntry(db as unknown as Tx, "val", 50, "Kept by Val")).rows[0].id as string);
    for (const who of ["pres", "fiona", "vera", "mo"]) {
      await expect(asUser(db, u[who], (tx) => addEntry(tx, who, 5))).rejects.toThrow(/row-level security/);
      const changed = await asUser(db, u[who], async (tx) => ({
        updated: (await tx.query("update finance_entries set amount = 1 where id = $1 returning id", [id])).rows.length,
        deleted: (await tx.query("delete from finance_entries where id = $1 returning id", [id])).rows.length,
      }));
      expect(changed, who).toEqual({ updated: 0, deleted: 0 });
    }
    await expect(asUser(db, u.pres, (tx) => tx.query("select import_finance_entries($1, '[]'::jsonb)", [lc.id]))).rejects.toThrow(/MC VP Finance/);
  });

  it("the LCP and every VP read the whole ledger; members read none of it", async () => {
    const count = (who: string) => asUser(db, u[who], async (tx) => (await tx.query("select 1 from finance_entries")).rows.length);
    const all = await count("val");
    expect(all).toBeGreaterThan(0);
    for (const who of ["pres", "fiona", "vera", "omar"]) expect(await count(who), who).toBe(all);
    expect(await count("mo")).toBe(0);
    expect(await count("max")).toBe(0);         // a plain MC member doesn't see LC books
  });

  it("logs every change: who, when, old → new", async () => {
    const id = await asUserCommit(db, u.val, async () => {
      const entry = (await addEntry(db as unknown as Tx, "val", 20, "Logged")).rows[0].id as string;
      await db.query("update finance_entries set amount = 25, notes = 'fixed' where id = $1", [entry]);
      return entry;
    });
    const log = await asUser(db, u.pres, async (tx) => (await tx.query<{ op: string; changed_by: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> }>(
      "select op, changed_by, old_values, new_values from finance_entry_changes where entry_id = $1 order by changed_at, op", [id])).rows);
    expect(log.map((l) => l.op)).toEqual(["insert", "update"]);
    expect(log[1]).toMatchObject({ changed_by: u.val, old_values: { amount: 20, notes: null }, new_values: { amount: 25, notes: "fixed" } });
  });
});

describe("importing the tracker", () => {
  const ROWS = [
    ["2025-10-01", "opening", 3381.00, "Opening balance"],
    ["2025-10-04", "expense", 9.77, "Excedent from Pizza Party received from monthly R&R"],
    ["2025-12-13", "expense", 1737.90, "Plane tickets for 4 delegates that attended FallCo"],
    ["2026-01-12", "income", 840.00, "1 GTa Long Term"],
    ["2026-03-03", "expense", 503.83, "Flight tickets ORD-PTY (Tais Martínez)"],
    ["2026-03-03", "expense", 433.60, "Flight tickets ORD-SEA (Tais Martínez and Adriana Maldonado)"],
    ["2026-03-03", "expense", 53.94, "Food for EBM"],
    ["2026-03-25", "income", 157.50, "Adisson Warmerdan GV fee with discount"],
    ["2026-04-06", "expense", 180.00, "Tais Martinez's SpringCo 2026 fee"],
    ["2026-07-27", "income", 1117.43, "Northwestern Reimbursement"],
    ["2026-09-22", "expense", 545.83, "Reimbursement for Tais' flight for FallCo"],
  ].map(([date, type, amount, description]) => ({ date, type, amount, description }));

  it("brings in the 10 rows plus the opening balance, ending at $2,031.06; importing again adds nothing", async () => {
    const fresh = await createLc(db, u.pres2, "Northwestern");
    await db.query("update projects set mc_id = (select mc_id from projects where id = $1) where id = $2", [lc.id, fresh.id]);   // linked to the same MC
    const run = () => asUserCommit(db, u.val, async () =>
      (await db.query<{ inserted: number }>("select * from import_finance_entries($1, $2::jsonb)", [fresh.id, JSON.stringify(ROWS)])).rows[0].inserted);
    expect(await run()).toBe(11);
    expect(await run()).toBe(0);
    const balance = (await db.query<{ b: string }>(
      "select sum(case when type = 'expense' then -amount else amount end)::numeric(12,2) as b from finance_entries where project_id = $1", [fresh.id])).rows[0].b;
    expect(balance).toBe("2031.06");
  });
});

describe("expense claims", () => {
  it("only the MC VP Finance approves; the LCP and VP F&L can't", async () => {
    const claim = await submitClaim("mo", MKT);
    for (const who of ["mo", "vera", "pres", "fiona"]) {
      await expect(asUser(db, u[who], (tx) => review(tx, claim, "approved"))).rejects.toThrow(/MC VP Finance/);
    }
    await expect(asUser(db, u.mo, (tx) => tx.query("update expense_claims set status = 'approved' where id = $1", [claim])))
      .rejects.toThrow(/MC VP Finance/);
    const status = await asUser(db, u.val, async (tx) => {
      await review(tx, claim, "approved");
      return (await tx.query<{ status: string }>("select status from expense_claims where id = $1", [claim])).rows[0].status;
    });
    expect(status).toBe("approved");
  });

  it("approving creates exactly one ledger entry, in the tracker's terms; un-approving removes it", async () => {
    const claim = await submitClaim("mo", MKT, 42.5);
    const result = await asUser(db, u.val, async (tx) => {
      await review(tx, claim, "approved");
      await review(tx, claim, "approved");    // again: still one entry
      const afterApprove = (await tx.query<{ amount: string; type: string; area: string; notes: string }>(
        "select amount, type, area, notes from finance_entries where claim_id = $1", [claim])).rows;
      await review(tx, claim, "pending");
      const afterReopen = (await tx.query("select 1 from finance_entries where claim_id = $1", [claim])).rows;
      return { afterApprove, afterReopen };
    });
    expect(result.afterApprove).toHaveLength(1);
    expect(result.afterApprove[0]).toMatchObject({ amount: "42.50", type: "expense", area: MKT });
    expect(result.afterApprove[0].notes).toMatch(/^Reimbursed the \d{2}\/\d{2}\/\d{4}$/);
    expect(result.afterReopen).toEqual([]);
  });

  it("entries created by an approved claim can't be edited by hand", async () => {
    const claim = await submitClaim("gia", OGV);
    const updated = await asUser(db, u.val, async (tx) => {
      await review(tx, claim, "approved");
      return (await tx.query("update finance_entries set amount = 1 where claim_id = $1 returning id", [claim])).rows;
    });
    expect(updated).toEqual([]);
  });

  it("rejecting requires a reason, and notifies the submitter", async () => {
    const claim = await submitClaim("gia", OGV);
    await expect(asUser(db, u.val, (tx) => review(tx, claim, "rejected", "  "))).rejects.toThrow(/requires a reason/);
    const notes = await asUser(db, u.val, async (tx) => {
      await review(tx, claim, "rejected", "No receipt total visible");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [u.gia]);
      return (await tx.query<{ type: string; body: string }>("select type, body from notifications where related_id = $1", [claim])).rows;
    });
    expect(notes).toEqual([expect.objectContaining({ type: "claim_rejected", body: "Printing posters. Reason: No receipt total visible" })]);
  });

  it("members can't read other members' claims or receipts, or file into someone else's folder", async () => {
    await submitClaim("gia", OGV);
    const seen = await asUser(db, u.mo, async (tx) => ({
      claims: (await tx.query<{ submitted_by: string }>("select submitted_by from expense_claims")).rows,
      receipts: (await tx.query<{ name: string }>("select name from storage.objects where bucket_id = 'receipts'")).rows,
    }));
    expect(seen.claims.length).toBeGreaterThan(0);
    expect(seen.claims.every((c) => c.submitted_by === u.mo)).toBe(true);
    expect(seen.receipts.every((r) => r.name.split("/")[1] === u.mo)).toBe(true);
    await expect(asUser(db, u.mo, (tx) => tx.query(
      `insert into expense_claims (project_id, submitted_by, amount, currency, description, receipt_path) values ($1, $2, 10, 'USD', 'x', $3)`,
      [lc.id, u.mo, `${lc.id}/${u.gia}/stolen.pdf`],
    ))).rejects.toThrow(/row-level security/);
  });

  it("the MC VP Finance sees the LC's claims and their receipts", async () => {
    const seen = await asUser(db, u.val, async (tx) => ({
      claims: (await tx.query("select 1 from expense_claims where project_id = $1", [lc.id])).rows.length,
      receipts: (await tx.query("select 1 from storage.objects where bucket_id = 'receipts'")).rows.length,
    }));
    expect(seen.claims).toBeGreaterThan(0);
    expect(seen.receipts).toBe(seen.claims);
  });
});
