"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import BrandLogo from "@/components/ui/BrandLogo";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);

  // Supabase sends the user back with a session via the URL hash
  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setReady(true);
    });
    // Also check if session already exists (hash was already parsed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
  }, []);

  async function handleReset() {
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setError("");
    setLoading(true);

    if (isSupabaseConfigured) {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) { setError(updateError.message); setLoading(false); return; }
    }

    setDone(true);
    setTimeout(() => router.push("/"), 2500);
  }

  const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", height: 44,
    border: "1px solid #DDE1E7", borderRadius: 8, padding: "0 14px",
    fontFamily: "var(--font-roboto)", fontSize: 14, color: "#2D2D2D",
    outline: "none", boxSizing: "border-box",
  };

  return (
    <div
      style={{
        minHeight: "100dvh", backgroundColor: "#F6F8FC",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "24px 16px", fontFamily: "var(--font-roboto)",
      }}
    >
      <h1 style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap", border: 0 }}>
        Reset your password
      </h1>

      <div
        style={{
          backgroundColor: "#ffffff", border: "1px solid #DDE1E7", borderRadius: 10,
          maxWidth: 440, width: "100%", padding: "48px 40px",
          boxShadow: "0 4px 24px rgba(2,99,196,0.08)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <BrandLogo size={36} />
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 18, color: "#0263C4", margin: 0 }}>
            Set a new password
          </h2>
        </div>

        {done ? (
          <p style={{ fontSize: 14, color: "#2E7D52", textAlign: "center", lineHeight: 1.6 }}>
            Password updated! Redirecting you to the app…
          </p>
        ) : !ready ? (
          <p style={{ fontSize: 13, color: "#6B6B6B", textAlign: "center" }}>
            Verifying reset link…
          </p>
        ) : (
          <>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="New password"
              autoComplete="new-password"
              aria-label="New password"
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#0263C4"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#DDE1E7"; }}
            />
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              placeholder="Confirm new password"
              autoComplete="new-password"
              aria-label="Confirm new password"
              style={{ ...inputStyle, marginTop: 10 }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#0263C4"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#DDE1E7"; }}
            />

            {error && (
              <p role="alert" style={{ fontSize: 12, color: "#C0392B", margin: "8px 0 0" }}>{error}</p>
            )}

            <button
              onClick={handleReset}
              disabled={loading}
              style={{
                display: "block", width: "100%", height: 44, marginTop: 12,
                backgroundColor: "#0263C4", color: "#ffffff", border: "none",
                borderRadius: 8, fontFamily: "var(--font-roboto)", fontWeight: 700,
                fontSize: 13, cursor: "pointer",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#2E4A6F"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = "#0263C4"; }}
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
