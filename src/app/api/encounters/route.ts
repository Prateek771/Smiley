import { getDeskData, registerEncounter } from "@/server/cases";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const data = await getDeskData(request.headers);
    return jsonResponse({ encounters: data.encounters });
  } catch (error) { return respondFailure(error); }
}
export async function POST(request: Request) {
  try {
    return jsonResponse(await registerEncounter(request.headers, await readJson(request)), 201);
  } catch (error) { return respondFailure(error); }
}
