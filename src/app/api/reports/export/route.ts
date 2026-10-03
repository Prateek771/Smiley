import { exportReport, reportFilters } from "@/server/reporting";
import { respondFailure } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { return new Response(await exportReport(request.headers, reportFilters(request)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="smiley-scoped-report.csv"', "cache-control": "no-store", "x-content-type-options": "nosniff" } }); }
  catch (error) { return respondFailure(error); }
}
