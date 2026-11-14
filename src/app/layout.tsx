import type { Metadata, Viewport } from "next";
import { Martian_Mono, Michroma, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

const sans = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"], weight: ["400", "600"], display: "swap" });
// narrowest width axis keeps 11 px readouts compact
const mono = Martian_Mono({ variable: "--font-martian", subsets: ["latin"], weight: "variable", axes: ["wdth"], display: "swap" });
// wordmark and GO / HOLD / NO GO only
const display = Michroma({ variable: "--font-michroma", subsets: ["latin"], weight: "400", display: "swap" });

const title = "HeyMars: plan a Marswalk on real NASA terrain";
const description =
  "Click anywhere on Mars and MarsAgent reads the data. In Jezero Crater, drag to plan a Marswalk on real NASA terrain. Made by Ng Yu Hang, team Ecliptical, for NASA Space Apps Challenge 2026 Singapore.";

export const metadata: Metadata = {
  title,
  description,
  authors: [{ name: "Ng Yu Hang" }],
  openGraph: { title, description, type: "website" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#060505" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
