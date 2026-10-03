import { headers } from "next/headers";
import { adminData } from "@/server/admin";
import { AdminPanel } from "@/features/desk/admin-panel";
export default async function HospitalAdministration() { return <AdminPanel data={await adminData(new Headers(await headers()))} />; }
