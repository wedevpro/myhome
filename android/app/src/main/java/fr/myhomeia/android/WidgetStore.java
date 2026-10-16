package fr.myhomeia.android;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** App-private settings; cached list data is bound to the active WebView session. */
public final class WidgetStore {
    private final SharedPreferences preferences;
    public WidgetStore(Context context) { preferences = context.getApplicationContext().getSharedPreferences("myhomeia_widgets", Context.MODE_PRIVATE); }
    public String getOrigin() { return preferences.getString("origin", ""); }
    public void setOrigin(String origin) {
        if (!origin.equals(getOrigin())) preferences.edit().clear().putString("origin", origin).apply();
    }
    public void saveWidget(int id, String householdId, String listId) {
        saveWidget(id, householdId, listId, "");
    }
    public void saveWidget(int id, String householdId, String listId, String listName) {
        preferences.edit().putString("household_" + id, householdId).putString("list_" + id, listId)
            .putString("name_" + id, listName == null ? "" : listName)
            .putString("nameSession_" + id, sessionHash())
            .remove("cache_" + id).remove("session_" + id).remove("error_" + id).remove("updated_" + id).apply();
    }
    public String getHouseholdId(int id) { return preferences.getString("household_" + id, ""); }
    public String getListId(int id) { return preferences.getString("list_" + id, ""); }
    public String getWidgetListName(int id) {
        String session = sessionHash();
        return !session.isEmpty() && session.equals(preferences.getString("nameSession_" + id, ""))
                ? preferences.getString("name_" + id, "") : "";
    }
    public void removeWidget(int id) {
        preferences.edit().remove("household_" + id).remove("list_" + id).remove("cache_" + id)
            .remove("name_" + id).remove("nameSession_" + id)
            .remove("session_" + id).remove("error_" + id).remove("updated_" + id).apply();
    }
    public String getError(int id) { return preferences.getString("error_" + id, ""); }
    public void setError(int id, String message) { preferences.edit().putString("error_" + id, message == null ? "" : message).apply(); }
    public long getUpdatedAt(int id) { return preferences.getLong("updated_" + id, 0); }
    public void clearSnapshot(int id) {
        preferences.edit().remove("cache_" + id).remove("session_" + id).remove("updated_" + id).apply();
    }
    public void clearCaches() {
        SharedPreferences.Editor edit = preferences.edit();
        for (String key : preferences.getAll().keySet()) {
            if (key.startsWith("cache_") || key.startsWith("session_") || key.startsWith("updated_") || key.startsWith("error_") ||
                    key.startsWith("name_") || key.startsWith("nameSession_")) edit.remove(key);
        }
        edit.apply();
    }
    private String sessionHash() {
        return sessionHash(ServerClient.sessionCookie(getOrigin()));
    }
    private static String sessionHash(String cookie) {
        if (cookie.isEmpty()) return "";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(cookie.getBytes(StandardCharsets.UTF_8));
            StringBuilder result = new StringBuilder();
            for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
            return result.toString();
        } catch (NoSuchAlgorithmException impossible) { throw new IllegalStateException(impossible); }
    }
    public JSONObject getSnapshot(int id) {
        String currentSession = sessionHash();
        if (currentSession.isEmpty() || !currentSession.equals(preferences.getString("session_" + id, ""))) return null;
        String cached = preferences.getString("cache_" + id, "");
        if (cached.isEmpty()) return null;
        try { return new JSONObject(cached); } catch (JSONException ignored) { return null; }
    }
    public void saveSnapshot(int id, JSONObject snapshot, String expectedOrigin, String expectedCookie) {
        try {
            if (!expectedOrigin.equals(getOrigin()) || !expectedCookie.equals(ServerClient.sessionCookie(expectedOrigin))) return;
            String session = sessionHash(expectedCookie);
            if (session.isEmpty()) return;
            JSONObject household = snapshot.getJSONObject("household");
            if (!getHouseholdId(id).equals(household.optString("id"))) throw new IllegalArgumentException("Le foyer du widget a changé.");
            JSONArray entities = snapshot.getJSONArray("entities"), selected = new JSONArray();
            boolean listFound = false;
            for (int index = 0; index < entities.length(); index++) {
                JSONObject entity = entities.getJSONObject(index);
                if (!getHouseholdId(id).equals(entity.optString("householdId"))) continue;
                String kind = entity.optString("kind");
                if (getListId(id).equals(entity.optString("id")) && ("shopping".equals(kind) || "checklist".equals(kind))) {
                    selected.put(entity); listFound = true;
                } else if ("item".equals(kind) && getListId(id).equals(entity.getJSONObject("data").optString("listId"))) selected.put(entity);
            }
            if (!listFound) throw new IllegalArgumentException("Cette liste n’est plus disponible.");
            JSONObject limited = new JSONObject().put("user", new JSONObject().put("id", snapshot.getJSONObject("user").getString("id")))
                .put("household", new JSONObject().put("id", household.getString("id")).put("name", household.optString("name")))
                .put("entities", selected);
            preferences.edit().putString("cache_" + id, limited.toString()).putString("session_" + id, session)
                .putLong("updated_" + id, System.currentTimeMillis()).apply();
        } catch (JSONException error) { throw new IllegalArgumentException("Les données du NAS ne sont pas valides."); }
    }
}
