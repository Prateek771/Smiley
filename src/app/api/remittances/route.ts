import { z } from "zod";
import { recordRemittance, reverseRemittance } from "@/server/financial/settlement";
import { jsonResponse, readJson, respondFailure } from "@/server/http";
import { AccessError } from "@/server/access";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const parsed = z.object({ type: z.enum(["receipt", "reversal"]), data: z.unknown() }).strict().safeParse(await readJson(request));
    if (!parsed.success) throw new AccessError(400, "Choose a supported remittance action.");
    return jsonResponse(await (parsed.data.type === "receipt" ? recordRemittance : reverseRemittance)(request.headers, parsed.data.data));
  } catch (error) { return respondFailure(error); }
}
