# Auth Setup

AIESEClcpm uses **Supabase Auth**. Email + password sign-in works out of the box
once `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` point at your
own Supabase project. No provider credentials are stored in this repository.

---

## 1. URL configuration (your Supabase dashboard)

**Authentication → URL Configuration**

- **Site URL:** your deployment's public URL (`NEXT_PUBLIC_APP_URL`).
- **Redirect URLs:** add `<your app URL>/auth/callback` and
  `http://localhost:3000/auth/callback` for local development.

---

## 2. Optional OAuth providers

Social sign-in buttons are off unless you turn them on. To add one:

1. Enable the provider under **Authentication → Providers** in your Supabase
   dashboard and follow Supabase's instructions for that provider. Its client
   ID and secret live in Supabase, not in this app.
2. List it in `NEXT_PUBLIC_AUTH_PROVIDERS` (comma-separated: `google`,
   `microsoft`, `github`). Leave it empty for email-only sign-in.

```
# Email only
NEXT_PUBLIC_AUTH_PROVIDERS=

# Email + GitHub
NEXT_PUBLIC_AUTH_PROVIDERS=github
```

Providers not in the list are hidden, so nobody is sent to an error page for a
provider you haven't configured.

---

## 3. How the OAuth flow works

```
/login  →  supabase.auth.signInWithOAuth({ provider, redirectTo: origin + "/auth/callback" })
        →  Supabase sends the user to the provider and back to Supabase
        →  Supabase redirects to /auth/callback?code=...
        →  /auth/callback calls exchangeCodeForSession(code)
        →  Redirects to "/" (dashboard) or "/onboarding"
```

On failure Supabase redirects to `/auth/callback?error=...&error_description=...`,
which forwards to `/login?error=...` for display.

---

## 4. Session handling

Sessions are detected client-side (`supabase.auth.getSession()` on mount). API
routes verify the Bearer JWT themselves via `requireAuth()` in
`src/lib/api-auth.ts`; `src/middleware.ts` only rejects `/api/*` calls that carry
no token at all.
