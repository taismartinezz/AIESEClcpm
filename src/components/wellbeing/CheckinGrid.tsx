"use client";

import { CHECKIN_LABELS } from "@/lib/wellbeing";
import type { CheckinResponse } from "@/types";

const SCORES = [1, 2, 3, 4, 5] as const;

/**
 * All the check-in questions in one compact grid: a row per question, a radio
 * column per score, and the scale labels once at the top. On phones each
 * question sits above its row of five radios.
 */
export default function CheckinGrid({ questions, answers, onScore }: {
  questions: { id: string; text: string }[];
  answers: CheckinResponse[];
  onScore: (questionId: string, score: CheckinResponse["score"]) => void;
}) {
  const cols = "grid grid-cols-5 md:grid-cols-[1fr_repeat(5,64px)] items-center";
  return (
    <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 10 }}>
      <div className={cols} aria-hidden="true" style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--color-border)" }}>
        <span className="hidden md:block" />
        {SCORES.map((s) => (
          <span key={s} style={{ textAlign: "center", fontSize: 10, lineHeight: 1.25, color: "var(--color-secondary)" }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--color-body)" }}>{s}</span>
            <span>{CHECKIN_LABELS[s]}</span>
          </span>
        ))}
      </div>
      {questions.map((q, i) => {
        const selected = answers.find((a) => a.questionId === q.id)?.score;
        return (
          <div key={q.id} role="radiogroup" aria-label={q.text} className={cols}
            style={{ padding: "8px 12px", borderTop: i ? "1px solid var(--color-border)" : "none" }}>
            <p className="col-span-5 md:col-span-1" style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.45, margin: 0, paddingRight: 8 }}>
              {q.text}
            </p>
            {SCORES.map((s) => (
              <label key={s} style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: 44, cursor: "pointer" }}>
                <input type="radio" name={`checkin-${q.id}`} checked={selected === s} onChange={() => onScore(q.id, s)}
                  aria-label={`${s}: ${CHECKIN_LABELS[s]}`}
                  style={{ width: 18, height: 18, margin: 0, cursor: "pointer", accentColor: "var(--color-navy)" }} />
              </label>
            ))}
          </div>
        );
      })}
    </div>
  );
}
