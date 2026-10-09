import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}
export function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
export function hashToken(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export function newSessionToken(): string { return randomBytes(48).toString("base64url"); }
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(24).toString("base64url");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("base64url")}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [version, salt, stored, extra] = encoded.split("$");
  if (version !== "scrypt-v1" || !salt || !stored || extra !== undefined || salt.length > 64) return false;
  const expected = Buffer.from(stored, "base64url");
  if (expected.length !== 64) return false;
  const actual = await derive(password, salt);
  return timingSafeEqual(expected, actual);
}

/** Explicit public origin is required behind the production reverse proxy. */
export function allowedRequestOrigin(request: Request, configuredOrigin?: string, production = false): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (production && !configuredOrigin) return false;
  let expected: string;
  try { expected = new URL(configuredOrigin || request.url).origin; } catch { return false; }
  const origin = request.headers.get("origin");
  if (origin) return origin === expected;
  // Script clients without Origin can use JSON; browsers cannot submit cross-origin JSON without preflight.
  return request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "application/json";
}
