import { platformData, applyPlatformAction } from "@/server/admin";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return jsonResponse(await platformData(request.headers)); } catch (error) { return respondFailure(error); } }
export async function POST(request: Request) { try { return jsonResponse(await applyPlatformAction(request.headers, await readJson(request))); } catch (error) { return respondFailure(error); } }
