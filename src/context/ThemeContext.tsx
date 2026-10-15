"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  resolvedTheme: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
  resolvedTheme: "light",
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light");

  // Read stored preference on mount
  useEffect(() => {
    const stored = (typeof localStorage !== "undefined" ? localStorage.getItem("canopy-theme") : null) as Theme | null;
    if (stored === "light" || stored === "dark" || stored === "system") {
      setThemeState(stored);
    }
  }, []);

  // Apply theme to <html> and resolve the effective theme
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
      setResolvedTheme("light");
    } else if (theme === "dark") {
      root.setAttribute("data-theme", "dark");
      setResolvedTheme("dark");
    } else {
      // system - remove attribute, let prefers-color-scheme take over
      root.removeAttribute("data-theme");
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      setResolvedTheme(mq.matches ? "dark" : "light");

      const handler = (e: MediaQueryListEvent) => setResolvedTheme(e.matches ? "dark" : "light");
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }
  }, [theme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    if (typeof localStorage !== "undefined") localStorage.setItem("canopy-theme", t);
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
