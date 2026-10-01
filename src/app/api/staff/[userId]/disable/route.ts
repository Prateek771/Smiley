import { requireStaffSession } from "@/server/auth";
import { disableStaff } from "@/server/auth/staff";
import { jsonResponse, requireSameOrigin, respondFailure } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ userId: string }> }): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await requireStaffSession(request.headers);
    await disableStaff(actor, (await context.params).userId);
    return jsonResponse({ disabled: true });
  } catch (error) { return respondFailure(error); }
}
