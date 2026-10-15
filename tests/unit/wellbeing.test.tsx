import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { activeQuestions, audienceCopy, summarize, toSeries, type PulseRow } from "@/lib/wellbeing";

const week = (n: number) => {
  const d = new Date(Date.UTC(2026, 8, 7)); // a Monday
  d.setUTCDate(d.getUTCDate() + n * 7);
  return d.toISOString();
};
const row = (w: number, q: string, avg: number, dept: string | null = "d1"): PulseRow =>
  ({ department_id: dept, week_start: week(w), question_id: q, avg_score: String(avg), respondent_count: 4, suppressed: false });
const hidden = (w: number, dept: string | null = "d1"): PulseRow =>
  ({ department_id: dept, week_start: week(w), question_id: null, avg_score: null, respondent_count: null, suppressed: true });

describe("pulse summaries", () => {
  it("averages questions per week and keeps suppressed weeks as gaps", () => {
    const [s] = toSeries([row(0, "energy", 4), row(0, "workload", 3), hidden(1)]);
    expect(s.weeks).toHaveLength(2);
    expect(s.weeks[0].overall).toBe(3.5);
    expect(s.weeks[1]).toMatchObject({ suppressed: true, overall: null });
  });

  it("flags a noticeable drop versus the 4-week average", () => {
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

  it("this week is suppressed when only earlier weeks have numbers", () => {
    const summary = summarize(toSeries([row(0, "energy", 4), hidden(1)])[0]);
    expect(summary.current?.suppressed).toBe(true);
    expect(summary.latest?.overall).toBe(4);
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
vi.mock("@/lib/supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

describe("pulse cards", () => {
  it("shows the privacy message, not numbers, when this week is suppressed", async () => {
    const thisMonday = new Date();
    thisMonday.setUTCDate(thisMonday.getUTCDate() - ((thisMonday.getUTCDay() + 6) % 7));
    rpc.mockResolvedValueOnce({ data: [{ week_start: thisMonday.toISOString(), question_id: null, avg_score: null, respondent_count: null, suppressed: true }], error: null });
    const { ExecPulseCard } = await import("@/components/wellbeing/PulseCards");
    render(<ExecPulseCard projectId="lc-1" />);
    await waitFor(() => expect(screen.getByText(/Not enough responses this week to protect privacy/)).toBeInTheDocument());
    expect(rpc).toHaveBeenCalledWith("get_exec_pulse", { p_project_id: "lc-1" });
  });

  it("surfaces an error instead of failing silently", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const { MemberPulseCard } = await import("@/components/wellbeing/PulseCards");
    render(<MemberPulseCard projectId="lc-1" departments={[]} />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/boom/));
  });
});
