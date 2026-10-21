"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";

type Density = "comfortable" | "compact";

interface DensityContextValue {
  density: Density;
  toggle: () => void;
}

const DensityContext = createContext<DensityContextValue>({
  density: "comfortable",
  toggle: () => {},
});

export function DensityProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const [selectedDensity, setDensity] = useState<Density>(() => {
    try {
      const saved = localStorage.getItem("aiesec_density") as Density | null;
      if (saved === "compact") return saved;
    } catch { /* storage blocked: use default */ }
    return "comfortable";
  });
  const density = hydrated ? selectedDensity : "comfortable";

  useEffect(() => {
    if (!hydrated) return;
    document.documentElement.classList.toggle("density-compact", density === "compact");
    try { localStorage.setItem("aiesec_density", density); } catch { /* ignore */ }
  }, [density, hydrated]);

  const toggle = () => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"));

  return (
    <DensityContext.Provider value={{ density, toggle }}>
      {children}
    </DensityContext.Provider>
  );
}

export const useDensity = () => useContext(DensityContext);
