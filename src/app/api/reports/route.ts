import { getReport, reportFilters } from "@/server/reporting";
import { jsonResponse, respondFailure } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return jsonResponse(await getReport(request.headers, reportFilters(request))); } catch (error) { return respondFailure(error); } }
