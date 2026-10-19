"use client";

import { useHydrated } from "@/lib/use-hydrated";

export default function ClientOnly({ children }: { children: React.ReactNode }) {
  const mounted = useHydrated();
  if (!mounted) return null;
  return <>{children}</>;
}
