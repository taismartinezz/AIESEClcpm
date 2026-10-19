import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import GlobalSearch from '@/components/ui/GlobalSearch'

const backend = vi.hoisted(() => ({
  reads: [] as { table: string; select: string; filters: [string, string][]; term: string }[],
  resolve: new Map<string, (result: { data: unknown[] }) => void>(),
  push: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: backend.push }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  const read = { table, select: '', filters: [] as [string, string][], term: '' }
  const query = {
    select: (columns: string) => { read.select = columns; return query },
    eq: (column: string, value: string) => { read.filters.push([column, value]); return query },
    is: () => query,
    or: (filter: string) => { read.filters.push(["or", filter]); return query },
    order: () => query,
    ilike: (_column: string, term: string) => { read.term = term; return query },
    limit: () => {
      backend.reads.push(read)
      if (table !== 'tasks') return Promise.resolve({ data: [] })
      return new Promise<{ data: unknown[] }>(resolve => backend.resolve.set(read.term, resolve))
    },
  }
  return query
} } }))

beforeEach(() => { backend.reads.length = 0; backend.resolve.clear(); backend.push.mockClear() })

it('uses real schema columns, rejects stale results and navigates without a document reload', async () => {
  render(<GlobalSearch projectId="lc-1" />)
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
  const input = screen.getByPlaceholderText('Search tasks, reminders, the Drive, chat…')
  fireEvent.change(input, { target: { value: 'older' } })
  await waitFor(() => expect(backend.resolve.has('%older%')).toBe(true))
  fireEvent.change(input, { target: { value: 'newer' } })
  await waitFor(() => expect(backend.resolve.has('%newer%')).toBe(true))
  await act(async () => backend.resolve.get('%newer%')!({ data: [{ id: 'new', title: 'Newer result', status: 'todo' }] }))
  expect(screen.getByText('Newer result')).toBeVisible()
  await act(async () => backend.resolve.get('%older%')!({ data: [{ id: 'old', title: 'Older result', status: 'todo' }] }))
  expect(screen.queryByText('Older result')).not.toBeInTheDocument()
  expect(backend.reads.find(read => read.table === 'reminders')?.select).toContain('due_at')
  expect(backend.reads.find(read => read.table === 'reminders')?.filters).toContainEqual(['or', 'project_id.eq.lc-1,project_id.is.null'])
  expect(backend.reads.find(read => read.table === 'chat_messages')?.filters).toContainEqual(['channel', 'lab:lc-1'])
  expect(backend.reads.some(read => read.table === 'journal_entries')).toBe(false)
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(backend.push).toHaveBeenCalledWith('/tasks?openTask=new')
})
