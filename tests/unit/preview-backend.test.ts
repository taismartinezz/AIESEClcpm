// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { PREVIEW_URL, previewFetch, resetPreviewData } from "@/lib/preview/backend";
import { PREVIEW_LC_ID, PREVIEW_USER_ID } from "@/lib/preview/data";

const db = createClient(PREVIEW_URL, "preview", { global: { fetch: previewFetch }, auth: { persistSession: false } });

describe("preview backend", () => {
  beforeEach(() => resetPreviewData(new Date("2026-10-16T15:00:00")));

  it("filters, orders, embeds and counts like PostgREST", async () => {
    const { data, error } = await db.from("tasks").select("*, task_assignees(user_id)").eq("project_id", PREVIEW_LC_ID).is("parent_id", null)
      .or("archived.is.null,archived.eq.false").order("display_order");
    expect(error).toBeNull();
    expect(data!.length).toBe(8);
    expect(data![0].task_assignees).toEqual([{ user_id: PREVIEW_USER_ID }, expect.anything()]);
    const { count } = await db.from("exchanges").select("id", { count: "exact", head: true }).eq("stage", "approved");
    expect(count).toBe(3);
    const { data: mine } = await db.from("tasks").select("title, task_assignees!inner(user_id)").eq("task_assignees.user_id", PREVIEW_USER_ID);
    expect(mine!.map((t) => t.title)).toContain("Send the LC meeting agenda");
  });

  it("single / maybeSingle, inserts, updates and deletes", async () => {
    const { data: lc } = await db.from("projects").select("name").eq("id", PREVIEW_LC_ID).single();
    expect(lc!.name).toMatch(/Demo LC/);
    const { data: none } = await db.from("projects").select("name").eq("id", "nope").maybeSingle();
    expect(none).toBeNull();
    const { data: added } = await db.from("reminders").insert({ user_id: PREVIEW_USER_ID, title: "New", due_at: "2026-10-16T17:00:00.000Z" }).select("id, completed").single();
    expect(added!.completed).toBe(false);
    await db.from("reminders").update({ completed: true }).eq("id", added!.id);
    const { data: after } = await db.from("reminders").select("completed").eq("id", added!.id).single();
    expect(after!.completed).toBe(true);
    await db.from("reminders").delete().eq("id", added!.id);
    const { data: gone } = await db.from("reminders").select("id").eq("id", added!.id);
    expect(gone).toEqual([]);
  });

  it("moving an exchange dates its stages, and goal progress counts it", async () => {
    await db.from("exchanges").update({ stage: "approved" }).eq("person_name", "Sam Okoro");
    const { data } = await db.from("exchanges").select("approved_at, accepted_at").eq("person_name", "Sam Okoro").single();
    expect(data!.approved_at).toBe("2026-10-16");
    expect(data!.accepted_at).toBe("2026-10-16");
    const { data: progress } = await db.rpc("goal_progress", { p_project_id: PREVIEW_LC_ID });
    expect((progress as { current: number }[]).some((p) => p.current >= 4)).toBe(true);
  });

  it("answers auth and refuses what the preview can't do", async () => {
    const { data } = await db.auth.signInWithPassword({ email: "a@b.c", password: "anything" });
    expect(data.user?.id).toBe(PREVIEW_USER_ID);
    const { error } = await db.rpc("link_lc_to_mc", { p_project_id: PREVIEW_LC_ID, p_lc_code: "X" });
    expect(error?.message).toMatch(/isn't available in the preview/);
  });
});
