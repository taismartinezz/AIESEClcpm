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

## 2. Google sign-in and Google Calendar

"Continue with Google" shows on the login page by default, and Scheduling has a
**Connect Google Calendar** button (read-only: people see their own Google
events in their own calendar view). Both use one Google OAuth client.

**In Google Cloud Console** (console.cloud.google.com), in a project for the app:

1. **APIs & Services → Library**: enable **Google Calendar API**.
2. **APIs & Services → OAuth consent screen**: user type *External*; app name,
   support email; under *Scopes* add `.../auth/calendar.readonly`. While the app
   is in *Testing*, add the Google accounts that will use it as *Test users*
   (up to 100). Publishing for everyone needs Google's verification because
   calendar access is a sensitive scope.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   type *Web application*. Under **Authorized redirect URIs** add
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
   (Supabase shows the exact URL on its Google provider page). Copy the
   **Client ID** and **Client secret**.

**In Supabase:**

4. **Authentication → Sign In / Providers → Google**: switch it on and paste the
   Client ID and Client secret.
5. On the same page, switch on **Allow manual linking**. "Connect Google
   Calendar" links Google to the account someone already has, instead of
   creating a second account.

**In Vercel** (and `.env` locally):

6. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to the same values, so the
   server can renew calendar access (Google's access lasts one hour; without
   these people have to reconnect).

To hide the Google button, set `NEXT_PUBLIC_AUTH_PROVIDERS=none`; to offer
others too, list them, e.g. `google,github` (each must be enabled in Supabase).

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
