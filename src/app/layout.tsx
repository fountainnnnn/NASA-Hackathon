import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const plexMono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

const title = "MarsWalk Copilot: plan a Marswalk on real NASA terrain";
const description =
  "Point at Jezero Crater, ask a question, and an AI copilot plans your Marswalk on real NASA terrain and data. Made by Ng Yu Hang, team Ecliptical, for NASA Space Apps Challenge 2026 Singapore.";

export const metadata: Metadata = {
  title,
  description,
  authors: [{ name: "Ng Yu Hang" }],
  openGraph: { title, description, type: "website" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#120d0e" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
