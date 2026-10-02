import { applyFinancialAction, getFinancialCase } from "@/server/financial";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try { return jsonResponse(await getFinancialCase(request.headers, (await context.params).caseId)); }
  catch (error) { return respondFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try { return jsonResponse(await applyFinancialAction(request.headers, (await context.params).caseId, await readJson(request))); }
  catch (error) { return respondFailure(error); }
}
