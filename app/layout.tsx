import type { Metadata, Viewport } from "next";

import { SiteNav } from "@/components/SiteNav";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Learn Chess Opening — train openings until they are automatic",
    template: "%s · Learn Chess Opening",
  },
  description:
    "Learn chess openings by recalling the right move, again and again. Structured repertoires, spaced repetition and adaptive drills.",
  metadataBase: new URL("https://learn-chess-opening.local"),
  openGraph: {
    title: "Learn Chess Opening",
    description:
      "Don't just study an opening. Repeatedly recall the correct move until it becomes automatic.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#16171d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ink-50">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-ink-900 focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <SiteNav />
        <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6 sm:px-6">
          {children}
        </main>
      </body>
    </html>
  );
}
