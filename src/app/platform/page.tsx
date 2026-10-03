import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthError } from "@/server/auth";
import { platformData } from "@/server/admin";
import { PlatformPanel } from "@/features/desk/admin-panel";
import { SignOutButton } from "@/features/auth/sign-out-button";
import styles from "@/features/desk/desk.module.css";
export default async function PlatformRegistry() {
  let data;
  try { data = await platformData(new Headers(await headers())); }
  catch (error) { if (error instanceof AuthError && error.status === 401) redirect("/login"); throw error; }
  return <main className={styles.content}><a className={styles.back} href="/demo">Synthetic demo</a><SignOutButton /><PlatformPanel data={data} /></main>;
}
