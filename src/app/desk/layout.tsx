import type { ReactNode } from "react";
import { DeskShell } from "@/features/desk/shell";
import { deskSession } from "@/features/desk/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function DeskLayout({ children }: { children: ReactNode }) {
  const actor = await deskSession();
  if (actor.roles.includes("SUPER_ADMIN")) redirect("/platform");
  return <DeskShell actor={actor}>{children}</DeskShell>;
}
