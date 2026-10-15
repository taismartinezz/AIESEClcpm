"use client";

import { createContext, useContext, useEffect, useState } from "react";

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
  const [density, setDensity] = useState<Density>("comfortable");

  useEffect(() => {
    try {
      const saved = localStorage.getItem("canopy_density") as Density | null;
      if (saved === "compact" || saved === "comfortable") setDensity(saved);
    } catch { /* storage blocked — use default */ }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("density-compact", density === "compact");
    try { localStorage.setItem("canopy_density", density); } catch { /* ignore */ }
  }, [density]);

  const toggle = () => setDensity((d) => (d === "comfortable" ? "compact" : "comfortable"));

  return (
    <DensityContext.Provider value={{ density, toggle }}>
      {children}
    </DensityContext.Provider>
  );
}

export const useDensity = () => useContext(DensityContext);
