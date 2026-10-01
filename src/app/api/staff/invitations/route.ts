import { z } from "zod";
import { AuthError, requireStaffSession } from "@/server/auth";
import { createInvitation } from "@/server/auth/staff";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ email: z.string(), branchId: z.string(), role: z.string(), expiresInHours: z.number().optional() });

export async function POST(request: Request): Promise<Response> {
  try {
    const actor = await requireStaffSession(request.headers);
    const body = input.safeParse(await readJson(request));
    if (!body.success) throw new AuthError(400, "Provide a valid staff invitation.");
    return jsonResponse(await createInvitation(actor, body.data), 201);
  } catch (error) { return respondFailure(error); }
}
