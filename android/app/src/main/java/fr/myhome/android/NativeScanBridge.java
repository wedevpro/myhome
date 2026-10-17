package fr.myhome.android;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;

/** A single barcode result, bound to the requesting NAS document and session. */
final class NativeScanBridge {
    static final String PROMPT = "myhome:native-scan:v1";
    interface Reply { void complete(String response); }

    private final Activity activity;
    private final Supplier<WebView> currentWeb;
    private final Supplier<String> currentOrigin;
    private Pending pending;
    private int nextRequestCode = 16000;
    private static String script;

    private static final class Pending {
        final WebView web;
        final String origin, page, cookie;
        final int requestCode;
        final Reply reply;
        Pending(WebView web, String origin, int requestCode, Reply reply) {
            this.web = web; this.origin = origin; this.page = page(web.getUrl());
            this.cookie = ServerClient.sessionCookie(origin);
            this.requestCode = requestCode; this.reply = reply;
        }
    }

    NativeScanBridge(Activity activity, Supplier<WebView> currentWeb, Supplier<String> currentOrigin) {
        this.activity = activity; this.currentWeb = currentWeb; this.currentOrigin = currentOrigin;
    }

    void install(WebView web, String url) {
        if (!trusted(web, url)) return;
        try {
            if (script == null) {
                try (InputStream input = activity.getAssets().open("native-scanner.js");
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    script = new String(output.toByteArray(), StandardCharsets.UTF_8);
                }
            }
            web.evaluateJavascript(script + "(" + JSONObject.quote(currentOrigin.get()) + ");", null);
        } catch (IOException ignored) { /* Older pages retain the web scanner. */ }
    }

    boolean handlePrompt(WebView web, String url, String message, String camera, Reply reply) {
        if (!PROMPT.equals(message)) return false;
        if (!trusted(web, url)) { respond(reply, "cancelled", null, null); return true; }
        if (!"environment".equals(camera) && !"user".equals(camera)) {
            respond(reply, "error", null, "Caméra inconnue."); return true;
        }
        if (pending != null) {
            respond(reply, "error", null, "Un scan est déjà en cours."); return true;
        }
        if (++nextRequestCode > 32000) nextRequestCode = 16001;
        Pending request = new Pending(web, currentOrigin.get(), nextRequestCode, reply);
        pending = request;
        try {
            activity.startActivityForResult(new Intent(activity, NativeScanActivity.class)
                    .putExtra("camera", camera), request.requestCode);
        } catch (RuntimeException unavailable) {
            pending = null;
            respond(reply, "error", null, "Impossible d’ouvrir le scanner Android. Vous pouvez saisir le code manuellement.");
        }
        return true;
    }

    boolean handleActivityResult(int requestCode, int resultCode, Intent data) {
        Pending request = pending;
        if (request == null || request.requestCode != requestCode) return false;
        pending = null;
        if (!trusted(request.web, request.web.getUrl())
                || !request.origin.equals(currentOrigin.get())
                || !request.page.equals(page(request.web.getUrl()))
                || !request.cookie.equals(ServerClient.sessionCookie(request.origin))) {
            respond(request.reply, "cancelled", null, null); return true;
        }
        if (resultCode != Activity.RESULT_OK) {
            respond(request.reply, "cancelled", null, null); return true;
        }
        String error = data == null ? null : data.getStringExtra("error");
        if (error != null && !error.trim().isEmpty()) {
            respond(request.reply, "error", null, error); return true;
        }
        String code = data == null ? null : data.getStringExtra("code");
        if (!NativeScanActivity.validCode(code))
            respond(request.reply, "error", null, "Le code détecté n’est pas valide pour un article.");
        else respond(request.reply, "ok", code.trim(), null);
        return true;
    }

    boolean hasPending() { return pending != null; }

    void cancel() {
        Pending request = pending;
        pending = null;
        if (request != null) {
            try { activity.finishActivity(request.requestCode); }
            catch (RuntimeException closedActivity) { /* A destroyed parent may already have closed its child. */ }
            respond(request.reply, "cancelled", null, null);
        }
    }

    private boolean trusted(WebView web, String url) {
        if (activity.isFinishing() || activity.isDestroyed() || web == null || web != currentWeb.get()) return false;
        String origin = currentOrigin.get();
        return matchesOrigin(url, origin) && matchesOrigin(web.getUrl(), origin)
                && page(url).equals(page(web.getUrl()));
    }

    private static boolean matchesOrigin(String url, String origin) {
        if (url == null || origin == null || origin.isEmpty()) return false;
        try {
            Uri uri = Uri.parse(url);
            return origin.equals(ServerClient.normalizeOrigin(new Uri.Builder().scheme(uri.getScheme())
                    .encodedAuthority(uri.getEncodedAuthority()).build().toString()));
        } catch (IOException | IllegalArgumentException invalid) { return false; }
    }

    private static String page(String url) {
        return url == null ? "" : Uri.parse(url).buildUpon().fragment(null).build().toString();
    }

    private static void respond(Reply reply, String status, String code, String error) {
        try {
            JSONObject response = new JSONObject().put("status", status);
            if (code != null) response.put("code", code);
            if (error != null) response.put("message", error);
            reply.complete(response.toString());
        } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        catch (RuntimeException closedDocument) { /* A discarded WebView cannot receive a result. */ }
    }
}
