import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/native-barcode-scanner.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { parseNativeBarcodeResult, scanWithNativeCamera } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

test("Scanner natif : absence ou version incompatible laisse la caméra web disponible", () => {
  let called = 0;
  for (const bridge of [undefined, null, false, "Android", {}, { version: 1 }, { version: "1", scan() { called++; } }, { version: 2, scan() { called++; } }]) {
    assert.deepEqual(scanWithNativeCamera(bridge, "environment", () => called++), { status: "unavailable" });
  }
  assert.equal(called, 0);
});

test("Scanner natif : la caméra choisie et le code exact reviennent une seule fois à la liste", () => {
  for (const camera of ["environment", "user"]) {
    const received = [];
    const bridge = {
      version: 1,
      scan(value) {
        assert.strictEqual(this, bridge);
        assert.equal(value, camera);
        received.push("scan");
        return JSON.stringify({ status: "ok", code: "0012345678905" });
      },
    };
    const result = scanWithNativeCamera(bridge, camera, code => received.push(code));
    assert.deepEqual(result, { status: "ok", code: "0012345678905" });
    assert.deepEqual(received, ["scan", "0012345678905"]);
  }
});

test("Scanner natif : annuler ne transmet aucun code et ne démarre pas la caméra web", () => {
  let calls = 0;
  const result = scanWithNativeCamera({ version: 1, scan: () => '{"status":"cancelled"}' }, "environment", () => calls++);
  assert.deepEqual(result, { status: "cancelled" });
  assert.equal(calls, 0);
});

test("Scanner natif : les erreurs annoncées sont affichables sans ajouter ni ouvrir une seconde caméra", () => {
  let calls = 0;
  const result = scanWithNativeCamera({ version: 1, scan: () => JSON.stringify({ status: "error", message: "Autorisez l’accès à la caméra." }) }, "environment", () => calls++);
  assert.deepEqual(result, { status: "error", message: "Autorisez l’accès à la caméra." });
  assert.equal(calls, 0);
});

test("Scanner natif : exception et résultat incompatible restent des erreurs sans repli silencieux", () => {
  let calls = 0;
  for (const scan of [() => { throw new Error("Camera failed"); }, () => undefined, () => null, () => ({ status: "ok", code: "123" }), () => "", () => "not JSON", () => "null", () => "[]", () => "{}", () => '{"status":"unknown"}', () => Promise.resolve('{"status":"ok","code":"123"}')]) {
    assert.equal(scanWithNativeCamera({ version: 1, scan }, "environment", () => calls++).status, "error");
  }
  assert.equal(calls, 0);
});

test("Scanner natif : codes vides, trop longs et caractères de contrôle sont rejetés", () => {
  let calls = 0;
  for (const code of [undefined, null, 1234, "", "   ", "a".repeat(81), "123\n", "\u0000123", "123\u007f", "123\u0085"]) {
    const result = scanWithNativeCamera({ version: 1, scan: () => JSON.stringify({ status: "ok", code }) }, "environment", () => calls++);
    assert.equal(result.status, "error", String(code));
  }
  assert.equal(calls, 0);
  assert.deepEqual(parseNativeBarcodeResult(JSON.stringify({ status: "ok", code: "a".repeat(80) })), { status: "ok", code: "a".repeat(80) });
});

test("Scanner natif : une erreur sans message utilisable possède un message français par défaut", () => {
  for (const message of [undefined, null, 1, "", "  ", "a".repeat(501), "Erreur\u0000"]) {
    const result = parseNativeBarcodeResult(JSON.stringify({ status: "error", message }));
    assert.equal(result.status, "error");
    assert.match(result.message, /Impossible d’ouvrir le scanner/);
  }
});

test("Scanner natif : une erreur du traitement de liste ne relance pas le scanner", () => {
  let scans = 0, received = 0;
  assert.throws(() => scanWithNativeCamera({ version: 1, scan() { scans++; return '{"status":"ok","code":"123"}'; } }, "environment", () => { received++; throw new Error("Échec de la liste"); }), /Échec de la liste/);
  assert.equal(scans, 1);
  assert.equal(received, 1);
});
