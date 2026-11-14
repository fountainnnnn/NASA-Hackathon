import type { Metadata } from "next";
import AppShell from "@/components/AppShell";

export const metadata: Metadata = {
  title: "MarsWalk Copilot — Jezero Marswalk planner",
};

export default function Home() {
  return <AppShell />;
}
