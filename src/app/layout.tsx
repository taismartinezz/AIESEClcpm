import type { Metadata } from "next";
import { Lato } from "next/font/google";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

// AIESEC's brand typeface. Downloaded at build time and self-hosted by Next.js:
// browsers never request fonts from Google.
const lato = Lato({
  weight: ["300", "400", "700", "900"],
  subsets: ["latin", "latin-ext"],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${lato.variable} h-full`}>
      <head>
        {/* Apply the stored theme (default: light) before first paint so pages don't flash the wrong theme */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('aiesec-theme');if(t==='dark')document.documentElement.setAttribute('data-theme','dark');else if(t!=='system')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();` }} />
      </head>
      <body className="h-full">
        {children}
      </body>
    </html>
  );
}
