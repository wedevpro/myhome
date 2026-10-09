import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { database } from "./sqlite";
import type { User } from "./model";
import { allowedRequestOrigin, hashPassword, hashToken, newSessionToken, normalizeEmail, verifyPassword } from "./auth-crypto";
import { AuthBodyError, readAuthJson } from "./auth-body";

const SESSION_COOKIE = "myhomeia_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
export class AuthError extends Error { constructor(public status: number, message: string) { super(message); } }
export function requestOriginAllowed(request: Request): boolean {
  return allowedRequestOrigin(request, process.env.SITE_ORIGIN, process.env.NODE_ENV === "production");
}
function cookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production" || process.env.AUTH_COOKIE_SECURE !== "false", path: "/" };
}
export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{64}$/.test(token)) return null;
  return database().prepare("SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?").bind(hashToken(token), Date.now()).first<User>();
}
async function rateLimit(email: string, signup = false): Promise<void> {
  const db = database(), now = Date.now(), date = new Date(now).toISOString();
  const window = signup ? 60 * 60 * 1000 : 15 * 60 * 1000;
  const limits = signup ? [{ key: "signup:global", max: 10 }] : [{ key: "login:global", max: 100 }, { key: `login:${hashToken(email)}`, max: 10 }];
  await db.batch(limits.map(({ key }) => db.prepare("INSERT INTO auth_rate_limits(key,window_start,attempts,created_by,created_at,updated_by,updated_at) VALUES(?,?,1,'system',?,'system',?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_rate_limits.window_start<? THEN 1 ELSE auth_rate_limits.attempts+1 END,window_start=CASE WHEN auth_rate_limits.window_start<? THEN excluded.window_start ELSE auth_rate_limits.window_start END,updated_by='system',updated_at=excluded.updated_at").bind(key, now, date, date, now - window, now - window)));
  for (const { key, max } of limits) {
    const row = await db.prepare("SELECT attempts FROM auth_rate_limits WHERE key=?").bind(key).first<{ attempts: number }>();
    if ((row?.attempts || 0) > max) throw new AuthError(429, "Trop de tentatives. Réessayez dans quelques minutes.");
  }
  await db.prepare("DELETE FROM auth_rate_limits WHERE window_start<?").bind(now - 24 * 60 * 60 * 1000).run();
}
export async function authBody(request: Request): Promise<Record<string, unknown>> {
  if (!requestOriginAllowed(request)) throw new AuthError(403, "L’origine de cette requête n’est pas autorisée.");
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new AuthError(415, "Une requête JSON est attendue.");
  if (Number(request.headers.get("content-length")) > 8192) throw new AuthError(413, "La requête est trop volumineuse.");
  return readAuthJson(request);
}
function credentials(body: Record<string, unknown>) {
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || password.length > 256 || !password) throw new AuthError(400, "Vérifiez votre adresse e-mail et votre mot de passe.");
  return { email, password };
}
async function newSession(userId: string) {
  const db = database(), jar = await cookies(), old = jar.get(SESSION_COOKIE)?.value;
  const token = newSessionToken(), now = new Date().toISOString();
  const statements = [db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(hashToken(token), userId, Date.now() + SESSION_SECONDS * 1000, userId, now, userId, now), db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(Date.now())];
  if (old) statements.push(db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(hashToken(old)));
  await db.batch(statements);
  jar.set(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_SECONDS });
}
export async function signUp(body: Record<string, unknown>): Promise<User> {
  const { email, password } = credentials(body);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new AuthError(400, "Indiquez un nom de 1 à 100 caractères.");
  if (password.length < 12) throw new AuthError(400, "Choisissez un mot de passe d’au moins 12 caractères.");
  await rateLimit(email, true);
  const db = database(), id = randomUUID(), now = new Date().toISOString(), passwordHash = await hashPassword(password);
  try {
    await db.batch([
      db.prepare("INSERT INTO users(id,name,email,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, name, email, id, now, id, now),
      db.prepare("INSERT INTO accounts(user_id,email,password_hash,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)").bind(id, email, passwordHash, id, now, id, now),
    ]);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint/.test(error.message)) throw new AuthError(409, "Cette adresse e-mail possède déjà un compte. Connectez-vous.");
    throw error;
  }
  await newSession(id);
  return { id, name, email };
}
let dummyPasswordHash: Promise<string> | undefined;
export async function signIn(body: Record<string, unknown>): Promise<User> {
  const { email, password } = credentials(body);
  await rateLimit(email);
  const account = await database().prepare("SELECT a.user_id,a.password_hash,u.name,u.email FROM accounts a JOIN users u ON u.id=a.user_id WHERE a.email=?").bind(email).first<{ user_id: string; password_hash: string; name: string; email: string }>();
  // Both known and unknown accounts perform the same password derivation.
  dummyPasswordHash ||= hashPassword(newSessionToken());
  const valid = await verifyPassword(password, account?.password_hash || await dummyPasswordHash);
  if (!account || !valid) throw new AuthError(401, "Adresse e-mail ou mot de passe incorrect.");
  await newSession(account.user_id);
  return { id: account.user_id, name: account.name, email: account.email };
}
export async function signOut(): Promise<void> {
  const jar = await cookies(), token = jar.get(SESSION_COOKIE)?.value;
  if (token) await database().prepare("DELETE FROM sessions WHERE token_hash=?").bind(hashToken(token)).run();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
export function authFailure(error: unknown) {
  if (error instanceof AuthError || error instanceof AuthBodyError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.status === 429 ? { "Retry-After": "900" } : {}) } });
  console.error("MyHomeIA authentication error", error);
  return Response.json({ error: "La connexion est momentanément indisponible. Réessayez." }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
