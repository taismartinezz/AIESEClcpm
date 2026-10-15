"use client";

import { useState, useEffect } from "react";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatRelativeTime, getUser, CURRENT_USER_ID } from "@/lib/mock-data";
import type { DashboardPost, User } from "@/types";
import Avatar from "@/components/ui/Avatar";
import { Card, CardHeader } from "./DashboardCard";

export function PostsCard({
  title,
  posts: initialPosts,
  type,
  projectId,
  userId,
  teamMembers,
}: {
  title: string;
  posts: DashboardPost[];
  type: "opportunity" | "lab_win";
  projectId: string;
  userId: string;
  teamMembers: User[];
}) {
  const [posts, setPosts] = useState<DashboardPost[]>(initialPosts);
  const [showForm, setShowForm] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [content, setContent] = useState("");

  useEffect(() => { setPosts(initialPosts); }, [initialPosts]);

  const filtered = posts.filter((p) => p.type === type);
  const displayed = showAll ? filtered : filtered.slice(0, 5);
  const hasMore = filtered.length > 5;
  const table = type === "lab_win" ? "lab_wins" : "opportunities";

  async function handlePost() {
    if (!content.trim()) return;

    if (projectId && userId) {
      const { data, error } = await supabase
        .from(table)
        .insert({ project_id: projectId, author_id: userId, content: content.trim() })
        .select()
        .single();
      if (error) {
        console.error(`[PostsCard] ${table} insert error:`, error);
      } else if (data) {
        const newPost: DashboardPost = {
          id: data.id as string,
          authorId: data.author_id as string,
          content: data.content as string,
          createdAt: data.created_at as string,
          type,
        };
        setPosts((prev) => [newPost, ...prev]);
      }
    } else {
      setPosts((prev) => [
        { id: crypto.randomUUID(), authorId: CURRENT_USER_ID, content: content.trim(), createdAt: new Date().toISOString(), type },
        ...prev,
      ]);
    }
    setContent("");
    setShowForm(false);
  }

  const currentUser = teamMembers.find((u) => u.id === userId) ?? getUser(CURRENT_USER_ID);

  const description = type === "opportunity"
    ? "Grants, conferences, and collaborations worth sharing with the lab"
    : "Celebrate progress - submissions, acceptances, milestones";

  return (
    <Card>
      <CardHeader
        title={title}
        onTitleClick={hasMore ? () => setShowAll(v => !v) : undefined}
        action={
          <button
            onClick={() => setShowForm((s) => !s)}
            className="flex items-center gap-1 transition-opacity hover:opacity-70"
            style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600 }}
          >
            <Plus size={13} /> Add
          </button>
        }
      />
      <p style={{ fontSize: 12, color: "var(--color-secondary)", padding: "6px 20px 0", lineHeight: 1.4 }}>{description}</p>
      <div className="px-5 py-3 space-y-3">
        {filtered.length === 0 && !showForm && (
          <p style={{ color: "var(--color-secondary)", fontSize: 13 }}>Nothing posted yet. Add the first one.</p>
        )}
        {displayed.map((post) => {
          const author = teamMembers.find((u) => u.id === post.authorId) ?? getUser(post.authorId);
          return (
            <div key={post.id} className="flex gap-3">
              {author && <Avatar user={author} size={24} className="mt-0.5 shrink-0" />}
              <div>
                <p style={{ fontSize: 13, color: "var(--color-body)", lineHeight: 1.45 }}>{post.content}</p>
                <p style={{ fontSize: 11, color: "var(--color-secondary)", marginTop: 3 }}>
                  {author?.name.split(" ")[0]} · {formatRelativeTime(post.createdAt)}
                </p>
              </div>
            </div>
          );
        })}

        {showForm && (
          <div className="animate-fade-in space-y-2 pt-1">
            <div className="flex gap-2">
              {currentUser && <Avatar user={currentUser} size={26} className="shrink-0 mt-1" />}
              <textarea
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={type === "opportunity" ? "Share an opportunity with your team..." : "Share a lab win with your team..."}
                rows={3}
                style={{ flex: 1, fontSize: 13, color: "var(--color-body)", fontFamily: "var(--font-roboto)", border: "1px solid var(--color-border)", borderRadius: 7, padding: "8px 10px", resize: "vertical", backgroundColor: "var(--color-canvas)", outline: "none" }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--color-navy)"; }}
                onBlur={(e)  => { e.currentTarget.style.borderColor = "var(--color-border)"; }}
              />
            </div>
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setContent(""); }} style={{ fontSize: 12, color: "var(--color-secondary)", background: "none", border: "none", cursor: "pointer" }}>
                Cancel
              </button>
              <button onClick={handlePost} style={{ fontSize: 12, fontWeight: 700, color: "#fff", backgroundColor: "var(--color-navy)", border: "none", borderRadius: 6, padding: "6px 14px", cursor: "pointer", minHeight: 36, fontFamily: "var(--font-roboto)" }}>
                Post
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
