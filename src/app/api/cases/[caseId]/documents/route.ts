import { AuthError, requireStaffSession } from "@/server/auth";
import { branchScope } from "@/server/access/permissions";
import { listDocuments, uploadDocument } from "@/server/documents";
import { MAX_DOCUMENT_BYTES } from "@/server/documents/validation";
import { jsonResponse, readLimitedBody, requireSameOrigin, respondFailure } from "@/server/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ caseId: string }> };
export async function GET(request: Request, context: Context) {
  try { return jsonResponse(await listDocuments(request.headers, (await context.params).caseId)); }
  catch (error) { return respondFailure(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireStaffSession(request.headers);
    if (!branchScope(actor, "document:write").length) throw new AuthError(403, "Your staff role cannot upload documents.");
    requireSameOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) throw new AuthError(415, "Send one file in a multipart request.");
    const bytes = await readLimitedBody(request, MAX_DOCUMENT_BYTES + 64 * 1024);
    let form: FormData;
    try { form = await new Request(request.url, { method: "POST", headers: request.headers, body: Buffer.from(bytes) }).formData(); }
    catch { throw new AuthError(400, "The upload request is invalid."); }
    const allowed = new Set(["file", "documentType", "documentId", "idempotencyKey"]);
    const seen = new Set<string>();
    for (const [name, value] of form.entries()) {
      if (!allowed.has(name) || seen.has(name) || (name !== "file" && typeof value !== "string")) throw new AuthError(400, "Send one file and its document fields only.");
      seen.add(name);
    }
    const file = form.get("file");
    if (!(file instanceof File)) throw new AuthError(400, "Choose one document file.");
    const result = await uploadDocument(request.headers, (await context.params).caseId, {
      bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, mimeType: file.type,
      documentType: form.get("documentType"), idempotencyKey: form.get("idempotencyKey"),
      ...(form.get("documentId") ? { documentId: form.get("documentId") } : {}),
    });
    return jsonResponse(result, result.idempotent ? 200 : 201);
  } catch (error) { return respondFailure(error); }
}
