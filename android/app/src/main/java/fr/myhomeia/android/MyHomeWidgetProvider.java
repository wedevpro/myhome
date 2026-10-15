package fr.myhomeia.android;

import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.PersistableBundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/** Android launcher widgets use the same authenticated API as the web application. */
public class MyHomeWidgetProvider extends AppWidgetProvider {
    static final String ACTION_REFRESH = "fr.myhomeia.android.WIDGET_REFRESH";
    static final String ACTION_ITEM = "fr.myhomeia.android.WIDGET_ITEM";
    static final String EXTRA_ITEM = "itemId";
    static final String EXTRA_ACTION = "action";
    private static final int JOB_BASE = 240_000;
    private static final ConcurrentHashMap<Integer, Boolean> BUSY = new ConcurrentHashMap<>();

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) { render(context, id); schedule(context, id, null); }
    }

    @Override public void onDeleted(Context context, int[] ids) {
        WidgetStore store = new WidgetStore(context);
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        for (int id : ids) {
            if (scheduler != null) scheduler.cancel(JOB_BASE + id);
            BUSY.remove(id);
            store.removeWidget(id);
        }
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id,
            android.os.Bundle options) { render(context, id); }

    @Override public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (!ACTION_REFRESH.equals(intent.getAction())) return;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (!installed(context, id)) return;
        schedule(context, id, null);
    }

    /** Invoked by a direct activity PendingIntent, never by a broadcast trampoline. */
    static void handleItemAction(Context context, Intent intent) {
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1);
        if (!installed(context, id)) return;
        String itemId = intent.getStringExtra(EXTRA_ITEM);
        String operation = intent.getStringExtra(EXTRA_ACTION);
        if (!validId(itemId)) return;
        WidgetStore store = new WidgetStore(context);
        JSONObject snapshot = store.getSnapshot(id);
        JSONObject list = findList(snapshot, store.getHouseholdId(id), store.getListId(id));
        JSONObject item = findItem(snapshot, list, itemId);
        if (item == null) { schedule(context, id, null); return; }
        if ("toggle".equals(operation)) {
            schedule(context, id, item);
        } else if ("edit".equals(operation) || "delete".equals(operation) || "open".equals(operation)) {
            String destination = store.getListId(id);
            String linked = data(item).optString("linkedChecklistId");
            if ("open".equals(operation) && "checklist".equals(list.optString("kind")) && validId(linked)) {
                destination = linked;
            }
            if ("open".equals(operation)) itemId = null;
            Intent open = MainActivity.intent(context, store.getHouseholdId(id), destination, itemId, operation);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(open);
        }
    }

    public static void refreshAll(Context context) {
        int[] ids = AppWidgetManager.getInstance(context).getAppWidgetIds(
                new ComponentName(context, MyHomeWidgetProvider.class));
        for (int id : ids) { render(context, id); schedule(context, id, null); }
    }

    /** Repaint cached content immediately after an appearance change, without a network job. */
    public static void renderAll(Context context) {
        for (int id : AppWidgetManager.getInstance(context).getAppWidgetIds(
                new ComponentName(context, MyHomeWidgetProvider.class))) render(context, id);
    }

    /** Keep a collection factory on its captured palette while a new theme is being bound. */
    static Context widgetThemeContext(Context context, boolean dark) {
        Context themed = AppAppearance.themedContext(context);
        int night = dark ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO;
        if ((themed.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == night)
            return themed;
        Configuration config = new Configuration(themed.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) | night;
        return context.createConfigurationContext(config);
    }

    static boolean isBusy(int id) { return BUSY.containsKey(id); }

    private static boolean installed(Context context, int id) {
        if (id <= 0 || id > Integer.MAX_VALUE - JOB_BASE) return false;
        for (int existing : AppWidgetManager.getInstance(context).getAppWidgetIds(
                new ComponentName(context, MyHomeWidgetProvider.class))) if (existing == id) return true;
        return false;
    }

    static boolean validId(String value) {
        return value != null && value.length() > 0 && value.length() <= 128 &&
                value.matches("[A-Za-z0-9_-]+");
    }

    static JSONObject data(JSONObject entity) {
        JSONObject value = entity == null ? null : entity.optJSONObject("data");
        return value == null ? new JSONObject() : value;
    }

    static JSONObject findList(JSONObject snapshot, String householdId, String listId) {
        if (snapshot == null || !validId(householdId) || !validId(listId) ||
                snapshot.optJSONObject("user") == null) return null;
        JSONObject household = snapshot.optJSONObject("household");
        if (household == null || !householdId.equals(household.optString("id"))) return null;
        JSONArray entities = snapshot.optJSONArray("entities");
        if (entities == null) return null;
        for (int i = 0; i < entities.length(); i++) {
            JSONObject entity = entities.optJSONObject(i);
            if (entity == null || !householdId.equals(entity.optString("householdId")) ||
                    !listId.equals(entity.optString("id"))) continue;
            String kind = entity.optString("kind");
            if ("shopping".equals(kind) || "checklist".equals(kind)) return entity;
        }
        return null;
    }

    static JSONObject findItem(JSONObject snapshot, JSONObject list, String itemId) {
        if (list == null || !validId(itemId)) return null;
        for (JSONObject item : orderedItems(snapshot, list)) {
            if (itemId.equals(item.optString("id"))) return item;
        }
        return null;
    }

    static List<JSONObject> orderedItems(JSONObject snapshot, JSONObject list) {
        List<JSONObject> items = new ArrayList<>();
        if (snapshot == null || list == null) return items;
        JSONArray entities = snapshot.optJSONArray("entities");
        if (entities == null) return items;
        String householdId = list.optString("householdId"), listId = list.optString("id");
        for (int i = 0; i < entities.length(); i++) {
            JSONObject item = entities.optJSONObject(i);
            if (item != null && "item".equals(item.optString("kind")) &&
                    householdId.equals(item.optString("householdId")) &&
                    listId.equals(data(item).optString("listId"))) items.add(item);
        }
        List<JSONObject> ordered = new ArrayList<>();
        Set<String> included = new HashSet<>();
        if ("checklist".equals(list.optString("kind"))) {
            Map<String, JSONObject> byId = new HashMap<>();
            for (JSONObject item : items) byId.put(item.optString("id"), item);
            JSONArray order = data(list).optJSONArray("itemOrder");
            if (order != null) for (int i = 0; i < order.length(); i++) {
                String id = order.optString(i);
                if (byId.containsKey(id) && included.add(id)) ordered.add(byId.get(id));
            }
        }
        for (JSONObject item : items) if (included.add(item.optString("id"))) ordered.add(item);
        List<JSONObject> result = new ArrayList<>();
        for (JSONObject item : ordered) if (!data(item).optBoolean("checked")) result.add(item);
        for (JSONObject item : ordered) if (data(item).optBoolean("checked")) result.add(item);
        return result;
    }

    static int icon(JSONObject list) {
        switch (data(list).optString("icon")) {
            case "home": return R.drawable.widget_icon_home;
            case "carrot": return R.drawable.widget_icon_carrot;
            case "plane": return R.drawable.widget_icon_plane;
            case "check": return R.drawable.widget_icon_check;
            case "heart": return R.drawable.widget_icon_heart;
            case "bag": return R.drawable.widget_icon_bag;
            case "basket": return R.drawable.widget_icon_basket;
            default: return list != null && "checklist".equals(list.optString("kind"))
                    ? R.drawable.widget_icon_check : R.drawable.widget_icon_basket;
        }
    }

    private static PendingIntent broadcast(Context context, int id, String action) {
        Intent intent = new Intent(context, MyHomeWidgetProvider.class).setAction(action)
                .setData(Uri.parse("myhomeia-widget://" + id + "/" + action))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        return PendingIntent.getBroadcast(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static PendingIntent itemActions(Context context, int id) {
        Intent intent = new Intent(context, WidgetActionActivity.class).setAction(ACTION_ITEM)
                .setData(Uri.parse("myhomeia-widget://" + id + "/items/action"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_NO_ANIMATION);
        return PendingIntent.getActivity(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
    }

    private static PendingIntent web(Context context, int id, String householdId, String listId, String action) {
        Intent intent = MainActivity.intent(context, householdId, listId, null, action);
        intent.setData(Uri.parse("myhomeia-widget://" + id + "/web/" + action));
        return PendingIntent.getActivity(context, id, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void render(Context context, int id) {
        WidgetStore store = new WidgetStore(context);
        String householdId = store.getHouseholdId(id), listId = store.getListId(id);
        JSONObject snapshot = store.getSnapshot(id);
        JSONObject list = findList(snapshot, householdId, listId);
        boolean available = list != null, busy = isBusy(id);
        boolean shopping = available && "shopping".equals(list.optString("kind"));
        String mode = AppAppearance.getMode(context);
        boolean forced = !"system".equals(mode), dark = AppAppearance.isDark(context);
        RemoteViews views = new RemoteViews(context.getPackageName(),
                forced ? R.layout.widget_list_forced : R.layout.widget_list);
        if (forced) applyForcedAppearance(views, widgetThemeContext(context, dark), dark);
        views.setTextViewText(R.id.widget_title, available ? data(list).optString("name", "Ma liste") : "MyHomeIA");
        views.setImageViewResource(R.id.widget_icon, icon(list));
        views.setOnClickPendingIntent(R.id.widget_header, web(context, id, householdId, listId, "open"));
        Intent configure = new Intent(context, WidgetConfigureActivity.class)
                .setData(Uri.parse("myhomeia-widget://" + id + "/configure"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent configureIntent = PendingIntent.getActivity(context, id, configure,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_configure, configureIntent);
        views.setOnClickPendingIntent(R.id.widget_refresh, broadcast(context, id, ACTION_REFRESH));
        views.setOnClickPendingIntent(R.id.widget_add, web(context, id, householdId, listId, "add"));
        views.setOnClickPendingIntent(R.id.widget_scan, web(context, id, householdId, listId, "scan"));
        views.setOnClickPendingIntent(R.id.widget_clear, web(context, id, householdId, listId, "clearCompleted"));
        views.setViewVisibility(R.id.widget_actions, available ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_scan, shopping ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_progress, busy && !forced ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_progress_light, busy && forced && !dark ? View.VISIBLE : View.GONE);
        views.setViewVisibility(R.id.widget_progress_dark, busy && forced && dark ? View.VISIBLE : View.GONE);
        List<JSONObject> items = orderedItems(snapshot, list);
        int pending = 0;
        for (JSONObject item : items) if (!data(item).optBoolean("checked")) pending++;
        views.setTextViewText(R.id.widget_count, available ? pending + (shopping ? " à acheter" : " à faire") : "");
        views.setViewVisibility(R.id.widget_count, available ? View.VISIBLE : View.GONE);
        boolean clear = available && (shopping || !data(list).optBoolean("reusable")) && items.size() > pending;
        views.setViewVisibility(R.id.widget_clear, clear ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_clear, "Supprimer les terminés (" + (items.size() - pending) + ")");
        String error = store.getError(id);
        String status;
        if (busy) status = "Actualisation…";
        else if (error != null && !error.isEmpty()) {
            status = error;
            long updated = store.getUpdatedAt(id);
            if (available && updated > 0) status += " Dernière mise à jour : " +
                    DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(new Date(updated)) + ".";
        }
        else if (!available) status = "Touchez ⚙ pour choisir une liste ou vous connecter.";
        else {
            long fetchedAt = store.getUpdatedAt(id);
            status = fetchedAt > 0 ? "Mis à jour à " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(fetchedAt)) : "";
        }
        views.setTextViewText(R.id.widget_status, status);
        views.setTextViewText(R.id.widget_status_error, status);
        boolean showError = !busy && error != null && !error.isEmpty();
        views.setViewVisibility(R.id.widget_status, showError ? View.GONE : View.VISIBLE);
        views.setViewVisibility(R.id.widget_status_error, showError ? View.VISIBLE : View.GONE);
        views.setTextViewText(R.id.widget_empty, available ? "Aucun élément dans cette liste." : "Connectez-vous puis choisissez votre liste.");
        views.setOnClickPendingIntent(R.id.widget_empty, available
                ? web(context, id, householdId, listId, "add") : configureIntent);
        Intent service = new Intent(context, WidgetItemsService.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .putExtra("widgetThemeForced", forced).putExtra("widgetThemeDark", dark)
                .setData(Uri.parse("myhomeia-widget://" + id + "/items/" + mode + (dark ? "/dark" : "/light")));
        views.setRemoteAdapter(R.id.widget_items, service);
        views.setEmptyView(R.id.widget_items, R.id.widget_empty);
        views.setPendingIntentTemplate(R.id.widget_items, itemActions(context, id));
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        manager.updateAppWidget(id, views);
        manager.notifyAppWidgetViewDataChanged(id, R.id.widget_items);
    }

    private static void applyForcedAppearance(RemoteViews views, Context themed, boolean dark) {
        int touch = dark ? R.drawable.widget_touch_dark : R.drawable.widget_touch_light;
        int add = dark ? R.drawable.widget_add_background_dark : R.drawable.widget_add_background_light;
        views.setInt(R.id.widget_root, "setBackgroundResource",
                dark ? R.drawable.widget_background_dark : R.drawable.widget_background_light);
        for (int id : new int[]{R.id.widget_header, R.id.widget_refresh, R.id.widget_configure, R.id.widget_clear})
            views.setInt(id, "setBackgroundResource", touch);
        views.setInt(R.id.widget_add, "setBackgroundResource", add);
        views.setInt(R.id.widget_scan, "setBackgroundResource", add);
        views.setTextColor(R.id.widget_title, themed.getColor(R.color.widget_text));
        for (int id : new int[]{R.id.widget_count, R.id.widget_empty, R.id.widget_status})
            views.setTextColor(id, themed.getColor(R.color.widget_muted));
        views.setTextColor(R.id.widget_add, themed.getColor(R.color.widget_accent));
        views.setTextColor(R.id.widget_clear, themed.getColor(R.color.widget_danger));
        views.setTextColor(R.id.widget_status_error, themed.getColor(R.color.widget_danger));
        // ImageView.setColorFilter(int) is explicitly annotated @RemotableViewMethod in Android.
        for (int id : new int[]{R.id.widget_icon, R.id.widget_refresh, R.id.widget_configure, R.id.widget_scan})
            views.setInt(id, "setColorFilter", themed.getColor(R.color.widget_accent));
    }

    private static void schedule(Context context, int id, JSONObject toggleItem) {
        if (!installed(context, id) || BUSY.putIfAbsent(id, true) != null) return;
        WidgetStore store = new WidgetStore(context);
        String origin = store.getOrigin(), householdId = store.getHouseholdId(id), listId = store.getListId(id);
        if (origin == null || origin.isEmpty() || !validId(householdId) || !validId(listId)) {
            BUSY.remove(id); render(context, id); return;
        }
        PersistableBundle extras = new PersistableBundle();
        extras.putInt("widgetId", id);
        extras.putString("origin", origin);
        extras.putString("householdId", householdId);
        extras.putString("listId", listId);
        if (toggleItem != null) {
            JSONObject cached = store.getSnapshot(id);
            JSONObject user = cached == null ? null : cached.optJSONObject("user");
            if (user == null) { BUSY.remove(id); render(context, id); return; }
            extras.putString("userId", user.optString("id"));
            extras.putString("itemId", toggleItem.optString("id"));
            extras.putString("revision", toggleItem.optString("revision"));
            extras.putBoolean("checked", !data(toggleItem).optBoolean("checked"));
        }
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        try {
            JobInfo job = new JobInfo.Builder(JOB_BASE + id,
                    new ComponentName(context, RefreshJobService.class))
                    .setOverrideDeadline(0).setExtras(extras).build();
            if (scheduler == null || scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS)
                throw new IllegalStateException("Job not scheduled");
            render(context, id);
        } catch (RuntimeException ignored) {
            BUSY.remove(id);
            store.setError(id, "Actualisation indisponible. Touchez ↻ pour réessayer.");
            render(context, id);
        }
    }

    /** Network work runs outside the broadcast receiver and never blocks the launcher. */
    public static class RefreshJobService extends JobService {
        private static final ExecutorService WORKERS = Executors.newFixedThreadPool(3);
        private final ConcurrentHashMap<Integer, AtomicBoolean> cancelled = new ConcurrentHashMap<>();

        @Override public boolean onStartJob(JobParameters parameters) {
            AtomicBoolean stop = new AtomicBoolean(false);
            cancelled.put(parameters.getJobId(), stop);
            WORKERS.execute(() -> execute(parameters, stop));
            return true;
        }

        @Override public boolean onStopJob(JobParameters parameters) {
            AtomicBoolean stop = cancelled.remove(parameters.getJobId());
            if (stop != null) stop.set(true);
            int id = parameters.getExtras().getInt("widgetId", -1);
            BUSY.remove(id);
            if (installed(this, id)) render(this, id);
            // A write is never replayed automatically after an interrupted HTTP request.
            return false;
        }

        private void execute(JobParameters parameters, AtomicBoolean stop) {
            PersistableBundle extras = parameters.getExtras();
            int id = extras.getInt("widgetId", -1);
            String origin = extras.getString("origin", ""), householdId = extras.getString("householdId", ""),
                    listId = extras.getString("listId", "");
            WidgetStore store = new WidgetStore(this);
            String cookie = cookie(origin);
            boolean mutated = false;
            try {
                if (!current(store, id, origin, householdId, listId) || stop.get()) return;
                BUSY.put(id, true);
                render(this, id);
                ServerClient client = new ServerClient(this, origin);
                JSONObject snapshot = client.snapshot(householdId);
                JSONObject list = findList(snapshot, householdId, listId);
                if (list == null) {
                    if (!stop.get() && cookie.equals(cookie(origin)) && current(store, id, origin, householdId, listId)) {
                        store.clearSnapshot(id);
                        store.setError(id, "Liste supprimée ou inaccessible. Touchez ⚙ pour la remplacer.");
                    }
                    return;
                }
                String itemId = extras.getString("itemId", "");
                if (!itemId.isEmpty()) {
                    JSONObject user = snapshot.optJSONObject("user");
                    if (user == null || !extras.getString("userId", "").equals(user.optString("id"))) {
                        if (!stop.get() && cookie.equals(cookie(origin)) && current(store, id, origin, householdId, listId)) {
                            store.clearSnapshot(id);
                            store.setError(id, "Compte modifié. Actualisez avant de recommencer.");
                        }
                        return;
                    }
                    JSONObject item = findItem(snapshot, list, itemId);
                    if (item == null || !extras.getString("revision", "").equals(item.optString("revision"))) {
                        if (!stop.get() && cookie.equals(cookie(origin)) && current(store, id, origin, householdId, listId)) {
                            store.saveSnapshot(id, snapshot, origin, cookie);
                            store.setError(id, "Élément modifié ailleurs. Vérifiez la liste puis réessayez.");
                        }
                        return;
                    }
                    if (stop.get() || !cookie.equals(cookie(origin)) || !current(store, id, origin, householdId, listId)) return;
                    JSONObject itemData = new JSONObject(data(item).toString());
                    itemData.put("checked", extras.getBoolean("checked"));
                    snapshot = client.command(new JSONObject().put("action", "save").put("householdId", householdId)
                            .put("kind", "item").put("id", itemId).put("data", itemData)
                            .put("expectedRevision", extras.getString("revision", "")));
                    mutated = true;
                    if (findList(snapshot, householdId, listId) == null)
                        throw new IOException("La liste n’est plus accessible.");
                }
                if (stop.get() || !cookie.equals(cookie(origin)) || !current(store, id, origin, householdId, listId)) return;
                store.saveSnapshot(id, snapshot, origin, cookie);
                store.setError(id, "");
            } catch (IOException | JSONException | IllegalArgumentException exception) {
                if (!stop.get() && cookie.equals(cookie(origin)) && current(store, id, origin, householdId, listId)) {
                    int status = exception instanceof ServerClient.ApiException
                            ? ((ServerClient.ApiException) exception).getStatus() : 0;
                    if (status == 401 || status == 403) {
                        store.clearCaches();
                        store.setError(id, "Connexion nécessaire. Ouvrez MyHomeIA pour vous connecter.");
                        // Remove previously rendered data from every widget immediately.
                        for (int widgetId : AppWidgetManager.getInstance(this).getAppWidgetIds(
                                new ComponentName(this, MyHomeWidgetProvider.class))) render(this, widgetId);
                    } else if (status == 404) {
                        store.clearSnapshot(id);
                        store.setError(id, "Liste supprimée ou inaccessible. Touchez ⚙ pour la remplacer.");
                    } else if (status == 409) {
                        store.setError(id, "Élément modifié ailleurs. Actualisez puis réessayez.");
                    } else {
                        store.setError(id, exception instanceof JSONException
                                ? "Réponse du serveur invalide. Actualisez pour réessayer."
                                : "Connexion impossible ou liste modifiée. Les données affichées peuvent être anciennes.");
                    }
                }
            } finally {
                if (cancelled.remove(parameters.getJobId(), stop)) BUSY.remove(id);
                if (!stop.get()) {
                    if (installed(this, id)) render(this, id);
                    if (mutated && cookie.equals(cookie(origin)) && current(store, id, origin, householdId, listId)) {
                        for (int otherId : AppWidgetManager.getInstance(this).getAppWidgetIds(
                                new ComponentName(this, MyHomeWidgetProvider.class))) {
                            if (otherId != id && householdId.equals(store.getHouseholdId(otherId))) schedule(this, otherId, null);
                        }
                    }
                    jobFinished(parameters, false);
                }
            }
        }

        private boolean current(WidgetStore store, int id, String origin, String householdId, String listId) {
            return installed(this, id) && origin.equals(store.getOrigin()) &&
                    householdId.equals(store.getHouseholdId(id)) && listId.equals(store.getListId(id));
        }

        private static String cookie(String origin) {
            return ServerClient.sessionCookie(origin);
        }
    }
}
