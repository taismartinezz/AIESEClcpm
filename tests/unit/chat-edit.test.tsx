import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { MessageRow } from '@/app/(main)/chat/_components/MessageRow'
import type { ChatMessage } from '@/app/(main)/chat/_components/types'

it('keeps an in-progress message edit when the server updates the original message', () => {
  const message: ChatMessage = {
    id: 'message-1', channel: 'lab:lc-1', senderId: 'user-1', senderName: 'Test User',
    content: 'Original message', createdAt: '2026-10-18T12:00:00Z', threadParentId: null,
    deletedAt: null, threadCount: 0, reactions: [], mentionedUserIds: [], isPinned: false, attachments: [],
  }
  const onEdit = vi.fn()
  const props = { prevMsg: null, currentUserId: 'user-1', onEdit, onDelete: vi.fn(), onReact: vi.fn(), onOpenThread: vi.fn(), onPin: vi.fn() }
  const view = render(<MessageRow {...props} msg={message} />)
  fireEvent.mouseEnter(view.container.firstElementChild!)
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }))
  const editor = screen.getByRole('textbox')
  expect(editor).toHaveFocus()
  fireEvent.change(editor, { target: { value: 'My unfinished correction' } })
  view.rerender(<MessageRow {...props} msg={{ ...message, content: 'Another device changed this' }} />)
  expect(editor).toHaveValue('My unfinished correction')
  fireEvent.keyDown(editor, { key: 'Enter' })
  expect(onEdit).toHaveBeenCalledWith('message-1', 'My unfinished correction')
})
