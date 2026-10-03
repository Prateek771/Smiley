import { z } from "zod";
import { getCaseAI, requestAIRun, reviewAIResult } from "@/server/ai";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
import { AccessError } from "@/server/access";
export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) { try { return jsonResponse(await getCaseAI(request.headers, (await context.params).caseId)); } catch (error) { return respondFailure(error); } }
export async function POST(request: Request, context: Context) {
  try {
    const body = z.object({ mode: z.enum(["request", "review"]), input: z.unknown() }).strict().safeParse(await readJson(request));
    if (!body.success) throw new AccessError(400, "Choose an AI request or staff review.");
    const caseId = (await context.params).caseId;
    return jsonResponse(await (body.data.mode === "request" ? requestAIRun(request.headers, caseId, body.data.input) : reviewAIResult(request.headers, caseId, body.data.input)));
  } catch (error) { return respondFailure(error); }
}
