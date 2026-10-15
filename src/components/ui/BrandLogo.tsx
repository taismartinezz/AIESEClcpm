import { APP_NAME } from "@/lib/brand";

/**
 * Product mark: a pulse line on an AIESEC-blue tile (same artwork as app/icon.svg).
 * Deliberately not the AIESEC logo, which is a registered trademark.
 */
export default function BrandLogo({ size = 32, color }: { size?: number; color?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={APP_NAME}>
      <rect width="64" height="64" rx="14" fill={color ?? "var(--color-brand)"} />
      <path
        d="M10 34h11l5-12 8 22 6-14 4 4h10"
        fill="none" stroke="#fff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
