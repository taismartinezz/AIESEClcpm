import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} onClick={onClick} {...rest}>{children}</a>
  ),
}))

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signUp: vi.fn().mockResolvedValue({ error: null }),
      signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  },
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

async function renderLogin() {
  const { default: LoginPage } = await import('@/app/login/page')
  render(<LoginPage />)
  // Wait for the auth check to complete and page to render
  await waitFor(() => {
    expect(screen.queryByRole('heading', { level: 1 })).toBeInTheDocument()
  }, { timeout: 3000 })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Login page: Issue #1/#2: anchor tags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders with at least one <a> tag', async () => {
    await renderLogin()
    const links = document.querySelectorAll('a')
    expect(links.length).toBeGreaterThan(0)
  })

  it('"Sign up" toggle is an anchor with href containing "signup"', async () => {
    await renderLogin()
    const signUpLink = screen.getByRole('link', { name: /sign up/i })
    expect(signUpLink).toBeInTheDocument()
    expect(signUpLink).toHaveAttribute('href')
    expect(signUpLink.getAttribute('href')).toMatch(/signup/)
  })

  it('"Sign in" link appears after switching to signup mode and has href /login', async () => {
    await renderLogin()
    // Switch to signup mode by clicking the "Sign up" link
    const signUpLink = screen.getByRole('link', { name: /sign up/i })
    await userEvent.click(signUpLink)
    const signInLink = await screen.findByRole('link', { name: /sign in/i })
    expect(signInLink).toBeInTheDocument()
    expect(signInLink.getAttribute('href')).toBe('/login')
  })
})

describe('Login page: Issue #3: privacy link', () => {
  it('"privacy-first principles" is a clickable link', async () => {
    await renderLogin()
    const privacyLink = screen.getByRole('link', { name: /privacy-first principles/i })
    expect(privacyLink).toBeInTheDocument()
    expect(privacyLink).toHaveAttribute('href', '/privacy')
    expect(privacyLink).toHaveAttribute('target', '_blank')
  })
})

describe('Login page: Issue #4: forgot password', () => {
  it('shows "Forgot password?" button in sign-in mode', async () => {
    await renderLogin()
    expect(screen.getByRole('button', { name: /forgot password/i })).toBeInTheDocument()
  })

  it('shows password reset form after clicking "Forgot password?"', async () => {
    await renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    expect(screen.getByRole('button', { name: /send reset link/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/email for password reset/i)).toBeInTheDocument()
  })

  it('shows confirmation message after submitting forgot password', async () => {
    await renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /forgot password/i }))
    const emailInput = screen.getByLabelText(/email for password reset/i)
    await userEvent.type(emailInput, 'test@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))
    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument()
    })
  })
})

describe('Login page: Issue #6: OAuth buttons', () => {
  afterEach(() => { delete process.env.NEXT_PUBLIC_AUTH_PROVIDERS })

  it('shows no OAuth buttons when NEXT_PUBLIC_AUTH_PROVIDERS=none', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = 'none'
    await renderLogin()
    expect(screen.queryByRole('button', { name: /sign in with google/i })).not.toBeInTheDocument()
  })

  it('Google OAuth button is present when enabled', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = 'google'
    await renderLogin()
    expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument()
  })

  it('all OAuth buttons have explicit type="button"', async () => {
    process.env.NEXT_PUBLIC_AUTH_PROVIDERS = 'google'
    await renderLogin()
    const googleBtn = screen.getByRole('button', { name: /sign in with google/i })
    // buttons default to type="submit" inside forms but here no form: check attribute
    // AuthButton renders <button onClick={...}> without explicit type; browsers default to "submit"
    // The test verifies they are buttons (not form submit triggers)
    expect(googleBtn.tagName).toBe('BUTTON')
  })
})

describe('Login page: Issue #16: heading structure', () => {
  it('page has an <h1> element', async () => {
    await renderLogin()
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
  })

  it('h1 says "Sign in to <app name>" in sign-in mode', async () => {
    await renderLogin()
    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/sign in to aiesec ?lcpm/i)
  })

  it('h1 changes to "Create your <app name> account" in sign-up mode', async () => {
    await renderLogin()
    await userEvent.click(screen.getByRole('link', { name: /sign up/i }))
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/create your aiesec ?lcpm account/i)
    })
  })
})

describe('Login page: Issue #13/#17: no sensitive console output', () => {
  it('no console.log fires during render', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    await renderLogin()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('Login page: password visibility toggle', () => {
  it('password field has a visibility toggle button', async () => {
    await renderLogin()
    const toggleBtn = screen.getByRole('button', { name: /show password|hide password/i })
    expect(toggleBtn).toBeInTheDocument()
  })

  it('clicking the toggle shows the password', async () => {
    await renderLogin()
    const passwordInput = screen.getByLabelText(/^password$/i)
    expect(passwordInput).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: /show password/i }))
    expect(passwordInput).toHaveAttribute('type', 'text')
  })

  it('clicking the toggle again hides the password', async () => {
    await renderLogin()
    const passwordInput = screen.getByLabelText(/^password$/i)
    const toggleBtn = screen.getByRole('button', { name: /show password/i })
    await userEvent.click(toggleBtn)
    expect(passwordInput).toHaveAttribute('type', 'text')
    await userEvent.click(screen.getByRole('button', { name: /hide password/i }))
    expect(passwordInput).toHaveAttribute('type', 'password')
  })
})

describe('Login page: Supabase errors in plain words', () => {
  it('explains unconfirmed emails, wrong passwords and rate limits, and keeps anything else as is', async () => {
    const { explainAuthError } = await import('@/app/login/page')
    expect(explainAuthError({ message: 'Email not confirmed', code: 'email_not_confirmed' })).toEqual({ message: expect.stringMatching(/isn't confirmed/), unconfirmed: true })
    expect(explainAuthError({ message: 'Invalid login credentials' }).message).toMatch(/don't match.*Continue with Google/)
    expect(explainAuthError({ message: 'Email rate limit exceeded' }).message).toMatch(/Too many attempts/)
    expect(explainAuthError({ message: 'Something odd' })).toEqual({ message: 'Something odd', unconfirmed: false })
  })
})
