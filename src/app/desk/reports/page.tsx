import { headers } from "next/headers";
import { getReport, type ReportFilters } from "@/server/reporting";
import { ReportingPanel } from "@/features/desk/reporting-panel";
export default async function Reports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const query = await searchParams;
  const filters: ReportFilters = { mode: query.mode === undefined ? "desk" : query.mode as "desk" | "finance", ...(query.branchId ? { branchId: query.branchId } : {}), ...(query.caseNumber ? { caseNumber: query.caseNumber } : {}), ...(query.from ? { from: query.from } : {}), ...(query.to ? { to: query.to } : {}) };
  return <ReportingPanel data={await getReport(new Headers(await headers()), filters)} filters={filters} />;
}
