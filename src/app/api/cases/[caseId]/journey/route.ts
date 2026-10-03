import { applyJourneyAction, getJourney } from "@/server/journey";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try { return jsonResponse(await getJourney(request.headers, (await context.params).caseId)); }
  catch (error) { return respondFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try { return jsonResponse(await applyJourneyAction(request.headers, (await context.params).caseId, await readJson(request))); }
  catch (error) { return respondFailure(error); }
}
