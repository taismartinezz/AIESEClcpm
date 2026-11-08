import type { Metadata } from "next";
import McShell from "@/components/layout/McShell";
import { ThemeProvider } from "@/context/ThemeContext";

// "National · LC Manager"; the page renames the tab after its MC once it knows it.
export const metadata: Metadata = { title: "National" };

// The national (MC) view has its own space, outside the LC app.
export default function NationalLayout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <McShell>{children}</McShell>
    </ThemeProvider>
  );
}
