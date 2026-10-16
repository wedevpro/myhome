package fr.myhomeia.android;

import android.webkit.WebView;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Best-effort camera constraints; exposes no native JavaScript interface. */
final class CameraFocusSupport {
    private static String script;

    private CameraFocusSupport() {}

    static void install(WebView view, String origin) {
        try {
            if (script == null) {
                try (InputStream input = view.getContext().getAssets().open("camera-focus.js");
                        ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                    script = new String(output.toByteArray(), StandardCharsets.UTF_8);
                }
            }
            view.evaluateJavascript(script + "(" + JSONObject.quote(origin) + ");", null);
        } catch (IOException ignored) { /* Camera permission and scanning still work without this enhancement. */ }
    }
}
