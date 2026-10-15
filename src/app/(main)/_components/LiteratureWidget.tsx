"use client";

import Link from "next/link";
import { BookOpen, ChevronRight } from "lucide-react";
import { Card, CardHeader } from "./DashboardCard";
import { SkeletonLine } from "./TeamActivityWidget";

export interface AssignedPaper {
  id: string;
  itemId: string;
  title: string;
  readingStatus: "not_started" | "in_progress" | "done";
}

const STATUS_LABEL: Record<AssignedPaper["readingStatus"], string> = {
  not_started: "Not started",
  in_progress: "In progress",
  done: "Read",
};
const STATUS_COLOR: Record<AssignedPaper["readingStatus"], string> = {
  not_started: "var(--color-secondary)",
  in_progress: "var(--color-navy)",
  done: "var(--color-success, #2d7a3a)",
};

export function LiteratureWidget({
  papers,
  loading,
}: {
  papers: AssignedPaper[];
  loading?: boolean;
}) {
  const total = papers.length;
  const read = papers.filter((p) => p.readingStatus === "done").length;
  const unread = papers.filter((p) => p.readingStatus !== "done");

  if (loading) {
    return (
      <Card>
        <CardHeader title="Reading" action={
          <Link href="/literature" className="flex items-center gap-1 transition-opacity hover:opacity-70" style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600, textDecoration: "none" }}>
            See all <ChevronRight size={13} />
          </Link>
        } />
        <div className="px-5 py-3 space-y-3">
          <SkeletonLine width="55%" height={11} />
          {[1, 2].map((i) => <SkeletonLine key={i} width="80%" />)}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Reading"
        action={
          <Link href="/literature" className="flex items-center gap-1 transition-opacity hover:opacity-70" style={{ fontSize: 12, color: "var(--color-navy)", fontWeight: 600, textDecoration: "none" }}>
            See all <ChevronRight size={13} />
          </Link>
        }
      />
      <div className="px-5 py-3">
        {total === 0 ? (
          <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>No papers assigned to you yet.</p>
        ) : (
          <>
            {/* Progress summary */}
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={13} color="var(--color-secondary)" />
              <p style={{ fontSize: 12, color: "var(--color-secondary)", margin: 0 }}>
                {read} of {total} assigned paper{total !== 1 ? "s" : ""} read
              </p>
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, borderRadius: 2, backgroundColor: "var(--color-border)", marginBottom: 12, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${total > 0 ? Math.round((read / total) * 100) : 0}%`, backgroundColor: "var(--color-navy)", borderRadius: 2, transition: "width 0.3s" }} />
            </div>

            {/* Unread papers */}
            {unread.length > 0 && (
              <div className="space-y-2">
                {unread.slice(0, 4).map((p) => (
                  <Link
                    key={p.id}
                    href="/literature"
                    style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, color: "var(--color-body)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.title}
                      </p>
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, color: STATUS_COLOR[p.readingStatus], flexShrink: 0 }}>
                      {STATUS_LABEL[p.readingStatus]}
                    </span>
                  </Link>
                ))}
                {unread.length > 4 && (
                  <Link href="/literature" style={{ fontSize: 12, color: "var(--color-navy)", textDecoration: "none", display: "block" }}>
                    +{unread.length - 4} more
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
