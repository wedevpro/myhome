package fr.myhome.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.view.View;
import android.widget.RemoteViews;

/** A scan shortcut only: no list items, collection service, or background network work. */
public final class QuickScanWidgetProvider extends AppWidgetProvider {
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, id);
    }

    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id,
            android.os.Bundle options) {
        render(context, id);
    }

    @Override public void onDeleted(Context context, int[] ids) {
        WidgetStore store = new WidgetStore(context);
        for (int id : ids) store.removeWidget(id);
    }

    /** Called with the list widgets when the account, server, or appearance changes. */
    public static void renderAll(Context context) {
        for (int id : AppWidgetManager.getInstance(context).getAppWidgetIds(
                new ComponentName(context, QuickScanWidgetProvider.class))) render(context, id);
    }

    public static void render(Context context, int id) {
        WidgetStore store = new WidgetStore(context);
        String householdId = store.getHouseholdId(id), listId = store.getListId(id);
        boolean configured = !store.getOrigin().isEmpty() && MyHomeWidgetProvider.validId(householdId)
                && MyHomeWidgetProvider.validId(listId);
        boolean signedIn = !ServerClient.sessionCookie(store.getOrigin()).isEmpty();
        String name = store.getWidgetListName(id);
        if (name == null || name.trim().isEmpty()) name = context.getString(R.string.quick_scan_default_list);

        boolean forced = !"system".equals(AppAppearance.getMode(context));
        boolean dark = AppAppearance.isDark(context);
        RemoteViews views = new RemoteViews(context.getPackageName(),
                forced ? R.layout.quick_scan_widget_forced : R.layout.quick_scan_widget);
        if (forced) applyForcedAppearance(views, MyHomeWidgetProvider.widgetThemeContext(context, dark), dark);
        views.setTextViewText(R.id.quick_scan_title, context.getString(R.string.quick_scan_action_label));
        views.setTextViewText(R.id.quick_scan_list,
                !configured ? context.getString(R.string.quick_scan_choose_list)
                        : signedIn ? name : context.getString(R.string.quick_scan_login_required));
        views.setTextViewText(R.id.quick_scan_status, context.getString(configured
                ? R.string.quick_scan_login_hint : R.string.quick_scan_setup_hint));
        int height = AppWidgetManager.getInstance(context).getAppWidgetOptions(id)
                .getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 48);
        views.setViewVisibility(R.id.quick_scan_status,
                height >= 72 && !(configured && signedIn) ? View.VISIBLE : View.GONE);

        Intent configure = new Intent(context, WidgetConfigureActivity.class)
                .setData(Uri.parse("myhome-widget://" + id + "/quick-scan/configure"))
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent configureIntent = PendingIntent.getActivity(context, id, configure,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.quick_scan_settings, configureIntent);

        PendingIntent scanIntent = configureIntent;
        if (configured) {
            Intent scan = MainActivity.intent(context, householdId, listId, null, "scan")
                    .setData(Uri.parse("myhome-widget://" + id + "/quick-scan/scan"));
            scanIntent = PendingIntent.getActivity(context, id, scan,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        views.setOnClickPendingIntent(R.id.quick_scan_action, scanIntent);
        views.setContentDescription(R.id.quick_scan_action, configured && signedIn
                ? context.getString(R.string.quick_scan_action_description, name)
                : context.getString(configured ? R.string.quick_scan_title : R.string.quick_scan_choose_list)
                        + ". " + context.getString(configured ? R.string.quick_scan_login_hint : R.string.quick_scan_setup_hint));
        AppWidgetManager.getInstance(context).updateAppWidget(id, views);
    }

    private static void applyForcedAppearance(RemoteViews views, Context themed, boolean dark) {
        views.setInt(R.id.quick_scan_root, "setBackgroundResource",
                dark ? R.drawable.widget_background_dark : R.drawable.widget_background_light);
        views.setInt(R.id.quick_scan_action, "setBackgroundResource",
                dark ? R.drawable.widget_add_background_dark : R.drawable.widget_add_background_light);
        views.setInt(R.id.quick_scan_settings, "setBackgroundResource",
                dark ? R.drawable.widget_touch_dark : R.drawable.widget_touch_light);
        views.setTextColor(R.id.quick_scan_title, themed.getColor(R.color.widget_text));
        views.setTextColor(R.id.quick_scan_list, themed.getColor(R.color.widget_muted));
        views.setTextColor(R.id.quick_scan_status, themed.getColor(R.color.widget_muted));
        for (int id : new int[] {R.id.quick_scan_icon, R.id.quick_scan_settings})
            views.setInt(id, "setColorFilter", themed.getColor(R.color.widget_accent));
    }
}
