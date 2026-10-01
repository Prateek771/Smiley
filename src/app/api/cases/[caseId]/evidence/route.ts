import { addSourceEvidence } from "@/server/documents";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try { return jsonResponse(await addSourceEvidence(request.headers, (await context.params).caseId, await readJson(request))); }
  catch (error) { return respondFailure(error); }
}
