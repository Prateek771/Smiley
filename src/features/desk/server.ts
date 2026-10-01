import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError, requireStaffSession } from "@/server/auth";
import { getDeskData, type DeskFilters } from "@/server/cases";

export async function deskSession() {
  try { return await requireStaffSession(new Headers(await headers())); }
  catch (error) { if (error instanceof AuthError && error.status === 401) redirect("/login"); throw error; }
}
export async function deskData(filters: DeskFilters = {}) {
  try { return await getDeskData(new Headers(await headers()), filters); }
  catch (error) { if (error instanceof AuthError && error.status === 401) redirect("/login"); throw error; }
}
