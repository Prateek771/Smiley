import { getCase } from "@/server/cases";
import { jsonResponse, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ caseId: string }> }) {
  try {
    const { caseId } = await context.params;
    return jsonResponse(await getCase(request.headers, caseId));
  } catch (error) { return respondFailure(error); }
}
