"use client";

import Link from "next/link";
import CanopyLogo from "@/components/ui/CanopyLogo";

export default function PrivacyPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        backgroundColor: "#F6F8FC",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 16px",
        fontFamily: "var(--font-roboto)",
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          border: "1px solid #DDE1E7",
          borderRadius: 10,
          maxWidth: 680,
          width: "100%",
          padding: "48px 40px",
          boxShadow: "0 4px 24px rgba(27,46,75,0.08)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 32 }}>
          <CanopyLogo size={28} />
          <span style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 18, color: "#1B2E4B" }}>
            Canopy
          </span>
        </div>

        <h1 style={{ fontFamily: "var(--font-lora)", fontWeight: 700, fontSize: 24, color: "#1B2E4B", margin: "0 0 8px" }}>
          Privacy Policy
        </h1>
        <p style={{ fontSize: 13, color: "#6B6B6B", margin: "0 0 36px" }}>
          Last updated: June 2026 · Effective immediately upon account creation
        </p>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            Our commitment
          </h2>
          <p style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.75, margin: 0 }}>
            Canopy is built specifically for researchers who work with sensitive topics: trauma, grief,
            conflict, and human vulnerability. We take that responsibility seriously. This policy explains
            exactly what data we collect, how we use it, and what we will never do with it.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            What we collect
          </h2>
          <ul style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
            <li><strong>Account information:</strong> your name, email address, and role (PI or Researcher), provided at sign-up.</li>
            <li><strong>Workspace data:</strong> tasks, reminders, bookmarks, and team information you add to your lab workspace.</li>
            <li><strong>Journal entries:</strong> text you write in the private journal feature. These are encrypted and stored under your user ID only.</li>
            <li><strong>Usage metadata:</strong> timestamps of activity (e.g., when a task was created or completed) used to generate aggregate trends.</li>
          </ul>
          <p style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.75, margin: "12px 0 0" }}>
            We do not collect audio, video, biometric data, or any data from your device beyond what is
            necessary to provide the service.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            How we use your data
          </h2>
          <ul style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
            <li>To provide and improve the Canopy platform.</li>
            <li>To generate <strong>anonymized, aggregate well-being trends</strong> visible to PIs (never individual-level data). A trend is only surfaced when it includes responses from 3 or more lab members.</li>
            <li>To send platform notifications you have opted into (task assignments, lab updates).</li>
            <li>To conduct our own research on researcher well-being, where you have explicitly opted in under your Lab Settings.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            What we will never do
          </h2>
          <ul style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
            <li>Sell, rent, or share your personal data with third parties for commercial purposes.</li>
            <li>Share your individual journal entries or check-in responses with your PI, institution, or any other lab member.</li>
            <li>Use your data for advertising.</li>
            <li>Transfer your data to a government or law enforcement agency except as required by applicable law, and only after exhausting available legal remedies to protect your privacy.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            Data storage and security
          </h2>
          <p style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.75, margin: 0 }}>
            Your data is stored on Supabase infrastructure hosted in the United States. We use industry-standard
            encryption in transit (TLS) and at rest. Journal entries are stored with row-level security policies
            that prevent any other user, including PIs, from querying them directly. We perform regular security
            reviews and will notify you promptly in the event of a breach affecting your data.
          </p>
        </section>

        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            Your rights
          </h2>
          <ul style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
            <li><strong>Access:</strong> you can view your profile and all workspace data at any time from within Canopy.</li>
            <li><strong>Correction:</strong> you can update your name, institution, bio, and other profile fields directly in the app.</li>
            <li><strong>Deletion:</strong> you can request full deletion of your account and all associated data by emailing us. We will process requests within 30 days.</li>
            <li><strong>Portability:</strong> on request, we will provide an export of your personal data in a machine-readable format.</li>
            <li><strong>Opt-out of research:</strong> you can change your research participation preference at any time in Lab Settings.</li>
          </ul>
        </section>

        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontFamily: "var(--font-lora)", fontWeight: 600, fontSize: 16, color: "#1B2E4B", margin: "0 0 12px" }}>
            Contact us
          </h2>
          <p style={{ fontSize: 14, color: "#2D2D2D", lineHeight: 1.75, margin: 0 }}>
            Questions about this policy or requests to exercise your rights can be sent to{" "}
            <a href="mailto:privacy@canopy.app" style={{ color: "#1B2E4B", textDecoration: "underline" }}>
              privacy@canopy.app
            </a>
            . We aim to respond within 5 business days.
          </p>
        </section>

        <Link
          href="/login"
          style={{ fontSize: 13, color: "#1B2E4B", textDecoration: "underline" }}
        >
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
