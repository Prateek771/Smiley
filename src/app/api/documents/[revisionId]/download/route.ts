import { downloadDocument } from "@/server/documents";
import { respondFailure } from "@/server/http";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ revisionId: string }> }) {
  try {
    const file = await downloadDocument(request.headers, (await context.params).revisionId);
    const fallback = file.name.replace(/[^\x20-\x7e]|["\\]/gu, "_");
    return new Response(new Uint8Array(file.bytes), { headers: {
      "content-type": file.mimeType, "content-length": String(file.bytes.length),
      "content-disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox", "referrer-policy": "no-referrer",
    } });
  } catch (error) { return respondFailure(error); }
}
