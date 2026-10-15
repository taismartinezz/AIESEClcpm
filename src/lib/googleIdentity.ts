// Google Identity Services (GIS) helpers.
//
// Signing in with Google's own button + supabase.auth.signInWithIdToken keeps the
// whole flow on our domain, so Google's consent screen says "Sign in to
// canopyteams.tech" (or "Canopy" once branding is verified) instead of showing the
// Supabase project URL that the redirect-based signInWithOAuth flow exposes.

export interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdConfig {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  nonce?: string;
  ux_mode?: "popup" | "redirect";
  use_fedcm_for_prompt?: boolean;
  auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
}

interface GoogleButtonConfig {
  type?: "standard" | "icon";
  theme?: "outline" | "filled_blue" | "filled_black";
  size?: "large" | "medium" | "small";
  text?: "signin_with" | "signup_with" | "continue_with" | "signin";
  shape?: "rectangular" | "pill" | "circle" | "square";
  logo_alignment?: "left" | "center";
  width?: number;
}

interface GoogleAccountsId {
  initialize: (config: GoogleIdConfig) => void;
  renderButton: (parent: HTMLElement, options: GoogleButtonConfig) => void;
  disableAutoSelect: () => void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleAccountsId } };
  }
}

const GIS_SRC = "https://accounts.google.com/gsi/client";
let gisPromise: Promise<GoogleAccountsId> | null = null;

/** Loads the GIS script once and resolves with `google.accounts.id`. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  if (typeof window === "undefined") return Promise.reject(new Error("GIS needs a browser"));
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (gisPromise) return gisPromise;

  gisPromise = new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.accounts?.id) resolve(window.google.accounts.id);
      else reject(new Error("Google Identity Services loaded without google.accounts.id"));
    };
    script.onerror = () => {
      gisPromise = null;
      reject(new Error("Failed to load Google Identity Services"));
    };
    document.head.appendChild(script);
  });
  return gisPromise;
}

/**
 * Returns [rawNonce, hashedNonce]. Google receives the SHA-256 hash; Supabase
 * receives the raw value and checks it against the hash inside the ID token.
 */
export async function createNonce(): Promise<[string, string]> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const raw = btoa(String.fromCharCode(...bytes));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return [raw, hashed];
}

/**
 * Render the GIS button inside `container` (used as an invisible overlay on top of
 * our own "Continue with Google" button so the visible label never changes).
 * GIS caps the width at 400 px.
 */
export function renderGisButton(gis: GoogleAccountsId, container: HTMLElement, width: number): void {
  // Clear any previous render (GIS errors if you call renderButton twice on same element)
  container.innerHTML = "";
  gis.renderButton(container, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: Math.min(400, Math.max(200, Math.round(width))),
  });
}
