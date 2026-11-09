"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { isAppModerator } from "@/lib/postAuthRedirect";
import BrandLogo from "@/components/ui/BrandLogo";

const NOT_A_MODERATOR = "This account isn't a moderator.";

/**
 * /moderators: email and password only (accounts made in Supabase →
 * Authentication), no EXPA or Google. Anyone who isn't a moderator is signed
 * straight out again; wrong passwords and non-moderators get the same kind of
 * answer, so the page doesn't tell whether an email has an account.
 */
export default function ModeratorSignIn() {
  const router = useRouter();
  const [checking, setChecking] = useState(isSupabaseConfigured);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  // Already signed in as a moderator: straight to the moderation page.
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user && await isAppModerator()) { router.replace("/moderation"); return; }
      setChecking(false);
    });
  }, [router]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setLoading(true);
    setError("");
    setNotice("");
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (err) { setError("Wrong email or password."); setLoading(false); return; }
    if (await isAppModerator()) { router.replace("/moderation"); return; }
    await supabase.auth.signOut();
    setPassword("");
    setError(NOT_A_MODERATOR);
    setLoading(false);
  }

  async function forgotPassword() {
    if (!email.trim()) { setError("Enter your email first, then press Forgot password?"); return; }
    setError("");
    await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
    // The same answer whether or not the email has an account.
    setNotice("If that email has an account, a link to set a new password is on its way.");
  }

  const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", height: 44,
    border: "1px solid #DDE1E7", borderRadius: 8, padding: "0 14px",
    fontFamily: "var(--font-roboto)", fontSize: 14, color: "#2D2D2D", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "#4A4A4A", margin: "12px 0 4px" };

  return (
    <div style={{
      minHeight: "100dvh", backgroundColor: "#F6F8FC", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "24px 16px", fontFamily: "var(--font-roboto)",
    }}>
      <div style={{
        backgroundColor: "#ffffff", border: "1px solid #DDE1E7", borderRadius: 10,
        maxWidth: 400, width: "100%", padding: "40px clamp(20px, 6vw, 40px)", boxShadow: "0 4px 24px rgba(2,99,196,0.08)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <BrandLogo size={40} />
          <h1 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 18, color: "#0263C4", margin: 0 }}>
            Moderator sign-in
          </h1>
        </div>

        {checking ? (
          <p style={{ fontSize: 13, color: "#6B6B6B", textAlign: "center", margin: 0 }}>Checking…</p>
        ) : (
          <form onSubmit={signIn} noValidate>
            <label htmlFor="mod-email" style={labelStyle}>Email</label>
            <input id="mod-email" type="email" autoComplete="username" value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }} style={inputStyle} />
            <label htmlFor="mod-password" style={labelStyle}>Password</label>
            <input id="mod-password" type="password" autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }} style={inputStyle} />

            {error && <p role="alert" style={{ fontSize: 12, color: "#C0392B", margin: "10px 0 0" }}>{error}</p>}
            {notice && <p role="status" style={{ fontSize: 12, color: "#2E7D52", margin: "10px 0 0" }}>{notice}</p>}

            <button type="submit" disabled={loading} style={{
              display: "block", width: "100%", height: 44, marginTop: 16, backgroundColor: "#0263C4", color: "#ffffff",
              border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: loading ? "default" : "pointer", opacity: loading ? 0.7 : 1,
            }}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
            <button type="button" onClick={forgotPassword} style={{
              display: "block", margin: "12px auto 0", background: "none", border: "none", padding: 4,
              fontSize: 12, color: "#0263C4", textDecoration: "underline", cursor: "pointer",
            }}>
              Forgot password?
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
