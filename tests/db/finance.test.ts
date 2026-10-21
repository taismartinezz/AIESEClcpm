// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { freshDatabase, asUser, type Tx } from "./harness";
import { createUser, createLc, addMember, type Lc } from "./fixtures";

// LC with: president, Fiona (VP of Finance & Legality), Vera (VP of Marketing),
// Omar (VP of oGV), members Mo (Marketing) and Gia (oGV).

let db: PGlite;
let lc: Lc;
const u: Record<string, string> = {};
const MKT = "Marketing";
const OGV = "Outgoing Global Volunteer";
const FL = "Finance & Legality";

async function submitClaim(who: string, department: string, amount = 25): Promise<string> {
  const path = `${lc.id}/${u[who]}/${crypto.randomUUID()}.pdf`;
  // Upload + insert as the member, committed so later tests can see it.
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [u[who]]);
  try {
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)", [path, u[who]]);
    const { rows } = await db.query<{ id: string }>(
      `insert into expense_claims (project_id, submitted_by, amount, currency, description, department_id, receipt_path)
       values ($1, $2, $3, 'EUR', 'Printing posters', $4, $5) returning id`,
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

beforeAll(async () => {
  db = await freshDatabase();
  for (const n of ["pres", "fiona", "vera", "omar", "mo", "gia"]) u[n] = await createUser(db, n);
  lc = await createLc(db, u.pres);
  await addMember(db, lc, u.fiona, { role: "vp", leads: [FL] });
  await addMember(db, lc, u.vera, { role: "vp", leads: [MKT] });
  await addMember(db, lc, u.omar, { role: "vp", leads: [OGV] });
  await addMember(db, lc, u.mo, { department: MKT });
  await addMember(db, lc, u.gia, { department: OGV });
}, 60_000);

describe("who is in charge of finance", () => {
  it("is the president and the VP of the finance department: nobody else", async () => {
    const check = (who: string) => asUser(db, u[who], async (tx) =>
      (await tx.query<{ ok: boolean }>("select is_finance_lead($1) as ok", [lc.id])).rows[0].ok);
    expect(await check("pres")).toBe(true);
    expect(await check("fiona")).toBe(true);
    expect(await check("vera")).toBe(false);
    expect(await check("mo")).toBe(false);
  });

  it("seeds the default categories for a new LC", async () => {
    const { rows } = await db.query<{ name: string }>(
      "select name from finance_categories where project_id = $1 order by sort_order", [lc.id]);
    expect(rows.map((r) => r.name)).toEqual([
      "Conferences", "Events", "Marketing", "Merchandise", "Transport", "Food", "Sponsorship", "Membership fees", "Other",
    ]);
  });
});

describe("expense claims", () => {
  it("only the person in charge of finance can approve", async () => {
    const claim = await submitClaim("mo", MKT);
    for (const who of ["mo", "vera", "omar"]) {
      await expect(asUser(db, u[who], (tx) => review(tx, claim, "approved")))
        .rejects.toThrow(/Only the person in charge of finance/);
    }
    // Not even by writing the status column directly: RLS lets the update touch no rows…
    const touched = await asUser(db, u.vera, async (tx) =>
      (await tx.query("update expense_claims set status = 'approved' where id = $1 returning id", [claim])).rows);
    expect(touched).toEqual([]);
    // …and the submitter's own update is stopped by the status guard.
    await expect(asUser(db, u.mo, (tx) =>
      tx.query("update expense_claims set status = 'approved' where id = $1", [claim]),
    )).rejects.toThrow(/Only the person in charge of finance/);

    const status = await asUser(db, u.fiona, async (tx) => {
      await review(tx, claim, "approved");
      return (await tx.query<{ status: string }>("select status from expense_claims where id = $1", [claim])).rows[0].status;
    });
    expect(status).toBe("approved");
  });

  it("approving creates a ledger entry and un-approving removes it", async () => {
    const claim = await submitClaim("mo", MKT, 42.5);
    const result = await asUser(db, u.pres, async (tx) => {
      await review(tx, claim, "approved");
      const afterApprove = (await tx.query<{ amount: string; type: string; department_id: string }>(
        "select amount, type, department_id from finance_entries where claim_id = $1", [claim])).rows;
      await review(tx, claim, "pending");
      const afterReopen = (await tx.query("select 1 from finance_entries where claim_id = $1", [claim])).rows;
      await review(tx, claim, "approved");
      await review(tx, claim, "rejected", "Duplicate of an earlier claim");
      const afterReject = (await tx.query("select 1 from finance_entries where claim_id = $1", [claim])).rows;
      return { afterApprove, afterReopen, afterReject };
    });
    expect(result.afterApprove).toEqual([{ amount: "42.50", type: "expense", department_id: lc.departments[MKT] }]);
    expect(result.afterReopen).toEqual([]);
    expect(result.afterReject).toEqual([]);
  });

  it("rejecting requires a reason", async () => {
    const claim = await submitClaim("gia", OGV);
    await expect(asUser(db, u.fiona, (tx) => review(tx, claim, "rejected", "  ")))
      .rejects.toThrow(/requires a reason/);
  });

  it("notifies the submitter when a claim is approved or rejected", async () => {
    const claim = await submitClaim("gia", OGV);
    const notes = await asUser(db, u.fiona, async (tx) => {
      await review(tx, claim, "rejected", "No receipt total visible");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [u.gia]);
      return (await tx.query<{ type: string; body: string }>(
        "select type, body from notifications where related_id = $1", [claim])).rows;
    });
    expect(notes).toEqual([expect.objectContaining({ type: "claim_rejected", body: expect.stringContaining("No receipt total visible") })]);
  });

  it("members can't read other members' claims or receipts", async () => {
    await submitClaim("gia", OGV);
    const seen = await asUser(db, u.mo, async (tx) => ({
      claims: (await tx.query<{ submitted_by: string }>("select submitted_by from expense_claims")).rows,
      receipts: (await tx.query<{ name: string }>("select name from storage.objects where bucket_id = 'receipts'")).rows,
    }));
    expect(seen.claims.every((c) => c.submitted_by === u.mo)).toBe(true);
    expect(seen.claims.length).toBeGreaterThan(0);
    expect(seen.receipts.every((r) => r.name.split("/")[1] === u.mo)).toBe(true);
  });

  it("members can't file a claim with a receipt in someone else's folder", async () => {
    await expect(asUser(db, u.mo, (tx) => tx.query(
      `insert into expense_claims (project_id, submitted_by, amount, currency, description, receipt_path)
       values ($1, $2, 10, 'EUR', 'x', $3)`, [lc.id, u.mo, `${lc.id}/${u.gia}/stolen.pdf`],
    ))).rejects.toThrow(/row-level security/);
  });
});

describe("VPs see only their department's finance", () => {
  it("limits claims, ledger entries and receipts to the departments they lead", async () => {
    await db.query(`insert into finance_entries (project_id, type, amount, currency, department_id, recorded_by, description)
                    values ($1, 'income', 300, 'EUR', $2, $3, 'Sponsorship'), ($1, 'expense', 80, 'EUR', $4, $3, 'Flyers')`,
      [lc.id, lc.departments[OGV], u.fiona, lc.departments[MKT]]);

    const vera = await asUser(db, u.vera, async (tx) => ({
      entries: (await tx.query<{ department_id: string }>("select department_id from finance_entries")).rows,
      claims: (await tx.query<{ department_id: string }>("select department_id from expense_claims")).rows,
      receipts: (await tx.query<{ name: string }>("select name from storage.objects where bucket_id = 'receipts'")).rows,
    }));
    expect(vera.entries.length).toBeGreaterThan(0);
    expect(vera.entries.every((e) => e.department_id === lc.departments[MKT])).toBe(true);
    expect(vera.claims.every((c) => c.department_id === lc.departments[MKT])).toBe(true);
    expect(vera.receipts.every((r) => r.name.split("/")[1] === u.mo)).toBe(true);

    const finance = await asUser(db, u.fiona, async (tx) =>
      (await tx.query("select 1 from finance_entries")).rows.length);
    expect(finance).toBeGreaterThan(vera.entries.length);
  });

  it("members can't read the ledger or record entries", async () => {
    const rows = await asUser(db, u.mo, async (tx) => (await tx.query("select 1 from finance_entries")).rows);
    expect(rows).toEqual([]);
    await expect(asUser(db, u.mo, (tx) => tx.query(
      `insert into finance_entries (project_id, type, amount, currency, recorded_by) values ($1, 'income', 5, 'EUR', $2)`,
      [lc.id, u.mo],
    ))).rejects.toThrow(/row-level security/);
  });

  it("entries created by an approved claim can't be edited by hand", async () => {
    const claim = await submitClaim("mo", MKT);
    const updated = await asUser(db, u.fiona, async (tx) => {
      await review(tx, claim, "approved");
      return (await tx.query("update finance_entries set amount = 1 where claim_id = $1 returning id", [claim])).rows;
    });
    expect(updated).toEqual([]);
  });
});
