"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { useHydrated } from "@/lib/use-hydrated";

type Theme = "light" | "dark" | "system";

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem("aiesec-theme");
    if (value === "dark" || value === "system") return value;
  } catch { /* Storage can be disabled by browser policy. */ }
  return "light";
}

function subscribeSystemTheme(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const systemIsDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
const serverIsDark = () => false;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolvedTheme: "light" | "dark";
}

// AIESEC's brand is bright and white, so the app defaults to the light theme;
// dark (or following the system) is an explicit choice in Settings.
const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  resolvedTheme: "light",
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const [selectedTheme, setThemeState] = useState<Theme>(storedTheme);
  const theme = hydrated ? selectedTheme : "light";
  const dark = useSyncExternalStore(subscribeSystemTheme, systemIsDark, serverIsDark);
  const resolvedTheme = theme === "system" ? (dark ? "dark" : "light") : theme;

  // Apply theme to <html> and resolve the effective theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
    } else {
      // system - remove attribute, let prefers-color-scheme take over
      root.removeAttribute("data-theme");
    }
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    try { localStorage.setItem("aiesec-theme", t); } catch { /* Keep the in-memory preference. */ }
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
