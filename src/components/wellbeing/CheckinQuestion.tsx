"use client";

import { CHECKIN_LABELS } from "@/lib/wellbeing";
import type { CheckinResponse } from "@/types";

const SCORE_COLOR = "var(--color-navy)";
const SCORE_LABELS: Record<number, string> = CHECKIN_LABELS;

export default function CheckinQuestion({ question, response, onScore }: {
  question: { id: string; text: string };
  response?: CheckinResponse;
  onScore: (score: 1 | 2 | 3 | 4 | 5) => void;
}) {
  const selected = response?.score;
  return (
    <div style={{ backgroundColor: "var(--color-surface)", border: `2px solid ${selected !== undefined ? SCORE_COLOR : "var(--color-border)"}`, borderRadius: 10, padding: "16px 16px", transition: "border-color 0.2s" }}>
      <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.5, marginBottom: 14 }}>{question.text}</p>
      <div className="flex items-center gap-1.5 md:gap-2">
        {([1, 2, 3, 4, 5] as const).map((score) => {
          const isSelected = selected === score;
          return (
            <button key={score} onClick={() => onScore(score)}
              className="flex flex-col items-center gap-1.5 flex-1 py-2 rounded-lg transition-all"
              style={{ border: `1px solid ${isSelected ? SCORE_COLOR : "var(--color-border)"}`, backgroundColor: isSelected ? "rgba(2,99,196,0.08)" : "transparent", cursor: "pointer", minHeight: 52 }}
              aria-label={`${score}: ${SCORE_LABELS[score]}`} aria-pressed={isSelected}
            >
              <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center" style={{ borderColor: isSelected ? SCORE_COLOR : "var(--color-border)", backgroundColor: isSelected ? SCORE_COLOR : "transparent" }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? SCORE_COLOR : "var(--color-secondary)", textAlign: "center", lineHeight: 1.2 }}>{score}</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-between mt-2">
        <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Strongly Disagree</span>
        <span className="hidden md:block" style={{ fontSize: 10, color: "var(--color-secondary)" }}>Neutral</span>
        <span style={{ fontSize: 10, color: "var(--color-secondary)" }}>Strongly Agree</span>
      </div>
    </div>
  );
}
