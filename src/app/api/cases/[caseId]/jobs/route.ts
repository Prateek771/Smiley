import { getCaseJobs, requestCaseJob } from "@/server/jobs";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) { try { return jsonResponse(await getCaseJobs(request.headers, (await context.params).caseId)); } catch (error) { return respondFailure(error); } }
export async function POST(request: Request, context: Context) { try { return jsonResponse(await requestCaseJob(request.headers, (await context.params).caseId, await readJson(request))); } catch (error) { return respondFailure(error); } }
