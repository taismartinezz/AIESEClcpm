import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";
import { DensityProvider, useDensity } from "@/context/DensityContext";

let dark = false;
const listeners = new Set<() => void>();
function Preferences() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { density, toggle } = useDensity();
  return <>
    <span data-testid="theme">{theme}:{resolvedTheme}</span>
    <span data-testid="density">{density}</span>
    <button onClick={() => setTheme("dark")}>Dark</button>
    <button onClick={() => setTheme("system")}>System</button>
    <button onClick={toggle}>Toggle density</button>
  </>;
}
const mount = () => render(<ThemeProvider><DensityProvider><Preferences /></DensityProvider></ThemeProvider>);

beforeEach(() => {
  localStorage.clear();
  dark = false;
  listeners.clear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() { return dark; },
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("browser preferences", () => {
  it("restores saved theme and density without overwriting the saved density", () => {
    localStorage.setItem("aiesec-theme", "dark");
    localStorage.setItem("aiesec_density", "compact");
    mount();
    expect(screen.getByTestId("theme")).toHaveTextContent("dark:dark");
    expect(screen.getByTestId("density")).toHaveTextContent("compact");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    expect(document.documentElement).toHaveClass("density-compact");
    expect(localStorage.getItem("aiesec_density")).toBe("compact");
  });

  it("keeps theme switching functional when browser storage is blocked", () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Dark", exact: true }));
    expect(screen.getByTestId("theme")).toHaveTextContent("dark:dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    fireEvent.click(screen.getByRole("button", { name: "Toggle density" }));
    expect(screen.getByTestId("density")).toHaveTextContent("compact");
  });

  it("tracks system color-scheme changes and unsubscribes on unmount", () => {
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "System", exact: true }));
    expect(screen.getByTestId("theme")).toHaveTextContent("system:light");
    act(() => { dark = true; listeners.forEach(listener => listener()); });
    expect(screen.getByTestId("theme")).toHaveTextContent("system:dark");
    expect(document.documentElement).not.toHaveAttribute("data-theme");
    view.unmount();
    expect(listeners.size).toBe(0);
  });
});
