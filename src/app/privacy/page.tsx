"use client";

import Link from "next/link";
import BrandLogo from "@/components/ui/BrandLogo";
import { APP_NAME } from "@/lib/brand";

// TEMPLATE: this page describes how the app handles data. Whoever operates a
// deployment must review it, add their contact address (NEXT_PUBLIC_PRIVACY_CONTACT)
// and adapt it to their local law before going live.
const CONTACT = process.env.NEXT_PUBLIC_PRIVACY_CONTACT ?? "";

const h2: React.CSSProperties = { fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "var(--color-navy)", margin: "0 0 12px" };
const para: React.CSSProperties = { fontSize: 14, color: "var(--color-body)", lineHeight: 1.75, margin: 0 };
const list: React.CSSProperties = { fontSize: 14, color: "var(--color-body)", lineHeight: 1.75, margin: 0, paddingLeft: 20 };

export default function PrivacyPage() {
  return (
    <div style={{ minHeight: "100dvh", backgroundColor: "var(--color-canvas)", display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 16px", fontFamily: "var(--font-roboto)" }}>
      <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10, maxWidth: 680, width: "100%", padding: "48px clamp(20px, 5vw, 40px)", boxShadow: "var(--shadow-card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <BrandLogo size={28} />
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 18, color: "var(--color-navy)" }}>{APP_NAME}</span>
        </div>

        <h1 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 24, color: "var(--color-navy)", margin: "0 0 32px" }}>
          Privacy
        </h1>

        <section style={{ marginBottom: 32 }}>
          <h2 style={h2}>What this app is</h2>
          <p style={para}>
            {APP_NAME} is a workspace for AIESEC Local Committees (LCs): tasks, reminders, chat,
            shared files and a private wellbeing journal. Each LC&rsquo;s data is visible only to that
            LC&rsquo;s members, enforced by the database, not only by the interface.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={h2}>What we store</h2>
          <ul style={list}>
            <li><strong>Account:</strong> your name, email address, and your role and department in each LC you join.</li>
            <li><strong>LC workspace:</strong> tasks, reminders, LC Drive links and files, chat messages and posts you add.</li>
            <li><strong>Journal:</strong> your free-text entries are encrypted and readable only by you.</li>
            <li><strong>Check-in:</strong> your 1–5 answers (every two weeks by default), stored separately from your journal so they can be averaged.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={h2}>Who sees your check-in</h2>
          <ul style={list}>
            <li>Nobody ever sees your individual answers or your journal text.</li>
            <li>Members&rsquo; scores are averaged per department. Your VP sees your department&rsquo;s average; your LCP sees every department&rsquo;s average.</li>
            <li>VPs&rsquo; scores are averaged into an executive-board average that only the LCP sees.</li>
            <li>An average is hidden for any check-in period with fewer respondents than the LC&rsquo;s privacy threshold (3 by default).</li>
            <li>You can stop your scores being counted at any time from the Check-in page.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={h2}>What we never do</h2>
          <ul style={list}>
            <li>Sell or share your data for advertising or commercial purposes.</li>
            <li>Show your journal entries or individual check-in answers to anyone, including your VP or LCP.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 36 }}>
          <h2 style={h2}>Your choices</h2>
          <p style={para}>
            You can edit your profile at any time. To leave an LC, ask its LCP to remove you. To have
            your account and data deleted, contact the person who runs this deployment
            {CONTACT ? <> at <a href={`mailto:${CONTACT}`} style={{ color: "var(--color-navy)", textDecoration: "underline" }}>{CONTACT}</a></> : null}.
          </p>
        </section>

        <Link href="/login" style={{ fontSize: 13, color: "var(--color-navy)", textDecoration: "underline" }}>
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
