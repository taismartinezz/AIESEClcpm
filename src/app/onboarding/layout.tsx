import { ThemeProvider } from "@/context/ThemeContext";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
