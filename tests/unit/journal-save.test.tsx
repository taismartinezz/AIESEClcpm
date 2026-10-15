import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mock infrastructure ───────────────────────────────────────────────────────

// Stable mock insert fn so tests can assert call counts
const mockInsert = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { user: { id: 'user-123' }, access_token: 'tok' } },
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'journal_entries') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
          insert: mockInsert,
        }
      }
      if (table === 'tasks') {
        return {
          select: vi.fn().mockReturnThis(),
          contains: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ count: 0, error: null }),
        }
      }
      if (table === 'notifications') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      if (table === 'user_settings') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }),
  },
}))

vi.mock('@/context/ProjectContext', () => ({
  useProject: () => ({ projectId: 'proj-1', setProjectId: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/journal',
}))

// Key route: return disabled so encryption is skipped
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ disabled: true }),
} as Response)

// ── Helpers ───────────────────────────────────────────────────────────────────

function setupInsertSuccess() {
  // mockResolvedValue (not Once) so every call returns valid data — the savingRef
  // guard should prevent a second call, but the mock shouldn't mask the bug with a TypeError.
  mockSingle.mockResolvedValue({
    data: { id: 'entry-1', created_at: '2026-10-03T10:00:00Z', updated_at: '2026-10-03T10:00:00Z' },
    error: null,
  })
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnThis(), single: mockSingle })
}

function setupInsertError(message = 'DB error') {
  mockSingle.mockResolvedValue({ data: null, error: { message, code: '42P01' } })
  mockInsert.mockReturnValue({ select: vi.fn().mockReturnThis(), single: mockSingle })
}

async function renderJournal() {
  const { default: JournalPage } = await import('@/app/(main)/journal/page')
  render(<JournalPage />)
  // Wait until the page has finished loading entries
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /save entry/i })).toBeInTheDocument()
  }, { timeout: 4000 })
}

async function typeInDefaultPrompt(text: string) {
  const textarea = screen.getByPlaceholderText(/take a moment/i)
  await userEvent.clear(textarea)
  await userEvent.type(textarea, text)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Journal save — duplicate-submit & editor reset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset module cache so component state starts fresh each test
    vi.resetModules()
    // Clear draft from localStorage
    try { localStorage.removeItem('canopy_journal_draft') } catch { /* ignore */ }
  })

  it('clears the editor after a successful save', async () => {
    setupInsertSuccess()
    await renderJournal()

    await typeInDefaultPrompt('Today was productive.')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save entry/i }))
    })

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })

    // Textarea should now be empty
    const textarea = screen.queryByPlaceholderText(/take a moment/i)
    if (textarea) {
      expect((textarea as HTMLTextAreaElement).value).toBe('')
    }

    // Check-in counter should show 0 answered (no "5 / 5" anywhere)
    // If check-in section is visible, 0 responses should be reflected
    expect(screen.queryByText(/5 \/ 5 answered/i)).not.toBeInTheDocument()
  })

  it('inserts exactly once when Save entry is clicked twice rapidly', async () => {
    setupInsertSuccess()
    await renderJournal()

    await typeInDefaultPrompt('Some reflection text.')

    const saveBtn = screen.getByRole('button', { name: /save entry/i })

    await act(async () => {
      fireEvent.click(saveBtn)
      fireEvent.click(saveBtn)
    })

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })
  })

  it('leaves text in the editor and re-enables Save after an insert error', async () => {
    setupInsertError('network timeout')
    await renderJournal()

    await typeInDefaultPrompt('My draft text.')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save entry/i }))
    })

    await waitFor(() => {
      expect(mockInsert).toHaveBeenCalledTimes(1)
    })

    // Save button should be re-enabled (not disabled, not showing "Saving…")
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /save entry/i })
      expect(btn).not.toBeDisabled()
    })

    // Text should still be in the editor
    const textarea = screen.queryByPlaceholderText(/take a moment/i)
    if (textarea) {
      expect((textarea as HTMLTextAreaElement).value).toBe('My draft text.')
    }
  })
})
