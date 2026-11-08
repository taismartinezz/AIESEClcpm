import type { Metadata } from "next";
import McShell from "@/components/layout/McShell";
import { ThemeProvider } from "@/context/ThemeContext";

export const metadata: Metadata = { title: "National" };

// The national (MC) view has its own space, outside the LC app.
export default function NationalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <McShell>{children}</McShell>
    </ThemeProvider>
  );
}
