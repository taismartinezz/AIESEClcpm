import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { activeQuestions, audienceCopy, periodStart, privacyMessage, summarize, toSeries, type PulseRow } from "@/lib/wellbeing";

const period = (n: number) => {
  const d = new Date(Date.UTC(2026, 8, 7)); // a Monday
  d.setUTCDate(d.getUTCDate() + n * 14);
  return d.toISOString();
};
const row = (w: number, q: string, avg: number, dept: string | null = "d1"): PulseRow =>
  ({ department_id: dept, period_start: period(w), question_id: q, avg_score: String(avg), respondent_count: 4, suppressed: false });
const hidden = (w: number, dept: string | null = "d1"): PulseRow =>
  ({ department_id: dept, period_start: period(w), question_id: null, avg_score: null, respondent_count: null, suppressed: true });

describe("pulse summaries", () => {
  it("averages questions per period and keeps suppressed periods as gaps", () => {
    const [s] = toSeries([row(0, "energy", 4), row(0, "workload", 3), hidden(1)]);
    expect(s.periods).toHaveLength(2);
    expect(s.periods[0].overall).toBe(3.5);
    expect(s.periods[1]).toMatchObject({ suppressed: true, overall: null });
  });

  it("flags a noticeable drop versus the average of the 4 previous periods", () => {
    const rows = [0, 1, 2, 3].map((w) => row(w, "energy", 4)).concat(row(4, "energy", 3.2));
    const summary = summarize(toSeries(rows)[0]);
    expect(summary.baseline).toBe(4);
    expect(summary.change).toBe(-0.8);
    expect(summary.dropped).toBe(true);
  });

  it("does not flag small dips or trends without enough history", () => {
    expect(summarize(toSeries([row(0, "energy", 4), row(1, "energy", 4), row(2, "energy", 3.7)])[0]).dropped).toBe(false);
    expect(summarize(toSeries([row(0, "energy", 4), row(1, "energy", 2)])[0]).baseline).toBeNull();
  });

  it("the current period is suppressed when only earlier periods have numbers", () => {
    const summary = summarize(toSeries([row(0, "energy", 4), hidden(1)])[0]);
    expect(summary.current?.suppressed).toBe(true);
    expect(summary.latest?.overall).toBe(4);
  });
});

describe("cadence", () => {
  it("periods start on a Monday and line up across the two-week grid", () => {
    const a = periodStart(2, new Date("2026-10-15T12:00:00Z"));
    expect(a.getUTCDay()).toBe(1);
    expect(periodStart(2, new Date(a.getTime() + 13 * 86_400_000)).getTime()).toBe(a.getTime());
    expect(periodStart(2, new Date(a.getTime() + 14 * 86_400_000)).getTime()).toBe(a.getTime() + 14 * 86_400_000);
  });

  it("words the privacy message for the cadence", () => {
    expect(privacyMessage(2)).toBe("Not enough responses this fortnight to protect privacy");
    expect(privacyMessage(1)).toBe("Not enough responses this week to protect privacy");
  });
});

describe("check-in copy and questions", () => {
  it("tells each role who sees the aggregate", () => {
    expect(audienceCopy("member")).toMatch(/VP and LCP see the average for your department, never your individual answers/);
    expect(audienceCopy("vp")).toMatch(/LCP sees the average for the executive board/);
    expect(audienceCopy("president")).toMatch(/never included/);
  });

  it("drops questions the president switched off", () => {
    const ids = activeQuestions(["workload", "balance"]).map((q) => q.id);
    expect(ids).not.toContain("workload");
    expect(ids).toHaveLength(4);
  });
});

// ── Cards ─────────────────────────────────────────────────────────────────────

const rpc = vi.fn();
const project = { checkin_period_weeks: 2 };
vi.mock("@/lib/supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    rpc: (...a: unknown[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: project, error: null }) }) }) }),
  },
}));

describe("pulse cards", () => {
  it("collapses to one line, with no numbers, while nothing has reached the threshold", async () => {
    rpc.mockResolvedValueOnce({ data: [{ period_start: periodStart(2).toISOString(), question_id: null, avg_score: null, respondent_count: null, suppressed: true }], error: null });
    const { ExecPulseCard } = await import("@/components/wellbeing/PulseCards");
    render(<ExecPulseCard projectId="lc-1" />);
    await waitFor(() => expect(screen.getByText(/appears once enough people have checked in this fortnight/)).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith("get_exec_pulse", { p_project_id: "lc-1" });
  });

  it("surfaces an error instead of failing silently", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { MemberPulseCard } = await import("@/components/wellbeing/PulseCards");
    render(<MemberPulseCard projectId="lc-1" departments={[]} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
  });
});
