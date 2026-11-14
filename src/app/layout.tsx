import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  title: "MarsWalk Copilot — Jezero Marswalk planner",
  description:
    "A georeferenced 3D Jezero Crater built from NASA MRO CTX data. Click the ground, ask the copilot, and watch deterministic tools draw routes, pins and hazards on the terrain.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#120d0e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
