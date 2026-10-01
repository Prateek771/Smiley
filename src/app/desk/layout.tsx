import type { ReactNode } from "react";
import { DeskShell } from "@/features/desk/shell";
import { deskSession } from "@/features/desk/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function DeskLayout({ children }: { children: ReactNode }) {
  return <DeskShell actor={await deskSession()}>{children}</DeskShell>;
}
