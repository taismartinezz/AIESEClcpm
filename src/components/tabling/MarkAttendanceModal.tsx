"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { formatTimeRange } from "@/lib/tabling";
import type { LcMember } from "@/hooks/useLcMembers";
import type { TablingSignup, TablingSlot, TablingStatus } from "@/types";
import { Button, ErrorText, Field, Modal, selectStyle } from "@/components/lc/ui";

/** After a slot: mark each sign-up attended / no-show and add walk-ins. */
export default function MarkAttendanceModal({ slot, signups, roster, onClose, onChanged }: {
  slot: TablingSlot; signups: TablingSignup[]; roster: LcMember[];
  onClose: () => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => roster.find((m) => m.id === id)?.name ?? "LC member";
  const here = new Set(signups.map((s) => s.userId));

  async function call(key: string, fn: string, args: Record<string, unknown>) {
    setBusy(key);
    setError(null);
    try {
      const { error: err } = await supabase.rpc(fn, args);
      if (err) throw new Error(err.message);
      onChanged();
    } catch (e) {
      setError(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(null);
    }
  }

  const mark = (userId: string, status: TablingStatus) => call(userId, "tabling_mark", { p_slot_id: slot.id, p_user_id: userId, p_status: status });

  return (
    <Modal title={`${slot.purpose} · ${formatTimeRange(slot)}`} onClose={onClose} width={500} footer={<Button onClick={onClose}>Done</Button>}>
      {signups.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--color-secondary)", marginTop: 0 }}>Nobody signed up.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: "0 0 16px", padding: 0 }}>
          {signups.map((s) => (
            <li key={s.userId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderTop: "1px solid var(--color-border)", opacity: busy === s.userId ? 0.6 : 1 }}>
              <span style={{ flex: 1, fontSize: 13, color: "var(--color-body)" }}>
                {nameOf(s.userId)}{s.walkIn && <span style={{ fontSize: 11, color: "var(--color-secondary)" }}> · walk-in</span>}
              </span>
              <div role="radiogroup" aria-label={`Attendance for ${nameOf(s.userId)}`} style={{ display: "flex", gap: 4 }}>
                {(["attended", "no_show"] as const).map((st) => (
                  <Button
                    key={st} variant={s.status === st ? (st === "attended" ? "primary" : "danger") : "secondary"}
                    aria-pressed={s.status === st} disabled={busy === s.userId}
                    onClick={() => mark(s.userId, s.status === st ? "signed_up" : st)}
                    style={{ height: 30, padding: "0 10px", fontSize: 12 }}
                  >
                    {st === "attended" ? "Attended" : "No-show"}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Field label="Someone showed up without signing up?" htmlFor="walk-in">
        <div style={{ display: "flex", gap: 8 }}>
          <select id="walk-in" value={walkIn} onChange={(e) => setWalkIn(e.target.value)} style={selectStyle}>
            <option value="">Choose a member…</option>
            {roster.filter((m) => !here.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button
            disabled={!walkIn || busy === "walk-in"}
            onClick={() => call("walk-in", "tabling_add_walk_in", { p_slot_id: slot.id, p_user_id: walkIn }).then(() => setWalkIn(""))}
          >
            Add
          </Button>
        </div>
      </Field>
      <ErrorText>{error}</ErrorText>
    </Modal>
  );
}
