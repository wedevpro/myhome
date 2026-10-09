export class AuthBodyError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Limit bytes while reading, including requests without Content-Length. */
export async function readAuthJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new AuthBodyError(400, "La requête est invalide.");
  const reader = request.body.getReader(), parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new AuthBodyError(413, "La requête est trop volumineuse.");
      }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AuthBodyError(400, "La requête est invalide."); }
}
