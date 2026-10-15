"use client";

type Variant = "tasks" | "reminders" | "bookmarks" | "calendar" | "journal" | "generic" | "column" | "done";

const illustrations: Record<Variant, React.ReactNode> = {
  tasks: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <rect x="8" y="12" width="64" height="40" rx="6" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
      <rect x="16" y="22" width="28" height="4" rx="2" fill="var(--color-border)" />
      <rect x="16" y="31" width="20" height="4" rx="2" fill="var(--color-border)" />
      <rect x="16" y="40" width="24" height="4" rx="2" fill="var(--color-border)" />
      <circle cx="57" cy="22" r="7" fill="var(--color-navy)" opacity="0.12" />
      <path d="M53 22l2.5 2.5L61 19" stroke="var(--color-navy)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  reminders: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <circle cx="40" cy="28" r="18" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
      <path d="M40 18v10l6 4" stroke="var(--color-navy)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <path d="M32 47c2.5 2 5 3 8 3s5.5-1 8-3" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="40" cy="12" r="2" fill="var(--color-border)" />
    </svg>
  ),
  bookmarks: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <path d="M24 10h32a4 4 0 0 1 4 4v36l-20-10-20 10V14a4 4 0 0 1 4-4z" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" strokeLinejoin="round" />
      <path d="M32 22h16M32 29h10" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  calendar: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <rect x="12" y="14" width="56" height="40" rx="5" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
      <path d="M12 24h56" stroke="var(--color-border)" strokeWidth="1" />
      <path d="M28 14v-4M52 14v-4" stroke="var(--color-border)" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="20" y="30" width="12" height="8" rx="2" fill="var(--color-navy)" opacity="0.12" />
      <rect x="36" y="30" width="12" height="8" rx="2" fill="var(--color-border)" />
      <rect x="20" y="42" width="8" height="6" rx="2" fill="var(--color-border)" />
    </svg>
  ),
  journal: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <rect x="16" y="8" width="48" height="48" rx="5" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
      <path d="M26 20h28M26 28h20M26 36h24M26 44h16" stroke="var(--color-border)" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="57" cy="44" r="8" fill="var(--color-navy)" opacity="0.12" />
      <path d="M54 44h6M57 41v6" stroke="var(--color-navy)" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  column: (
    <svg width="56" height="48" viewBox="0 0 56 48" fill="none" aria-hidden="true">
      <rect x="4" y="4" width="48" height="40" rx="5" stroke="var(--color-border)" strokeWidth="1.2" fill="var(--color-canvas)" />
      <path d="M12 16h20M12 23h14M12 30h18" stroke="var(--color-border)" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  done: (
    <svg width="56" height="48" viewBox="0 0 56 48" fill="none" aria-hidden="true">
      <circle cx="28" cy="24" r="18" stroke="var(--color-border)" strokeWidth="1.2" fill="var(--color-canvas)" />
      <path d="M20 24l5.5 5.5L36 18" stroke="var(--color-navy)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </svg>
  ),
  generic: (
    <svg width="80" height="64" viewBox="0 0 80 64" fill="none" aria-hidden="true">
      <rect x="16" y="14" width="48" height="36" rx="6" stroke="var(--color-border)" strokeWidth="1.5" fill="var(--color-canvas)" />
      <path d="M28 26h24M28 33h16" stroke="var(--color-border)" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="40" cy="44" r="0" />
    </svg>
  ),
};

interface Props {
  variant?: Variant;
  title: string;
  description?: string;
  action?: React.ReactNode;
  compact?: boolean;
}

export default function EmptyState({ variant = "generic", title, description, action, compact = false }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center text-center"
      style={{ padding: compact ? "32px 16px" : "56px 24px", gap: compact ? 12 : 16 }}
    >
      <div style={{ opacity: 0.7 }}>{illustrations[variant]}</div>
      <div style={{ maxWidth: 280 }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "var(--color-body)", margin: 0, lineHeight: 1.4 }}>
          {title}
        </p>
        {description && (
          <p style={{ fontSize: 13, color: "var(--color-secondary)", marginTop: 4, lineHeight: 1.5 }}>
            {description}
          </p>
        )}
      </div>
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}
