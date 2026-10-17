"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RELEASES } from "@/lib/help";
import { Button, Modal } from "@/components/lc/ui";

const KEY = "aiesec_seen_release";

/** Shows the latest release notes once to people who used the app before it shipped. */
export default function WhatsNew() {
  const [show, setShow] = useState(false);
  const latest = RELEASES[0];

  useEffect(() => {
    try {
      const seen = localStorage.getItem(KEY);
      if (seen === latest.id) return;
      // Brand-new users get the tour instead; remember the release silently.
      const returning = seen !== null || Object.keys(localStorage).some((k) => k.startsWith("aiesec_tour"));
      localStorage.setItem(KEY, latest.id);
      // Deciding once, on mount, whether to show the popup.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (returning) setShow(true);
    } catch { /* storage blocked: skip the popup */ }
  }, [latest.id]);

  if (!show) return null;
  return (
    <Modal title={`What's new: ${latest.title}`} onClose={() => setShow(false)} footer={<>
      <Link href="/help" onClick={() => setShow(false)} style={{ alignSelf: "center", fontSize: 13, color: "var(--color-navy)", marginRight: "auto" }}>All guides</Link>
      <Button onClick={() => setShow(false)}>Got it</Button>
    </>}>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: "var(--color-body)" }}>
        {latest.items.map((i) => <li key={i}>{i}</li>)}
      </ul>
    </Modal>
  );
}
