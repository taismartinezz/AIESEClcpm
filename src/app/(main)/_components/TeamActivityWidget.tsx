"use client";

import Link from "next/link";
import { formatRelativeTime } from "@/lib/mock-data";
import type { User } from "@/types";
import Avatar from "@/components/ui/Avatar";

export type ActivityRow = {
  id: string;
  user_id: string;
  action_type: string;
  item_name: string;
  item_type: string;
  from_status?: string;
  to_status?: string;
  created_at: string;
  sub_project_id?: string | null;
};

export function SkeletonLine({ width = "100%", height = 13 }: { width?: string | number; height?: number }) {
  return (
    <div style={{ width, height, borderRadius: 4, backgroundColor: "var(--color-border)", opacity: 0.6 }}
      className="animate-pulse" />
  );
}

const T = {
  card:        "var(--color-surface)",
  border:      "var(--color-border)",
  textPrimary: "var(--color-body)",
  textMuted:   "var(--color-secondary)",
  accent:      "#0A84FF",
  radius:      11,
};

function activityVerb(row: ActivityRow): string {
  if (row.action_type === "created") return "created";
  if (row.action_type === "added") return "added";
  if (row.action_type === "moved") return "moved";
  return row.action_type;
}

function activitySuffix(row: ActivityRow): string | null {
  if (row.action_type === "moved" && row.to_status) {
    const labels: Record<string, string> = {
      todo: "To Do", in_progress: "In Progress", in_review: "In Review", done: "Done",
    };
    return `→ ${labels[row.to_status] ?? row.to_status}`;
  }
  return null;
}

export function TeamActivityWidget({
  rows,
  teamMembers,
  loading,
}: {
  rows: ActivityRow[];
  teamMembers: User[];
  loading?: boolean;
}) {
  const cardStyle: React.CSSProperties = {
    backgroundColor: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: T.radius,
    overflow: "hidden",
    height: "100%",
  };

  if (loading) {
    return (
      <div style={cardStyle}>
        <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: T.textPrimary }}>Team Activity</span>
        </div>
        <div style={{ padding: "8px 0" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 20px" }}>
              <div style={{ width: 24, height: 24, borderRadius: "50%", backgroundColor: T.border, flexShrink: 0 }} className="animate-pulse" />
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                <div style={{ height: 12, borderRadius: 4, backgroundColor: T.border, opacity: 0.5, width: "70%" }} />
                <div style={{ height: 10, borderRadius: 4, backgroundColor: T.border, opacity: 0.35, width: "35%" }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={cardStyle}>
      <div style={{ padding: "16px 20px 12px", borderBottom: `1px solid ${T.border}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.textPrimary, letterSpacing: "0.01em" }}>Team Activity</span>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: "28px 20px" }}>
          <p style={{ fontSize: 13, color: T.textMuted, margin: 0 }}>No activity in the last 7 days.</p>
        </div>
      ) : (
        <div>
          {rows.slice(0, 5).map((row, i) => {
            const actor = teamMembers.find((u) => u.id === row.user_id);
            const name = actor?.name.split(" ")[0] ?? "Someone";
            const suffix = activitySuffix(row);
            return (
              <div
                key={row.id}
                style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "10px 20px",
                  borderBottom: i < Math.min(rows.length, 5) - 1 ? `1px solid ${T.border}` : undefined,
                }}
              >
                {actor && <Avatar user={actor} size={24} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, color: T.textPrimary, margin: 0, lineHeight: 1.45 }}>
                    <strong style={{ fontWeight: 600 }}>{name}</strong>{" "}
                    {activityVerb(row)}{" "}
                    <span style={{ fontWeight: 500 }}>{row.item_name}</span>
                    {suffix && <span style={{ color: T.textMuted }}> {suffix}</span>}
                  </p>
                  <p style={{ fontSize: 11, color: T.textMuted, margin: "2px 0 0" }}>
                    {formatRelativeTime(row.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
          {rows.length > 5 && (
            <div style={{ padding: "10px 20px" }}>
              <Link href="/tasks" style={{ fontSize: 12, color: T.accent, textDecoration: "none" }}>
                View all {rows.length} events →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
