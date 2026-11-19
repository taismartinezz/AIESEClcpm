// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExpaApplication } from '@/lib/expa-sync';
import { POST } from '@/app/api/expa/sync/route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), service: vi.fn(), token: vi.fn(), fetch: vi.fn(), rpc: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/server-db', () => ({ serviceClient: mocks.service }));
vi.mock('@/lib/expa-server', () => ({ accessTokenFor: mocks.token, fetchApplications: mocks.fetch }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ rpc: mocks.rpc })) }));
type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
interface Query extends PromiseLike<{data: Row[]; error: null}> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  maybeSingle(): Promise<{data: Row | null; error: null}>;
  update(patch: Row): Query;
}
function query(table: string, filters: [string, unknown][] = []): Query {
  const rows = () => (tables[table] ?? []).filter(r => filters.every(([key, value]) => r[key] === value));
  const q: Query = {
    select: () => q,
    eq: (key, value) => query(table, [...filters, [key, value]]),
    maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    update: () => q,
    then: (resolve, reject) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject),
  };
  return q;
}
const application = (id: string, product: string, name: string): ExpaApplication => ({
  id, status: 'approved', created_at: '2026-10-01', date_matched: null,
  date_approved: '2026-10-01', date_realized: null, experience_end_date: null,
  person: { id, full_name: name, email: `${id}@example.com`, contact_detail: null, home_lc: { id: '1001', name: 'Own LC' } },
  opportunity: { id, title: 'Opportunity', programme: { id: '0', short_name_display: product }, host_lc: { id: 'other', name: 'Other LC' } },
});
const request = (projectId = 'lc-a') => new Request('https://example.test/api/expa/sync', {
  method: 'POST', headers: { Authorization: 'Bearer test-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue('vp-a');
  mocks.service.mockReturnValue({ from: query });
  mocks.token.mockResolvedValue({ token: 'fixture-token' });
  mocks.fetch.mockResolvedValue([application('allowed', 'GV', 'Allowed Person'), application('hidden', 'GTa', 'Hidden Person')]);
  mocks.rpc.mockResolvedValue({ data: [{ inserted: 0, updated: 0, failed: 1, errors: ['Hidden Person: detailed backend error'] }], error: null });
  tables.team_members = [{ project_id: 'lc-a', user_id: 'vp-a', role: 'vp' }];
  tables.departments = [
    { project_id: 'lc-a', vp_user_id: 'vp-a', products: ['ogv'] },
    { project_id: 'lc-a', vp_user_id: 'vp-other', products: ['ogta'] },
    { project_id: 'lc-b', vp_user_id: 'vp-a', products: ['ogte'] },
  ];
  tables.expa_connections = [{ user_id: 'vp-a', home_lc_id: '1001', home_lc_name: 'Own LC' }];
});

describe('EXPA sync server boundary', () => {
  it('imports only the VP departments in the selected LC and returns no personal error details', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_project_id: 'lc-a', p_product: 'ogv', p_rows: [expect.objectContaining({ person_name: 'Allowed Person' })] });
    expect(await response.json()).toEqual({ lc: 'Own LC', inserted: 0, updated: 0, failed: 1, skipped: 0, errors: ['ogv: 1 applications could not be imported.'] });
  });

  it.each(['member', 'mcp', 'vp_finance'])('rejects %s before fetching any applications', async role => {
    tables.team_members[0].role = role;
    expect((await POST(request())).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects another LC and signed-out callers before fetching', async () => {
    expect((await POST(request('lc-b'))).status).toBe(403);
    mocks.auth.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects a VP without led products', async () => {
    tables.departments = [];
    expect((await POST(request())).status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('lets the LCP import all LC products while still omitting personal error details', async () => {
    tables.team_members[0].role = 'president';
    expect((await POST(request())).status).toBe(200);
    expect(mocks.rpc.mock.calls.map(c => c[1].p_product).sort()).toEqual(['ogta', 'ogv']);
  });

  it('never forwards provider errors containing personal data', async () => {
    mocks.fetch.mockRejectedValue(new Error('Hidden Person: private upstream detail'));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('Hidden Person');
  });
});
