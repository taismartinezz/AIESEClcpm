// @vitest-environment node
/** Real Postgres RLS, not mocked API responses. Every assertion compares complete
 * result sets (including empty sets); an extra row is a failure. JWT identity is
 * set exactly as PostgREST does, using the non-bypass authenticated/anon roles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import inventory from './permission-inventory.json';
import type { PGlite } from '@electric-sql/pglite';
import { freshDatabase, asUser } from './harness';
import { addMember, asUserCommit, createLc, createUser, type Lc } from './fixtures';

type Actor = { id: string | null; role: string; mc?: string; lc?: string; department?: string };
type Row = Record<string, unknown>;
type Site = { lc: Lc; mc: string; people: Actor[] };
let db: PGlite;
const actors: Actor[] = [];
const sites: Site[] = [];
const mcs: string[] = [];
let tables: string[];
const seeded = new Map<string, Row[]>();
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const sorted = (rows: Row[]) => rows.map(r => JSON.stringify(Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))))).sort();

beforeAll(async () => {
  db = await freshDatabase();
  for (let m = 0; m < 2; m++) {
    const mcp = await createUser(db, `matrix-mcp-${m}`);
    const mc = await asUserCommit(db, mcp, async () => (await db.query<{ id: string }>(
      'select create_mc($1, $2) as id', [`Matrix MC ${m}`, ['PT', 'EG'][m]])).rows[0].id);
    mcs.push(mc);
    actors.push({ id: mcp, role: 'mcp', mc });
    for (const role of ['member', 'vp_finance']) {
      const id = await createUser(db, `matrix-mcvp-${role}-${m}`);
      await db.query('insert into mc_members (mc_id, user_id, role) values ($1, $2, $3)', [mc, id, role]);
      actors.push({ id, role: `mcvp-${role}`, mc });
    }
    for (let l = 0; l < 2; l++) {
      const president = await createUser(db, `matrix-lcp-${m}-${l}`);
      const lc = await createLc(db, president, `Matrix LC ${m}-${l}`);
      await db.query("update projects set mc_id = $1, term_start_date = '2026-03-17' where id = $2", [mc, lc.id]);
      const people: Actor[] = [{ id: president, role: 'lcp', lc: lc.id, mc }];
      const deps = ['Outgoing Global Volunteer', 'Incoming Global Volunteer'];
      for (let v = 0; v < 2; v++) {
        const id = await createUser(db, `matrix-vp-${m}-${l}-${v}`);
        await addMember(db, lc, id, { role: 'vp', department: deps[v], leads: [deps[v]] });
        people.push({ id, role: 'lcvp', lc: lc.id, mc, department: lc.departments[deps[v]] });
      }
      for (let n = 0; n < 3; n++) {
        const id = await createUser(db, `matrix-member-${m}-${l}-${n}`);
        await addMember(db, lc, id, { department: deps[n % 2] });
        people.push({ id, role: 'member', lc: lc.id, mc, department: lc.departments[deps[n % 2]] });
      }
      sites.push({ lc, mc, people }); actors.push(...people);
      for (const p of people) {
        await db.query(`insert into checkins (user_id, project_id, period_start, scores)
          values ($1, $2, checkin_period_start($2, now()), '[{"questionId":"energy","score":4}]')`, [p.id, lc.id]);
        await db.query("insert into reminders (user_id, project_id, scope, title) values ($1, $2, 'personal', 'Private reminder')", [p.id, lc.id]);
        await db.query("insert into bookmarks (project_id, url, title, scope, added_by) values ($1, 'https://example.com', 'Only me', 'personal', $2)", [lc.id, p.id]);
        await db.query("insert into tasks (project_id, title, scope, created_by) values ($1, 'Private task', 'personal', $2)", [lc.id, p.id]);
      }
      for (let d = 0; d < 2; d++) {
        const dep = lc.departments[deps[d]], owner = people[d + 1].id;
        await db.query("insert into exchanges (project_id, product, person_name, stage, created_by, department_id) values ($1, $2, 'Private exchange name', 'approved', $3, $4)", [lc.id, ['ogv', 'igv'][d], owner, dep]);
        const partner = (await db.query<{ id: string }>("insert into partners (project_id, name, department_id, created_by) values ($1, 'Private company', $2, $3) returning id", [lc.id, dep, owner])).rows[0].id;
        await db.query("insert into partner_contacts (partner_id, name, email) values ($1, 'Private contact', 'private@example.com')", [partner]);
        await db.query("insert into partner_activities (partner_id, body, author_id) values ($1, 'Private notes', $2)", [partner, owner]);
        await db.query("insert into finance_entries (project_id, type, amount, currency, description, department_id, recorded_by) values ($1, 'income', 17, 'USD', 'Private finance', $2, $3)", [lc.id, dep, president]);
        await db.query("insert into outreach_templates (project_id, department_id, name, subject, body, created_by) values ($1, $2, 'Private template', 'Subject', 'Body', $3)", [lc.id, dep, owner]);
        const seq = (await db.query<{ id: string }>("insert into outreach_sequences (project_id, name, product, created_by) values ($1, 'Private sequence', $2, $3) returning id", [lc.id, ['ogv', 'igv'][d], owner])).rows[0].id;
        const tpl = (await db.query<{ id: string }>('select id from outreach_templates where project_id=$1 and department_id=$2', [lc.id, dep])).rows[0].id;
        await db.query('insert into outreach_steps (sequence_id, step_no, delay_days, template_id) values ($1, 1, 0, $2)', [seq, tpl]);
        const ex = (await db.query<{ id: string }>('select id from exchanges where project_id=$1 and department_id=$2', [lc.id, dep])).rows[0].id;
        const en = (await db.query<{ id: string }>('insert into outreach_enrollments (project_id, sequence_id, exchange_id, sender_id) values ($1, $2, $3, $4) returning id', [lc.id, seq, ex, owner])).rows[0].id;
        await db.query("insert into outreach_messages (project_id, exchange_id, enrollment_id, sender_id, to_email, subject, status) values ($1, $2, $3, $4, 'private@example.com', 'Private email', 'sent')", [lc.id, ex, en, owner]);
      }
      for (const p of people) {
        await db.query(`insert into expense_claims (project_id, submitted_by, amount, currency, description, department_id, receipt_path)
          values ($1, $2, 12, 'USD', 'Private claim', $3, $4)`, [lc.id, p.id, p.department ?? lc.departments[deps[0]], `${lc.id}/${p.id}/receipt.pdf`]);
      }
      await db.query("insert into lc_events (project_id, name, type, starts_on, ends_on, created_by) values ($1, 'LC meeting', 'local_event', current_date, current_date, $2)", [lc.id, president]);
      for (const claim of (await db.query<{receipt_path: string; submitted_by: string}>('select receipt_path, submitted_by from expense_claims where project_id=$1', [lc.id])).rows) {
        await db.query("insert into storage.objects (bucket_id, name, owner) values ('receipts', $1, $2)", [claim.receipt_path, claim.submitted_by]);
      }
      await db.query("insert into tasks (project_id, title, scope, created_by) values ($1, 'Shared task', 'lab', $2)", [lc.id, president]);
      await db.query("insert into bookmarks (project_id, url, title, scope, added_by) values ($1, 'https://example.com', 'Shared file', 'lab', $2)", [lc.id, president]);
      await db.query("insert into chat_messages (channel, sender_id, content) values ($1, $2, 'LC conversation')", [`lab:${lc.id}`, president]);
      await db.query("insert into chat_messages (channel, sender_id, content) values ($1, $2, 'Private DM')", [`dm:${[president, people[3].id].sort().join(':')}`, president]);
    }
  }
  actors.push({ id: await createUser(db, 'matrix-outsider'), role: 'outsider' }, { id: null, role: 'signed-out' });
  // Server-only token tables contain one distinct fake connection per user;
  // empty token tables would not prove that the API cannot read credentials.
  for (const a of actors.filter(a => a.id)) {
    await db.query("insert into expa_connections (user_id, expa_person_id, access_token, expa_name, profile) values ($1, $2, 'fixture-token-not-a-credential', $2, $3)", [a.id, `matrix-${a.id}`, JSON.stringify({ fullName: `Profile ${a.id}` })]);
    await db.query("insert into google_connections (user_id, google_email, access_token) values ($1, $2, 'fixture-token-not-a-credential')", [a.id, `${a.id}@example.com`]);
  }
  tables = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r => r.tablename);
  expect(tables).toEqual(inventory.tables);
  for (const table of tables) seeded.set(table, (await db.query<Row>(`select * from ${quote(table)}`)).rows);
}, 120_000);
afterAll(async () => { await db?.close(); });

function expected(table: string, row: Row, a: Actor): boolean {
  const ownLc = !!a.lc && row.project_id === a.lc;
  const exec = a.role === 'lcp' || a.role === 'lcvp';
  const privateDepartment = ownLc && (a.role === 'lcp' || a.role === 'lcvp' && row.department_id === a.department);
  switch (table) {
    case 'projects': return row.id === a.lc;
    case 'mcs': return !!a.mc && row.id === a.mc && a.role.startsWith('mc');
    case 'mc_members': return !!a.mc && row.mc_id === a.mc && a.role.startsWith('mc');
    case 'user_profiles': return !!a.id && (row.id === a.id || !!a.lc && sites.find(s => s.lc.id === a.lc)!.people.some(p => p.id === row.id));
    case 'departments': case 'lab_roles': case 'drive_folders': case 'finance_categories': case 'onboarding_steps': case 'team_members': return ownLc;
    case 'checkins': case 'reminders': case 'notifications': case 'user_settings': return !!a.id && row.user_id === a.id;
    case 'tasks': return ownLc && (row.scope === 'lab' || row.created_by === a.id);
    case 'bookmarks': return ownLc && (row.scope === 'lab' || row.added_by === a.id);
    case 'chat_messages': return !!a.id && (row.channel === `lab:${a.lc}` || String(row.channel).split(':').slice(1).includes(a.id));
    case 'lc_events': return ownLc;
    case 'outreach_enrollments': case 'outreach_messages': return (seeded.get('exchanges') ?? []).some(p => p.id === row.exchange_id && expected('exchanges', p, a));
    case 'exchanges': case 'partners': case 'finance_entries': case 'outreach_templates': return privateDepartment;
    case 'expense_claims': return privateDepartment || !!a.id && row.submitted_by === a.id;
    case 'finance_entry_changes': return ownLc && a.role === 'lcp';
    case 'exchange_history': return (seeded.get('exchanges') ?? []).some(p => p.id === row.exchange_id && expected('exchanges', p, a));
    case 'partner_contacts': case 'partner_activities': return (seeded.get('partners') ?? []).some(p => p.id === row.partner_id && expected('partners', p, a));
    case 'outreach_sequences': return ownLc && (a.role === 'lcp' || a.role === 'lcvp' && row.product === (a.department === sites.find(s => s.lc.id === a.lc)!.lc.departments['Outgoing Global Volunteer'] ? 'ogv' : 'igv'));
    case 'outreach_steps': return (seeded.get('outreach_sequences') ?? []).some(p => p.id === row.sequence_id && expected('outreach_sequences', p, a));
    case 'support_resources': return !!a.id;
    case 'activity_feed': return ownLc;
    case 'member_onboarding': return ownLc && (exec || row.user_id === a.id);
    default: return false;
  }
}

describe('two MCs × two LCs: complete row isolation', () => {
  it('populates every requested module in all four LCs', () => {
    for (const table of ['checkins', 'exchanges', 'partners', 'finance_entries', 'expense_claims', 'chat_messages', 'tasks', 'reminders', 'outreach_templates', 'outreach_sequences', 'outreach_steps', 'outreach_enrollments', 'outreach_messages']) {
      const rows = seeded.get(table)!;
      for (const s of sites) expect(rows.some(r => r.project_id === s.lc.id || r.channel === `lab:${s.lc.id}` || table === 'outreach_steps' && seeded.get('outreach_sequences')!.some(seq => seq.project_id === s.lc.id && seq.id === r.sequence_id)), table).toBe(true);
    }
  });

  it('queries every public table for every identity and rejects every unexpected or missing row', async () => {
    const failures: string[] = [];
    for (const actor of actors) for (const table of tables) {
      const want = (seeded.get(table) ?? []).filter(r => expected(table, r, actor));
      try {
        const got = await asUser(db, actor.id, async tx => (await tx.query<Row>(`select * from ${quote(table)}`)).rows);
        if (JSON.stringify(sorted(got)) !== JSON.stringify(sorted(want))) failures.push(`${actor.role} ${actor.id} / ${table}: expected ${want.length}, received ${got.length}`);
      } catch (error) {
        if (!(want.length === 0 && /permission denied/.test(String(error)))) throw error;
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('national dashboard returns only exact counts for its own LCs and products', async () => {
    for (const a of actors) for (const mc of mcs) {
      const got = await asUser(db, a.id, async tx => {
        try { return (await tx.query<Row>('select * from mc_dashboard($1)', [mc])).rows; }
        catch (e) { if (a.id === null && /permission denied/.test(String(e))) return []; throw e; }
      });
      if (!a.role.startsWith('mc') || a.mc !== mc) { expect(got, a.role).toEqual([]); continue; }
      expect(got.length).toBe(12); // six products for each of two linked LCs
      for (const row of got) {
        expect(Object.keys(row).sort()).toEqual(['project_id', 'lc_name', 'members', 'product', 'applied', 'approved', 'realized', 'completed'].sort());
        expect(sites.filter(s => s.mc === mc).map(s => s.lc.id)).toContain(row.project_id);
        expect(row.members).toBe(6);
        expect(row.approved).toBe(['ogv', 'igv'].includes(String(row.product)) ? 1 : 0);
        expect(row.applied).toBe(row.approved);
        expect(row.realized).toBe(0); expect(row.completed).toBe(0);
      }
    }
  });

  it('term and email lookups reveal nothing to another LC, MC, or signed-out user', async () => {
    for (const a of actors) for (const s of sites) {
      const result = await asUser(db, a.id, async tx => {
        try { return (await tx.query<{ term: Date | null; person: string | null }>(
          "select lc_term_start($1) as term, find_team_member_id_by_email($1, $2) as person", [s.lc.id, `matrix-lcp-${mcs.indexOf(s.mc)}-${sites.filter(x => x.mc === s.mc).indexOf(s)}@example.com`])).rows[0]; }
        catch(e) { if (a.id === null && /permission denied/.test(String(e))) return { term: null, person: null }; throw e; }
      });
      if (a.lc !== s.lc.id) expect(result).toEqual({ term: null, person: null });
      else { expect(result.person).toBe(s.lc.president); expect(new Date(result.term!).toISOString().slice(0, 10)).toBe('2026-03-17'); }
    }
  });

  it('check-in averages require the threshold and raw scores remain author-only', async () => {
    for (const a of actors) for (const s of sites) {
      const rows = await asUser(db, a.id, async tx => {
        try { return (await tx.query<Row>('select * from get_member_pulse($1)', [s.lc.id])).rows; }
        catch(e) { if (a.id === null && /permission denied/.test(String(e))) return []; throw e; }
      });
      if (a.lc !== s.lc.id || !['lcp', 'lcvp'].includes(a.role)) expect(rows).toEqual([]);
      else for (const row of rows) {
        if (a.role === 'lcvp') expect(row.department_id).toBe(a.department);
        if (row.suppressed) expect(row.avg_score).toBeNull();
        else { expect(Number(row.respondent_count)).toBeGreaterThanOrEqual(3); expect(Number(row.avg_score)).toBe(4); }
      }
    }
  });

  it('only the LCP or the claim department VP can review, never the submitter', async () => {
    for (const a of actors) for (const claim of seeded.get('expense_claims')!) {
      const allowed = !!a.id && a.id !== claim.submitted_by && a.lc === claim.project_id && (a.role === 'lcp' || a.role === 'lcvp' && a.department === claim.department_id);
      const attempt = asUser(db, a.id, tx => tx.query("select (review_expense_claim($1, 'approved')).id", [claim.id]));
      if (allowed) expect((await attempt).rows).toEqual([{ id: claim.id }]);
      else await expect(attempt, `${a.role} reviewing ${claim.id}`).rejects.toThrow();
    }
  }, 120_000);

  it('members and national users cannot insert, update, or delete LC finance', async () => {
    for (const a of actors.filter(a => !['lcp', 'lcvp'].includes(a.role))) {
      for (const entry of seeded.get('finance_entries')!) {
        for (const sql of ['update finance_entries set amount=1 where id=$1 returning id', 'delete from finance_entries where id=$1 returning id']) {
          try { expect((await asUser(db, a.id, tx => tx.query(sql, [entry.id]))).rows).toEqual([]); }
          catch(e) { if (!/permission denied/.test(String(e))) throw e; }
        }
      }
      await expect(asUser(db, a.id, tx => tx.query("insert into finance_entries (project_id, type, amount, currency, description, recorded_by) values ($1, 'income', 1, 'USD', 'Attack', $2)", [sites[0].lc.id, a.id]))).rejects.toThrow();
    }
  });
});

// Adding a data RPC must include an assertion here. Catalog comparison prevents
// a new overload or table from quietly escaping the permission gate.
const readCases = {
  _expa_id_free: "select _expa_id_free('lc', $1::text) as value",
  _expa_office_of: "select _expa_office_of($4, 'lc', 'president') as value",
  auth_is_project_member: 'select auth_is_project_member($1) as value',
  auth_uid_is_sub_project_member: 'select auth_uid_is_sub_project_member($7) as value',
  auth_uid_shares_sub_project: 'select auth_uid_shares_sub_project($4) as value',
  can_approve_template: 'select can_approve_template($1, $3) as value',
  can_manage_member: 'select can_manage_member($1, $4) as value',
  can_manage_sub_project: 'select can_manage_sub_project($7) as value',
  can_manage_tabling_slot: 'select can_manage_tabling_slot($7) as value',
  can_read_finance: 'select can_read_finance($1) as value',
  can_review_claim: 'select can_review_claim($1, $3, $4) as value',
  can_see_layer: "select can_see_layer($1, 'lab', null, $4) as value",
  can_use_outreach: 'select can_use_outreach($1, $3) as value',
  can_work_on_exchange: 'select can_work_on_exchange($1, $3, $4) as value',
  can_work_on_partner: 'select can_work_on_partner($5) as value',
  can_write_finance: "select can_write_finance($1, 'lc') as value",
  checkin_period_start: 'select checkin_period_start($1, now()) as value',
  claim_invite_code_lookup: "select * from claim_invite_code_lookup('not-a-real-code')",
  claim_sub_project_invite_lookup: "select * from claim_sub_project_invite_lookup('not-a-real-code')",
  department_area: 'select department_area($3) as value',
  event_audience: 'select event_audience($6) as value',
  expa_profile: 'select expa_profile() as value',
  expa_status: 'select * from expa_status()',
  find_team_member_id_by_email: "select find_team_member_id_by_email($1, 'no-such-person@example.com') as value",
  get_area_pulse: 'select * from get_area_pulse($1)',
  get_exec_pulse: 'select * from get_exec_pulse($1)',
  get_member_pulse: 'select * from get_member_pulse($1, $3)',
  goal_progress: 'select * from goal_progress($1)',
  google_calendar_status: 'select * from google_calendar_status()',
  has_pending_project_invite: 'select has_pending_project_invite($7) as value',
  in_lc_of_mc: 'select in_lc_of_mc($2, $1) as value',
  in_led_department: 'select in_led_department($1, $4) as value',
  is_app_moderator: 'select is_app_moderator() as value',
  is_finance_lead: 'select is_finance_lead($1) as value',
  is_lc_exec: 'select is_lc_exec($1) as value',
  is_lc_president: 'select is_lc_president($1) as value',
  is_mc_mcp_of_lc: 'select is_mc_mcp_of_lc($1) as value',
  is_mc_member: 'select is_mc_member($2) as value',
  is_mc_vp_finance: 'select is_mc_vp_finance($1) as value',
  is_mcp: 'select is_mcp($2) as value',
  lc_compliance: 'select * from lc_compliance($1)',
  lc_finance_keeper: 'select * from lc_finance_keeper($1)',
  lc_in_mc: 'select lc_in_mc($1, $2) as value',
  lc_mc_name: 'select lc_mc_name($1) as value',
  lc_national: 'select * from lc_national($1)',
  lc_role: 'select lc_role($1) as value',
  lc_term_start: 'select lc_term_start($1) as value',
  lcs_in_country: "select * from lcs_in_country('XX')",
  led_department_ids: 'select led_department_ids($1) as value',
  mc_dashboard: 'select * from mc_dashboard($2)',
  mc_in_country: "select mc_in_country('XX') as value",
  mc_linked_lcs: 'select * from mc_linked_lcs($2)',
  mc_team: 'select * from mc_team($2)',
  mc_term_start: 'select mc_term_start($2) as value',
  member_activity: 'select * from member_activity($1)',
  my_auth_email: 'select my_auth_email() as value',
  my_department_id: 'select my_department_id($1) as value',
  outreach_stats: 'select * from outreach_stats($1)',
  partner_visible: 'select partner_visible($1, $3, $4) as value',
  tabling_report: 'select * from tabling_report($1)',
} satisfies Record<string, string>;

function assertRead(name: string, rows: Row[], a: Actor, s: Site) {
  const own = a.lc === s.lc.id;
  const lcp = own && a.role === 'lcp';
  const exec = own && ['lcp', 'lcvp'].includes(a.role);
  const dep = s.lc.departments['Outgoing Global Volunteer'];
  const vp = own && a.role === 'lcvp' && a.department === dep;
  const national = a.mc === s.mc && a.role.startsWith('mc');
  const scalar = (value: unknown) => expect(rows, `${a.role}/${name}`).toEqual([{ value }]);
  const empty = () => expect(rows, `${a.role}/${name}`).toEqual([]);
  switch (name) {
    case '_expa_id_free': case 'auth_uid_is_sub_project_member': case 'auth_uid_shares_sub_project':
    case 'can_manage_sub_project': case 'can_manage_tabling_slot': case 'has_pending_project_invite': case 'is_app_moderator': return scalar(false);
    case '_expa_office_of': case 'find_team_member_id_by_email': case 'mc_in_country': return scalar(null);
    case 'auth_is_project_member': case 'can_see_layer': case 'in_lc_of_mc': return scalar(own);
    case 'can_approve_template': case 'can_use_outreach': case 'can_work_on_exchange': case 'can_work_on_partner': case 'partner_visible': return scalar(lcp || vp);
    case 'can_manage_member': return scalar(a.id ? a.id === s.people[3].id || lcp || vp : null);
    case 'can_review_claim': return scalar(a.id !== s.people[3].id && (lcp || vp));
    case 'can_read_finance': case 'is_lc_exec': return scalar(exec);
    case 'can_write_finance': case 'is_lc_president': case 'is_finance_lead': return scalar(lcp);
    case 'is_mc_mcp_of_lc': case 'is_mcp': return scalar(national && a.role === 'mcp');
    case 'is_mc_vp_finance': return scalar(national && a.role === 'mcvp-vp_finance');
    case 'is_mc_member': return scalar(national);
    case 'in_led_department': return scalar(vp);
    case 'lc_in_mc': return scalar(own || national);
    case 'lc_role': return scalar(own ? ({lcp: 'president', lcvp: 'vp', member: 'member'}[a.role]) : null);
    case 'my_department_id': return scalar(own ? a.department ?? null : null);
    case 'my_auth_email': return scalar(a.id ? seeded.get('user_profiles')!.find(p => p.id === a.id)!.name.toString().toLowerCase() + '@example.com' : null);
    case 'department_area': return scalar(own ? 'outgoing' : null);
    case 'checkin_period_start': case 'lc_term_start': case 'mc_term_start': {
      const allowed = name === 'mc_term_start' ? !!a.lc && a.mc === s.mc || national : own;
      if (!allowed) return scalar(null);
      expect(rows).toHaveLength(1); expect(rows[0].value).toBeInstanceOf(Date);
      if (name === 'lc_term_start') expect(new Date(rows[0].value as Date).toISOString().slice(0, 10)).toBe('2026-03-17');
      return;
    }
    case 'expa_profile': return scalar(a.id ? { fullName: `Profile ${a.id}` } : null);
    case 'expa_status': {
      const want = seeded.get('expa_connections')!.filter(r => r.user_id === a.id).map(r => ({ connected_at: r.connected_at, expa_name: r.expa_name, home_lc_name: r.home_lc_name, last_synced_at: r.last_synced_at }));
      expect(sorted(rows)).toEqual(sorted(want)); return;
    }
    case 'google_calendar_status': {
      const want = seeded.get('google_connections')!.filter(r => r.user_id === a.id).map(r => ({ connected_at: r.connected_at, google_email: r.google_email, can_add_events: false, add_events: r.add_events }));
      expect(sorted(rows)).toEqual(sorted(want)); return;
    }
    case 'claim_invite_code_lookup': case 'claim_sub_project_invite_lookup':
    case 'goal_progress': case 'tabling_report': case 'lcs_in_country': return empty();
    case 'event_audience': return expect(sorted(rows)).toEqual(sorted(own ? s.people.map(p => ({ value: p.id })) : []));
    case 'led_department_ids': return expect(rows).toEqual(own && a.role === 'lcvp' ? [{ value: a.department }] : []);
    case 'lc_mc_name': return scalar(own ? `Matrix MC ${mcs.indexOf(s.mc)}` : null);
    case 'lc_national': {
      if (!own) return empty();
      expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ mc_id: s.mc, mc_name: `Matrix MC ${mcs.indexOf(s.mc)}` });
      expect(Object.keys(rows[0]).sort()).toEqual(['mc_id', 'mc_name', 'term_start']); return;
    }
    case 'lc_finance_keeper': return expect(rows).toEqual(own ? [{ has_keeper: true, reviewed_on: null }] : []);
    case 'get_area_pulse': case 'get_exec_pulse': case 'get_member_pulse': {
      const allowed = name === 'get_member_pulse' ? lcp || vp : lcp;
      if (!allowed) return empty();
      expect(rows).toHaveLength(name === 'get_area_pulse' ? 24 : 8);
      for (const row of rows) { expect(row.suppressed).toBe(true); expect(row.avg_score).toBeNull(); expect(row.respondent_count).toBeNull(); expect(row.question_id).toBeNull(); }
      return;
    }
    case 'mc_linked_lcs': return expect(sorted(rows)).toEqual(sorted(national ? sites.filter(x => x.mc === s.mc).map(x => ({ id: x.lc.id, name: `Matrix LC ${mcs.indexOf(s.mc)}-${sites.filter(y => y.mc === s.mc).indexOf(x)}` })) : []));
    case 'mc_dashboard': {
      if (!national) return empty();
      expect(rows).toHaveLength(12);
      const allowed = sites.filter(x => x.mc === s.mc).flatMap(x => ['ogv','ogta','ogte','igv','igta','igte'].map(product => ({ project_id: x.lc.id, lc_name: `Matrix LC ${mcs.indexOf(s.mc)}-${sites.filter(y=> y.mc===s.mc).indexOf(x)}`, members: 6, product, applied: ['ogv','igv'].includes(product) ? 1 : 0, approved: ['ogv','igv'].includes(product) ? 1 : 0, realized: 0, completed: 0 })));
      expect(sorted(rows)).toEqual(sorted(allowed)); return;
    }
    case 'mc_team': {
      const want = national ? seeded.get('mc_members')!.filter(m => m.mc_id === s.mc).map(m => ({ user_id: m.user_id, name: seeded.get('user_profiles')!.find(p => p.id === m.user_id)!.name, role: m.role, joined_at: m.joined_at, is_me: m.user_id === a.id, handover_pending: false })) : [];
      expect(sorted(rows)).toEqual(sorted(want)); return;
    }
    case 'member_activity': {
      const want = exec ? s.people.filter(p => lcp || p.department === a.department).map(p => p.id).sort() : [];
      expect(rows.map(r => r.user_id).sort()).toEqual(want);
      for (const row of rows) { expect(row.events_held).toBe(1); expect(row.events_attended).toBe(0); expect(row.overdue_tasks).toBe(0); expect(row.onboarding_done).toBe(0); }
      return;
    }
    case 'outreach_stats': {
      const want = seeded.get('outreach_sequences')!.filter(r => r.project_id === s.lc.id && expected('outreach_sequences', r, a)).map(r => ({ sequence_id: r.id, name: 'Private sequence', product: r.product, enrolled: 1, active: 1, replied: 0, unsubscribed: 0, moved_on: 0, applied: 1, emails_sent: 1 }));
      expect(sorted(rows)).toEqual(sorted(want)); return;
    }
    case 'lc_compliance': {
      if (!lcp) return empty();
      expect(rows, JSON.stringify(rows)).toEqual([{ balance: '34.00', currency: 'USD', approvals_12m: 1, meetings_12m: 0, boa_members: 0, university_affiliated: false, debt_plan: null, checks: [] }]); return;
    }
    default: throw new Error(`Missing read assertion: ${name}`);
  }
}

describe('data function inventory', () => {
  it('requires explicit coverage for every function and overload, including server-only helpers', async () => {
    const actual = (await db.query<{ name: string; args: string; result: string }>(`select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
      pg_get_function_result(p.oid) as result from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by p.proname, args`)).rows;
    const want = inventory.functions.map(({name, args, result}) => ({ name, args, result }));
    expect(sorted(actual)).toEqual(sorted(want));
    expect(Object.keys(readCases).sort()).toEqual(inventory.functions.filter(f => f.kind === 'read').map(f => f.name).sort());
  });

  it('calls every data read function as every identity against each LC and MC', async () => {
    for (const a of actors) for (const s of sites) for (const [name, sql] of Object.entries(readCases)) {
      const partner = seeded.get('partners')!.find(r => r.project_id === s.lc.id && r.department_id === s.lc.departments['Outgoing Global Volunteer'])!.id;
      const event = seeded.get('lc_events')!.find(r => r.project_id === s.lc.id)!.id;
      // A CTE gives all parameters concrete types even if a particular RPC uses
      // only a subset, without interpolating fixture values into SQL.
      const prefix = 'with args as (select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid) ';
      const params = [s.lc.id, s.mc, s.lc.departments['Outgoing Global Volunteer'], s.people[3].id, partner, event, 'ffffffff-ffff-4fff-8fff-ffffffffffff'];
      try {
        const rows = await asUser(db, a.id, async tx => (await tx.query<Row>(prefix + sql, params)).rows);
        assertRead(name, rows, a, s);
      } catch (e) {
        if (a.id === null && /permission denied/.test(String(e))) continue;
        throw new Error(`${a.role} / ${name} / ${s.lc.id}: ${String(e)}`);
      }
    }
  }, 120_000);

  it('denies direct access to every internal function for every identity', async () => {
    for (const a of actors) for (const f of inventory.functions.filter(f => f.kind === 'internal')) {
      const args = f.args ? f.args.split(', ').map(arg => 'null::' + arg.slice(arg.indexOf(' ') + 1)).join(', ') : '';
      await expect(asUser(db, a.id, tx => tx.query(`select * from ${quote(f.name)}(${args})`)), `${a.role}/${f.name}`).rejects.toThrow(/permission denied/);
    }
  }, 120_000);

  it('receipt storage returns only the owner or that LC department reviewer', async () => {
    const objects = (await db.query<Row>('select * from storage.objects')).rows;
    for (const a of actors) {
      const want = objects.filter(o => seeded.get('expense_claims')!.some(c => c.receipt_path === o.name && expected('expense_claims', c, a)));
      const got = await asUser(db, a.id, async tx => (await tx.query<Row>('select * from storage.objects')).rows);
      expect(sorted(got), a.role).toEqual(sorted(want));
    }
  });
});

const mutationCases = {
  accept_mcp_handover: 'select accept_mcp_handover($2) as value',
  adjust_goal_value: 'select adjust_goal_value($7, 1) as value',
  cancel_mcp_handover: 'select cancel_mcp_handover($2) as value',
  create_demo_lc: 'select create_demo_lc() as value',
  create_mc: "select create_mc('Temporary permission test', 'ZZ') as value",
  create_tabling_slots: "select create_tabling_slots($1, now()+interval '1 day', now()+interval '2 days', 'Location', 'Test', 2, $3) as value",
  delete_demo_lc: 'select delete_demo_lc($1) as value',
  disconnect_expa: 'select disconnect_expa() as value',
  disconnect_google_calendar: 'select disconnect_google_calendar() as value',
  enroll_in_sequence: 'select * from enroll_in_sequence($9, array[$10])',
  import_exchanges: `select * from import_exchanges($1, 'ogv', '[{"person_name":"Attack"}]')`,
  import_finance_entries: `select * from import_finance_entries($1, '[{"date":"2026-11-10","type":"income","amount":1,"description":"Attack"}]')`,
  import_partners: `select * from import_partners($1, jsonb_build_array(jsonb_build_object('name','Attack','department_id',$3)))`,
  import_recruits: `select * from import_recruits($1, '[{"name":"Attack"}]')`,
  import_tasks: `select * from import_tasks($1, '[{"title":"Attack"}]')`,
  join_from_expa: 'select join_from_expa() as value',
  join_lc_with_code: "select join_lc_with_code('invalid-code') as value",
  join_mc: "select join_mc('invalid-code') as value",
  link_lc_to_mc: "select link_lc_to_mc($1, 'invalid-code') as value",
  mark_finance_reviewed: 'select mark_finance_reviewed($1) as value',
  new_mc_member_code: 'select new_mc_member_code($2) as value',
  offer_mcp_handover: 'select offer_mcp_handover($2, $4) as value',
  review_expense_claim: "select * from review_expense_claim($8, 'approved')",
  run_routines: 'select run_routines($1) as value',
  set_feature_request_status: "select set_feature_request_status($7, 'planned') as value",
  set_mc_member_role: "select set_mc_member_role($2, $4, 'vp_finance') as value",
  set_member_term: 'select set_member_term($1, $4, current_date, null) as value',
  set_university_account: 'select set_university_account($1, true) as value',
  tabling_add_walk_in: 'select tabling_add_walk_in($7, $4) as value',
  tabling_mark: "select tabling_mark($7, $4, 'attended') as value",
  tabling_sign_up: 'select tabling_sign_up($7) as value',
  tabling_withdraw: 'select tabling_withdraw($7) as value',
  touch_last_seen: 'select touch_last_seen() as value',
  unlink_lc_from_mc: 'select unlink_lc_from_mc($1) as value',
};
const selfMutations = new Set(['create_mc', 'create_demo_lc', 'disconnect_expa', 'disconnect_google_calendar', 'join_from_expa', 'touch_last_seen']);

describe('mutation RPC boundaries', () => {
  it('registers every mutation so a new function cannot escape the gate', () => {
    expect(Object.keys(mutationCases).sort()).toEqual(inventory.functions.filter(f => f.kind === 'mutation').map(f => f.name).sort());
  });

  it('calls every mutation as every identity and rejects foreign changes or returned data', async () => {
    for (const a of actors) {
      // A real LC, department, claim, exchange and sequence in the other MC.
      const s = sites.find(s => s.mc !== a.mc)!;
      const claim = seeded.get('expense_claims')!.find(r => r.project_id === s.lc.id)!.id;
      const seq = seeded.get('outreach_sequences')!.find(r => r.project_id === s.lc.id)!.id;
      const ex = seeded.get('exchanges')!.find(r => r.project_id === s.lc.id)!.id;
      const params = [s.lc.id, s.mc, s.lc.departments['Outgoing Global Volunteer'], s.people[3].id, null, null, 'ffffffff-ffff-4fff-8fff-ffffffffffff', claim, seq, ex];
      const prefix = 'with args as (select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid) ';
      for (const [name, sql] of Object.entries(mutationCases)) {
        try {
          const rows = await asUser(db, a.id, async tx => {
            const got = (await tx.query<Row>(prefix + sql, params)).rows;
            if (name === 'create_mc' || name === 'create_demo_lc') {
              expect(a.id).not.toBeNull();
              const owner = name === 'create_mc'
                ? (await tx.query('select user_id from mc_members where mc_id=$1', [got[0].value])).rows.map(r => r.user_id)
                : (await tx.query('select owner_id from projects where id=$1', [got[0].value])).rows.map(r => r.owner_id);
              expect(owner).toContain(a.id);
            }
            return got;
          });
          if (selfMutations.has(name)) {
            if (name === 'join_from_expa') expect(rows).toEqual([{ value: { status: 'none' } }]);
            continue;
          }
          if (name.startsWith('import_')) {
            expect(rows).toHaveLength(1); expect(rows[0].inserted).toBe(0); expect(rows[0].updated).toBe(0); expect(rows[0].failed).toBe(1);
            expect(JSON.stringify(rows)).not.toMatch(/Private|matrix-lcp|matrix-member/);
          } else if (name === 'adjust_goal_value') expect(rows).toEqual([{ value: null }]);
          else throw new Error(`Unexpected successful foreign mutation ${name}: ${JSON.stringify(rows)}`);
        } catch (e) {
          // Only explicit authorization/application denials count as rejection.
          // Syntax errors, missing overloads, assertions and other faults fail.
          const code = (e as {code?: string}).code;
          if (!['42501', 'P0001'].includes(code ?? '')) throw new Error(`${a.role}/${name}: ${String(e)}`);
        }
      }
    }
  }, 120_000);

  it('executes pure helpers for every identity without querying private records', async () => {
    const names = ['_try_uuid', 'currency_for_country', 'lc_name_key', 'routine_due_on'];
    expect(names.sort()).toEqual(inventory.functions.filter(f => f.kind === 'utility').map(f => f.name).sort());
    for (const a of actors) {
      for (const [sql, value] of [
        ["select _try_uuid('not-a-uuid') as value", null],
        ["select currency_for_country('PT') as value", 'EUR'],
        ["select lc_name_key('LC Lisbon') as value", 'lisbon'],
        ['select routine_due_on(null::routines, current_date) as value', false],
      ] as const) {
        try { expect((await asUser(db, a.id, tx => tx.query(sql))).rows).toEqual([{ value }]); }
        catch(e) { if (!(a.id === null && (e as {code?: string}).code === '42501')) throw e; }
      }
    }
  });
});

it('shows a three-member LC average while suppressing two-person departments and the two-VP executive board', async () => {
  for (const s of sites) {
    await asUser(db, s.lc.president, async tx => {
      const memberRows = (await tx.query<Row>('select * from get_member_pulse($1)', [s.lc.id])).rows;
      const latest = Math.max(...memberRows.map(r => new Date(r.period_start as Date).getTime()));
      const current = memberRows.filter(r => new Date(r.period_start as Date).getTime() === latest);
      expect(current.find(r => r.department_id === null)).toMatchObject({ avg_score: '4.00', respondent_count: 3, suppressed: false, question_id: 'energy' });
      for (const row of current.filter(r => r.department_id !== null)) expect(row).toMatchObject({ avg_score: null, respondent_count: null, suppressed: true, question_id: null });
      const exec = (await tx.query<Row>('select * from get_exec_pulse($1)', [s.lc.id])).rows;
      expect(exec).toHaveLength(8);
      expect(exec.every(r => r.suppressed && r.avg_score === null && r.respondent_count === null)).toBe(true);
      await tx.query('update projects set min_wellbeing_respondents=2 where id=$1', [s.lc.id]);
      const department = (await tx.query<Row>('select * from get_member_pulse($1, $2)', [s.lc.id, s.lc.departments['Outgoing Global Volunteer']])).rows;
      expect(department.find(r => new Date(r.period_start as Date).getTime() === latest)).toMatchObject({ avg_score: '4.00', respondent_count: 2, suppressed: false });
    });
  }
});
