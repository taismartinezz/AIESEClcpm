# Auth Setup

Canopy uses **Supabase Auth** for all sign-in flows. OAuth providers are configured
in the Supabase dashboard; the app code picks up which ones to show via the
`NEXT_PUBLIC_AUTH_PROVIDERS` environment variable.

---

## 1. Google OAuth

### Google Cloud Console

1. Go to **APIs & Services → Credentials** in your Google Cloud project.
2. Create (or open) an **OAuth 2.0 Client ID** of type *Web application*.
3. Under **Authorized redirect URIs**, add exactly:
   ```
   https://<your-supabase-project-ref>.supabase.co/auth/v1/callback
   ```
   For the Canopy production project this is:
   ```
   https://kslutjluqodviyrovldp.supabase.co/auth/v1/callback
   ```
4. Under **Authorized JavaScript origins**, add your app domains:
   ```
   https://canopy-tawny-six.vercel.app
   http://localhost:3000
   ```
5. Copy the **Client ID** and **Client Secret**.

### Supabase dashboard

1. Open your project, go to **Authentication → Providers**.
2. Find **Google**, enable it, and paste in the Client ID and Client Secret.
3. Go to **Authentication → URL Configuration**.
4. In **Redirect URLs**, add:
   ```
   https://canopy-tawny-six.vercel.app/auth/callback
   http://localhost:3000/auth/callback
   ```
5. Set the **Site URL** to your production domain:
   ```
   https://canopy-tawny-six.vercel.app
   ```

### Environment variables

Add to Vercel (and `.env.local` for local dev):

```
NEXT_PUBLIC_GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_ID=<client-id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client-secret>
NEXT_PUBLIC_AUTH_PROVIDERS=google
```

---

## 2. Enabling / disabling provider buttons

Set `NEXT_PUBLIC_AUTH_PROVIDERS` to a comma-separated list of the providers you
have configured. Only those buttons will appear on the login page.

```
# Show only Google (recommended for initial launch)
NEXT_PUBLIC_AUTH_PROVIDERS=google

# Show Google and GitHub
NEXT_PUBLIC_AUTH_PROVIDERS=google,github

# Show all three (legacy default when env var is unset)
NEXT_PUBLIC_AUTH_PROVIDERS=google,microsoft,github
```

Providers not in this list are hidden entirely, so users are never sent to a
Supabase error page for an unconfigured provider.

---

## 3. Google Calendar integration (optional)

The **Settings → Integrations** page has a "Connect Google Calendar" button.
It triggers a separate OAuth flow with calendar scopes. For this to work:

1. Enable the **Google Calendar API** in Google Cloud Console
   (APIs & Services → Library → Google Calendar API → Enable).
2. The same OAuth client and redirect URI used above are reused.
3. Add `GOOGLE_CLIENT_SECRET` to Vercel so the server can refresh expired tokens.

> Note: Calendar scope is not requested at sign-in time -- only when the user
> explicitly connects. This avoids Google's "unverified app" consent screen
> appearing for every user during sign-in.

---

## 4. How the OAuth flow works

```
/login  →  supabase.auth.signInWithOAuth({ provider: "google", redirectTo: origin + "/auth/callback" })
        →  Supabase redirects to Google
        →  Google redirects to: https://<supabase-ref>.supabase.co/auth/v1/callback
        →  Supabase exchanges code, then redirects to: /auth/callback?code=...
        →  /auth/callback page calls exchangeCodeForSession(code)
        →  Redirects to "/" (dashboard) or "/onboarding"
```

On failure (provider disabled, user cancels, etc.) Supabase redirects to
`/auth/callback?error=...&error_description=...`, which the callback page
forwards to `/login?error=...&error_description=...` for display.

---

## 5. No middleware required

This project uses client-side session detection (`supabase.auth.getSession()`
on mount) rather than server-side middleware. There is no `middleware.ts` by
design -- adding one would require `@supabase/ssr` and a cookie-based client,
which is a larger refactor. The current approach is compatible with Vercel's
edge network and works correctly on all deployment environments.
