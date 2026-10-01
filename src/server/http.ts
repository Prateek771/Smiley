import { AuthError } from "./auth";

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = process.env.BETTER_AUTH_URL;
  if (!expected || !origin || origin !== new URL(expected).origin) {
    throw new AuthError(403, "This request must come from the staff application.");
  }
}

export async function readLimitedBody(request: Request, maximum: number): Promise<Uint8Array> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximum) throw new AuthError(413, "The request is too large.");
  if (!request.body) throw new AuthError(400, "Provide a request body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new AuthError(413, "The request is too large.");
      }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

export async function readJson(request: Request): Promise<unknown> {
  requireSameOrigin(request);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AuthError(415, "Send a JSON request.");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBody(request, 64 * 1024))); }
  catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, "The request body is not valid JSON.");
  }
}

export function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export function respondFailure(error: unknown): Response {
  if (error instanceof AuthError) return jsonResponse({ error: error.message }, error.status);
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
  if (code === "23505") return jsonResponse({ error: "This record or action already exists." }, 409);
  if (["23503", "23514", "22P02", "22003", "22001"].includes(code ?? "")) return jsonResponse({ error: "The linked records or values are invalid." }, 400);
  if (code === "42501") return jsonResponse({ error: "This action is outside your staff access." }, 403);
  console.error("Smiley request failed", { code: code ?? "unexpected" });
  return jsonResponse({ error: "The request could not be completed. Retry or contact your administrator." }, 500);
}
