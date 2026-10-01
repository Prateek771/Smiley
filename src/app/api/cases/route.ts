import { getDeskData, createCase } from "@/server/cases";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams;
    const data = await getDeskData(request.headers, { q: search.get("q") ?? undefined, branchId: search.get("branchId") || undefined });
    return jsonResponse({ cases: data.cases, casesTruncated: data.casesTruncated });
  } catch (error) { return respondFailure(error); }
}
export async function POST(request: Request) {
  try {
    return jsonResponse(await createCase(request.headers, await readJson(request)), 201);
  } catch (error) { return respondFailure(error); }
}
