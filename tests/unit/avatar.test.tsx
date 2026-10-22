import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Avatar from '@/components/ui/Avatar'

const baseUser = {
  name: 'Taylor Smith',
  avatarColor: '#B4D4E3',
  avatarInitials: 'TS',
}

describe('Avatar: Issue #14: profile picture display', () => {
  it('renders initials when no avatarUrl is provided', () => {
    render(<Avatar user={baseUser} />)
    const initialsEl = screen.getByTestId('avatar-initials')
    expect(initialsEl).toBeInTheDocument()
    expect(initialsEl).toHaveTextContent('TS')
  })

  it('renders an <img> tag when avatarUrl is provided', () => {
    render(<Avatar user={{ ...baseUser, avatarUrl: 'https://example.com/photo.jpg' }} />)
    const img = screen.getByTestId('avatar-img')
    expect(img).toBeInTheDocument()
    expect(img.tagName).toBe('IMG')
  })

  it('img has the correct src attribute', () => {
    const url = 'https://example.com/photo.jpg'
    render(<Avatar user={{ ...baseUser, avatarUrl: url }} />)
    const img = screen.getByTestId('avatar-img')
    expect(img).toHaveAttribute('src', url)
  })

  it('img has correct alt text equal to user name', () => {
    render(<Avatar user={{ ...baseUser, avatarUrl: 'https://example.com/photo.jpg' }} />)
    const img = screen.getByTestId('avatar-img')
    expect(img).toHaveAttribute('alt', 'Taylor Smith')
  })

  it('falls back to initials div when img fails to load', () => {
    render(<Avatar user={{ ...baseUser, avatarUrl: 'https://broken-url.com/photo.jpg' }} />)
    const img = screen.getByTestId('avatar-img')
    expect(img).toBeInTheDocument()
    // Simulate image load failure
    fireEvent.error(img)
    // After error, img should be gone and initials should appear
    expect(screen.queryByTestId('avatar-img')).not.toBeInTheDocument()
    expect(screen.getByTestId('avatar-initials')).toBeInTheDocument()
    expect(screen.getByTestId('avatar-initials')).toHaveTextContent('TS')
  })

  it('initials div has aria-label equal to user name', () => {
    render(<Avatar user={baseUser} />)
    const initialsEl = screen.getByTestId('avatar-initials')
    expect(initialsEl).toHaveAttribute('aria-label', 'Taylor Smith')
  })

  it('applies the avatarColor as background when showing initials', () => {
    render(<Avatar user={{ ...baseUser, avatarColor: '#FF5733' }} />)
    const initialsEl = screen.getByTestId('avatar-initials')
    expect(initialsEl).toHaveStyle({ backgroundColor: '#FF5733' })
  })
})
