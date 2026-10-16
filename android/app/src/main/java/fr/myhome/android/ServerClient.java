package fr.myhome.android;

import android.content.Context;
import android.webkit.CookieManager;
import org.json.JSONException;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/** Uses the same HttpOnly session as the trusted NAS WebView; never stores a password. */
public final class ServerClient {
    private final Context context;
    private final String origin;
    private final String session;

    public ServerClient(Context context, String origin) throws IOException {
        this.context = context.getApplicationContext();
        this.origin = normalizeOrigin(origin);
        this.session = sessionCookie(this.origin);
    }

    public static String normalizeOrigin(String value) throws IOException {
        try {
            URI uri = new URI(value == null ? "" : value.trim());
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null || uri.getUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath()))
                || uri.getPort() == 0 || uri.getPort() > 65535) {
                throw new IOException("Indiquez l’adresse HTTPS de myHome, sans chemin ni identifiants.");
            }
            return new URI("https", null, uri.getHost().toLowerCase(java.util.Locale.ROOT), uri.getPort() == 443 ? -1 : uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException error) {
            throw new IOException("L’adresse du NAS n’est pas valide.");
        }
    }

    public static String sessionCookie(String origin) {
        if (origin == null || origin.isEmpty()) return "";
        String cookies = CookieManager.getInstance().getCookie(origin);
        if (cookies == null) return "";
        for (String part : cookies.split(";")) {
            String cookie = part.trim();
            if (cookie.matches("myhome_session=[A-Za-z0-9_-]{64}")) return cookie;
        }
        return "";
    }

    public JSONObject snapshot(String householdId) throws IOException {
        String query = householdId == null || householdId.isEmpty() ? "" : "?household=" + URLEncoder.encode(householdId, "UTF-8");
        return request("GET", "/api/state" + query, null);
    }

    public JSONObject command(JSONObject command) throws IOException {
        return request("POST", "/api/command", command);
    }

    private JSONObject request(String method, String path, JSONObject body) throws IOException {
        WidgetStore store = new WidgetStore(context);
        if (!origin.equals(store.getOrigin())) throw new IOException("L’adresse du NAS a changé. Reconfigurez le widget.");
        if (!session.equals(sessionCookie(origin))) throw new IOException("La session a changé. Actualisez le widget.");
        if (session.isEmpty()) {
            store.clearCaches();
            throw new ApiException(401, "Connectez-vous dans l’application myHome.");
        }
        HttpURLConnection connection = (HttpURLConnection) new java.net.URL(origin + path).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            connection.setRequestMethod(method);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Cookie", session);
            connection.setRequestProperty("Origin", origin);
            connection.setRequestProperty("Cache-Control", "no-cache");
            if (body != null) {
                byte[] data = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setFixedLengthStreamingMode(data.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(data); }
            }
            int status = connection.getResponseCode();
            if (!origin.equals(store.getOrigin()) || !session.equals(sessionCookie(origin))) {
                throw new IOException("La session a changé. Actualisez le widget.");
            }
            if (status == 401 || status == 403) store.clearCaches();
            if (status >= 300 && status < 400) throw new ApiException(status, "Vérifiez l’adresse HTTPS exacte du NAS dans l’application.");
            InputStream source = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
            String text = "";
            if (source != null) {
                try (InputStream input = source; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (output.size() + count > 8 * 1024 * 1024) throw new IOException("La réponse du NAS est trop volumineuse.");
                        output.write(buffer, 0, count);
                    }
                    text = new String(output.toByteArray(), StandardCharsets.UTF_8);
                }
            }
            JSONObject result;
            try { result = new JSONObject(text); }
            catch (JSONException error) { throw new ApiException(status, "Le NAS n’a pas renvoyé une réponse myHome valide."); }
            if (status < 200 || status >= 300) {
                String message = result.optString("error", "Connexion au NAS indisponible.");
                throw new ApiException(status, message.length() > 400 ? message.substring(0, 400) : message);
            }
            return result;
        } finally { connection.disconnect(); }
    }

    public static final class ApiException extends IOException {
        private final int status;
        public ApiException(int status, String message) { super(message); this.status = status; }
        public int getStatus() { return status; }
    }
}
