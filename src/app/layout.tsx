import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";

const inter = localFont({
  src: "./fonts/InterVariable.woff2",
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
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
