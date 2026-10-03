import { adminData, applyAdminAction } from "@/server/admin";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
export const runtime = "nodejs";
export async function GET(request: Request) { try { return jsonResponse(await adminData(request.headers)); } catch (error) { return respondFailure(error); } }
export async function POST(request: Request) { try { return jsonResponse(await applyAdminAction(request.headers, await readJson(request))); } catch (error) { return respondFailure(error); } }
