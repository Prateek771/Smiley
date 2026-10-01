import { getDeskData, addMembership } from "@/server/cases";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const data = await getDeskData(request.headers);
    return jsonResponse({ memberships: data.memberships });
  } catch (error) { return respondFailure(error); }
}
export async function POST(request: Request) {
  try {
    return jsonResponse(await addMembership(request.headers, await readJson(request)), 201);
  } catch (error) { return respondFailure(error); }
}
