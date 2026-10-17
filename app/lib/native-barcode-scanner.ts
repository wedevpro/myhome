export type ScannerCamera = "environment" | "user";
export type NativeBarcodeResult =
  | { status: "ok"; code: string }
  | { status: "cancelled" }
  | { status: "error"; message: string };
export type NativeBarcodeOutcome = NativeBarcodeResult | { status: "unavailable" };

declare global {
  interface Window {
    myHomeNativeScanner?: unknown;
  }
}

const invalidResult = "Le scanner n’a pas renvoyé de code valide. Réessayez ou saisissez le code manuellement.";
const failedScan = "Impossible d’ouvrir le scanner. Réessayez ou saisissez le code manuellement.";

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159);
  });
}

/** Treat native output as untrusted data; only a validated code can reach a list. */
export function parseNativeBarcodeResult(value: unknown): NativeBarcodeResult {
  if (typeof value !== "string") return { status: "error", message: invalidResult };
  try {
    const result: unknown = JSON.parse(value);
    if (!result || typeof result !== "object") return { status: "error", message: invalidResult };
    const reply = result as Record<string, unknown>;
    if (reply.status === "cancelled") return { status: "cancelled" };
    if (reply.status === "ok" && typeof reply.code === "string" && reply.code.trim().length > 0 && reply.code.length <= 80 && !hasControlCharacters(reply.code)) {
      return { status: "ok", code: reply.code };
    }
    if (reply.status === "error") {
      const message = typeof reply.message === "string" ? reply.message.trim() : "";
      return { status: "error", message: message && message.length <= 500 && !hasControlCharacters(message) ? message : failedScan };
    }
  } catch { /* An incompatible or interrupted scanner must never submit a code. */ }
  return { status: "error", message: invalidResult };
}

/** Call directly from a user gesture: the Android prompt returns synchronously. */
export function scanWithNativeCamera(bridge: unknown, camera: ScannerCamera, onCode: (code: string) => void): NativeBarcodeOutcome {
  let result: NativeBarcodeResult;
  try {
    if (!bridge || typeof bridge !== "object") return { status: "unavailable" };
    const scanner = bridge as Record<string, unknown>;
    if (scanner.version !== 1 || typeof scanner.scan !== "function") return { status: "unavailable" };
    result = parseNativeBarcodeResult(scanner.scan.call(bridge, camera));
  } catch {
    // Once a native scanner is invoked, opening a second web camera is unsafe.
    return { status: "error", message: failedScan };
  }
  if (result.status === "ok") onCode(result.code);
  return result;
}
