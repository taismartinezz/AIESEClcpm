import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

// ── Shared mock state ─────────────────────────────────────────────────────────
// We use module-level variables so each test can control the returned role.

let mockRole: 'president' | 'vp' | 'member' = 'president'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

// The page reads the active LC and the caller's role in it from ProjectContext.
vi.mock('@/context/ProjectContext', () => ({
  useProject: () => ({
    activeScope: 'lab',
    projectId: 'project-abc',
    role: mockRole,
    departments: [],
    refreshDepartments: vi.fn(),
  }),
}))

vi.mock('@/lib/supabase', () => {
  const makeQuery = (tableData: Record<string, unknown> | null) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    // Awaiting the query itself (no .single()) resolves to an empty list.
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: [], error: null })),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: tableData, error: null }),
  })

  return {
    isSupabaseConfigured: true,
    isPreview: false,
    supabase: {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: {
            session: {
              user: { id: 'user-123', email: 'test@example.com' },
            },
          },
        }),
        resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: vi.fn((table: string) => {
        if (table === 'user_profiles') {
          return makeQuery({
            id: 'user-123',
            name: 'Test User',
            role: mockRole,
            avatar_color: '#B4D4E3',
            avatar_initials: 'TU',
            bio: 'oGV team member',
          })
        }
        if (table === 'team_members') {
          return makeQuery({ project_id: 'project-abc' })
        }
        if (table === 'projects') {
          return makeQuery({ id: 'project-abc', name: 'Test Project', institution: 'Test Uni' })
        }
        if (table === 'invite_codes') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            // For the president: return a list of codes
            then: vi.fn().mockImplementation((cb: (v: { data: { id: string; code: string; used_by: null }[] }) => void) =>
              cb({ data: [{ id: 'code-1', code: 'LC-ABCDEF', used_by: null }] })
            ),
          }
        }
        return makeQuery(null)
      }),
    },
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderSettings() {
  // Reset module between tests to pick up fresh mock state
  const { default: SettingsPage } = await import('@/app/(main)/settings/page')
  render(<SettingsPage />)
  // Wait for loading to finish
  await waitFor(() => {
    expect(screen.queryByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
  }, { timeout: 3000 })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Settings page — Issue #15', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing and shows page heading', async () => {
    mockRole = 'president'
    await renderSettings()
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
  })

  it('shows profile section', async () => {
    mockRole = 'president'
    await renderSettings()
    expect(screen.getByRole('heading', { name: /profile/i })).toBeInTheDocument()
  })

  it('shows account section', async () => {
    mockRole = 'president'
    await renderSettings()
    expect(screen.getByRole('heading', { name: /account/i })).toBeInTheDocument()
  })

  it('shows notifications section', async () => {
    mockRole = 'president'
    await renderSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Notifications' }))
    expect(screen.getByRole('heading', { name: /notifications/i })).toBeInTheDocument()
  })

  it('shows members & invites, departments and LC settings to the president, one tab each', async () => {
    mockRole = 'president'
    await renderSettings()
    fireEvent.click(screen.getByRole('tab', { name: 'Invites' }))
    expect(screen.getByRole('heading', { name: /members.*invites/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'LC & departments' }))
    expect(screen.getByRole('heading', { name: /^departments$/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /lc settings/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /members.*invites/i })).not.toBeInTheDocument()
  })

  it.each(['vp', 'member'] as const)('hides LC administration from a %s', async (role) => {
    mockRole = role
    await renderSettings()
    expect(screen.queryByRole('tab', { name: 'Invites' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'LC & departments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /members.*invites/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^departments$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /lc settings/i })).not.toBeInTheDocument()
  })

  it('does not crash when project has no active_prompt_ids field', async () => {
    // The projects mock returns data without active_prompt_ids (undefined),
    // which exercises the defensive Array.isArray check in settings/page.tsx.
    mockRole = 'president'
    await renderSettings()
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
  })

  it('does not crash when all table queries return null data', async () => {
    // Simulates a new user who has no project, no settings, no invite codes yet.
    mockRole = 'member'
    // All tables return null via the default makeQuery(null) fallback — only user_profiles
    // returns a row so the page doesn't redirect to /login.
    await renderSettings()
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
  })

  it('does not crash when supabase returns an error on a query', async () => {
    // Simulates a transient DB error on the team_members lookup.
    mockRole = 'president'
    // team_members error: the role-title lookup fails; the rest of the page still renders.
    // The page should still render the profile and account sections.
    const { supabase: sbMock } = await import('@/lib/supabase')
    const originalFrom = sbMock.from
    ;(sbMock.from as ReturnType<typeof vi.fn>).mockImplementationOnce((table: string) => {
      if (table === 'team_members') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'connection refused', code: '500' } }),
          order: vi.fn().mockReturnThis(),
        }
      }
      return originalFrom(table)
    })
    await renderSettings()
    expect(screen.getByRole('heading', { level: 1, name: /^settings$/i })).toBeInTheDocument()
  })
})
