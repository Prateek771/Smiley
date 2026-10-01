import { z } from "zod";
import { AuthError } from "@/server/auth";
import { acceptInvitation } from "@/server/auth/staff";
import { jsonResponse, readJson, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ token: z.string(), name: z.string(), password: z.string() });

export async function POST(request: Request): Promise<Response> {
  try {
    const body = input.safeParse(await readJson(request));
    if (!body.success) throw new AuthError(400, "Provide the invitation link, your name, and a password.");
    return jsonResponse(await acceptInvitation(body.data.token, body.data.name, body.data.password), 201);
  } catch (error) { return respondFailure(error); }
}
