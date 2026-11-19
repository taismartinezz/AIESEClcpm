# Permission isolation checks

Run `npx vitest run tests/db/permission-matrix.test.ts --maxWorkers=1` with Node.js 24.
The `Permission isolation (all roles)` CI job runs on every pull request, including
draft PRs and PRs targeting branches other than main. Any unexpected **or missing**
row, unexpected function result, unregistered table, or unregistered function
signature fails the job. Branch protection must require this check if merges must
be blocked until it passes.

The fixture creates two MCs with two linked LCs each. Each LC has one LCP, two VPs
leading different departments, and three members. Each MC has an MCP, a general
MCVP and a finance MCVP. An authenticated outsider and a signed-out identity bring
the matrix to 32 identities. Each LC contains check-ins, exchanges and history,
partners and contacts, ledger entries, claims and receipt objects, LC chat and
DMs, shared and personal tasks, personal reminders, shared and personal Drive
items, and outreach templates, sequences, steps, enrollments and sent messages.
Distinct fake EXPA and Google connections make credential-table checks nonempty.

Tests apply all migrations to a fresh PGlite PostgreSQL database, then set the
non-bypass `authenticated` or `anon` database role and the JWT subject that
PostgREST uses. Queries run without client-side LC filters. Expected results are
defined independently of the SQL policies and compared as complete row sets.
No service-role query is used to simulate a signed-in person. Test transactions
roll back permission probes; fixture insertion intentionally runs as the database
owner. These tests exercise database authorization, not hosted Supabase Auth,
OAuth token exchange, network configuration, or storage HTTP signing.

The inventory covers every public table, every public function signature,
receipt storage reads, and direct access denial for server-only helpers. Trigger
functions are catalogued but cannot be invoked as ordinary data RPCs. Pure
helpers and mutation RPCs have separate explicit coverage. Tables outside the
requested modules can be empty; their query and catalog checks do not claim
that every possible row shape is tested. Existing module suites cover additional
write paths, subprojects, invites and integrations. New tables, RPCs, overloads
and fixture types must add explicit expectations rather than updating the
inventory alone.

## Enforced boundaries

| Identity | LC data |
| --- | --- |
| MCP / MCVP, including finance | Exchange counts by linked LC and product; no LC personal, outreach, finance, claim or wellbeing details |
| LCP | Their LC's shared and operational records; never another author's individual check-in, personal tasks/files/reminders or DM |
| LCVP | LC-shared records and private operational data for departments they lead |
| Member | LC-shared records, their own claims and check-ins, and their own personal items / participating DMs |
| Signed out / outsider | No private LC data |

MC users can still manage their own national team and read its own team directory
and national announcements. Public LC/MC discovery returns organization names,
not individual member identities. LC members can read their own MC's term settings.
Personal reminders are private; reminders explicitly shared with the LC or a
subproject retain their documented shared scope.

Claims can be reviewed by the LC's president or the claim department's VP, but
never by the submitter, including executive submitters. Only the LCP records
manual ledger entries; claim approvals generate linked entries. An LCVP cannot
read another department's receipts or ledger. The LC-wide compliance report is
LCP-only because it includes the entire ledger balance. The old national finance,
health and team-insight detail RPCs are no longer callable by app roles.
`lc_term_start` and the email-to-member lookup require LC membership. Event
recipient enumeration also requires membership (or a trusted server role).

EXPA's server-verified placement assigns LCP/LCVP/member roles and departments.
MCP maps to MCP; finance vice presidents map to `vp_finance`; other national
positions use MC membership with their function retained in the verified profile.
An MC finance member who is not a vice president does not gain the VP role.
EXPA sync rejects ordinary members and national-only users before fetching applications.
VP syncs include only products led in the selected LC; excluded products never
enter returned rows or skipped counts. Import and provider errors do not return
personal names or raw backend details.
Existing memberships remain unchanged by subsequent sign-ins. Clients cannot
write EXPA placement or token records.

Apply `supabase/migrations/20261110001_permission_boundaries.sql` through the normal
migration deployment before expecting these changes in a hosted project. The
regenerated `supabase/full_schema.sql` includes the same changes for fresh projects.
Passing this fixture is regression evidence, not a proof that all production
configurations, multi-membership combinations or administrator access are safe.
