package fr.myhome.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.app.job.JobScheduler;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.RemoteViews;
import android.widget.TextView;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowAppWidgetManager;
import org.robolectric.util.ReflectionHelpers;

import java.util.Map;

/** Exercises real launcher RemoteViews, including their activity PendingIntents. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class WidgetQuickScanTest {
    private static final String NAS = "https://maison.example.test";
    private Application application;
    private WidgetStore store;
    private ShadowAppWidgetManager launcher;

    @Before public void resetWidget() {
        application = RuntimeEnvironment.getApplication();
        application.getSharedPreferences("myhome_widgets", Context.MODE_PRIVATE).edit().clear().commit();
        application.getSharedPreferences("myhome_appearance", Context.MODE_PRIVATE).edit().clear().commit();
        CookieManager.getInstance().removeAllCookies(null);
        RuntimeEnvironment.setQualifiers("+notnight");
        store = new WidgetStore(application);
        store.setOrigin(NAS);
        signIn();
        launcher = Shadows.shadowOf(AppWidgetManager.getInstance(application));
    }

    @Test public void eachShortcutRetainsItsOwnTargetAfterAnotherWidgetIsReconfigured() {
        int first = configured("house-a", "list-a", "Courses maison");
        int second = configured("house-b", "list-b", "Courses vacances");
        assertScan(click(first, R.id.quick_scan_action), "house-a", "list-a");
        assertScan(click(second, R.id.quick_scan_action), "house-b", "list-b");
        assertConfiguration(click(first, R.id.quick_scan_settings), first);
        assertConfiguration(click(second, R.id.quick_scan_settings), second);

        store.saveWidget(first, "house-c", "list-c", "Autre liste");
        QuickScanWidgetProvider.render(application, first);
        assertScan(click(first, R.id.quick_scan_action), "house-c", "list-c");
        assertScan(click(second, R.id.quick_scan_action), "house-b", "list-b");
        assertEquals("Courses vacances", name(second));
        assertNull("The shortcut must not bind a list collection", launcher.getViewFor(second).findViewById(R.id.widget_items));
        assertNull("The shortcut needs no list snapshot", store.getSnapshot(first));
        assertTrue("Rendering a scan shortcut must never schedule a network refresh",
                application.getSystemService(JobScheduler.class).getAllPendingJobs().isEmpty());
    }

    @Test public void missingOrInvalidConfigurationOpensItsOwnConfigurationScreen() {
        int id = launcher.createWidget(QuickScanWidgetProvider.class, R.layout.quick_scan_widget);
        setHeight(id, 80);
        assertConfiguration(click(id, R.id.quick_scan_action), id);
        assertConfiguration(click(id, R.id.quick_scan_settings), id);
        store.saveWidget(id, "house-one", "invalid/list", "Aucun accès");
        QuickScanWidgetProvider.render(application, id);
        assertConfiguration(click(id, R.id.quick_scan_action), id);
        assertEquals(application.getString(R.string.quick_scan_choose_list), name(id));
        assertEquals(View.VISIBLE, launcher.getViewFor(id).findViewById(R.id.quick_scan_status).getVisibility());
    }

    @Test public void signingOutHidesTheListNameButRetainsTheScanTargetForLoginResume() {
        int id = configured("house-private", "list-private", "Liste privée");
        assertEquals("Liste privée", name(id));
        CookieManager.getInstance().removeAllCookies(null);
        QuickScanWidgetProvider.renderAll(application);
        View signedOut = launcher.getViewFor(id);
        assertEquals(application.getString(R.string.quick_scan_login_required), name(id));
        assertFalse(signedOut.findViewById(R.id.quick_scan_action).getContentDescription().toString().contains("Liste privée"));
        assertEquals(View.VISIBLE, signedOut.findViewById(R.id.quick_scan_status).getVisibility());
        assertScan(click(id, R.id.quick_scan_action), "house-private", "list-private");
        signIn();
        QuickScanWidgetProvider.renderAll(application);
        assertEquals("Liste privée", name(id));
        assertEquals(View.GONE, launcher.getViewFor(id).findViewById(R.id.quick_scan_status).getVisibility());
    }

    @Test public void deletingOneShortcutDoesNotRemoveAnotherWidgetConfiguration() {
        int first = configured("house-a", "list-a", "Première");
        int second = configured("house-b", "list-b", "Seconde");
        new QuickScanWidgetProvider().onDeleted(application, new int[] {first});
        assertEquals("", store.getListId(first));
        assertEquals("", store.getWidgetListName(first));
        assertEquals("list-b", store.getListId(second));
        assertEquals("Seconde", store.getWidgetListName(second));
    }

    @Test public void anotherSessionCannotReadThePreviousAccountsListName() {
        int id = configured("house-private", "list-private", "Liste privée");
        assertEquals("Liste privée", name(id));
        CookieManager.getInstance().setCookie(NAS, "myhome_session=" + "b".repeat(64));
        QuickScanWidgetProvider.renderAll(application);
        assertEquals("", store.getWidgetListName(id));
        assertFalse(name(id).contains("Liste privée"));
        assertFalse(launcher.getViewFor(id).findViewById(R.id.quick_scan_action)
                .getContentDescription().toString().contains("Liste privée"));
        assertScan(click(id, R.id.quick_scan_action), "house-private", "list-private");
    }

    @Test public void clearingCachesRepaintsQuickShortcutsThroughTheSharedWidgetEntryPoint() {
        int id = configured("house-private", "list-private", "Liste privée");
        assertEquals("Liste privée", name(id));
        store.clearCaches();
        assertFalse("A rejected session may still have a locally present cookie", ServerClient.sessionCookie(NAS).isEmpty());
        MyHomeWidgetProvider.renderAll(application);
        assertEquals("", store.getWidgetListName(id));
        assertFalse(name(id).contains("Liste privée"));
        assertFalse(launcher.getViewFor(id).findViewById(R.id.quick_scan_action)
                .getContentDescription().toString().contains("Liste privée"));
        assertScan(click(id, R.id.quick_scan_action), "house-private", "list-private");
    }

    @Test public void explicitAppearanceOverridesTheLauncherAndSystemModeClearsThoseOverrides() {
        assertNotEquals(R.layout.quick_scan_widget, R.layout.quick_scan_widget_forced);
        for (boolean deviceDark : new boolean[] {false, true}) {
            RuntimeEnvironment.setQualifiers(deviceDark ? "+night" : "+notnight");
            int id = configured("house-one", "list-one", "Courses");
            AppAppearance.saveMode(application, NAS, deviceDark ? "light" : "dark");
            QuickScanWidgetProvider.render(application, id);
            View forced = launcher.getViewFor(id);
            assertColors(forced, !deviceDark);
            launcher.reconstructWidgetViewAsIfPhoneWasRotated(id);
            assertColors(launcher.getViewFor(id), !deviceDark);
            AppAppearance.saveMode(application, NAS, "system");
            QuickScanWidgetProvider.render(application, id);
            View system = launcher.getViewFor(id);
            assertNotSame("A distinct alias must discard previously forced color setters", forced, system);
            assertColors(system, deviceDark);
        }
    }

    @Test public void originalSystemRemoteViewsFollowLauncherReinflationWithoutNetworkOrProviderWork() {
        AppAppearance.saveMode(application, NAS, "system");
        int id = configured("house-one", "list-one", "Courses");
        Map<Integer, ?> widgets = ReflectionHelpers.getField(launcher, "widgetInfos");
        RemoteViews original = ReflectionHelpers.getField(widgets.get(id), "lastRemoteViews");
        assertEquals(R.layout.quick_scan_widget, original.getLayoutId());
        assertColors(original.apply(application, new AppWidgetHostView(application)), false);
        RuntimeEnvironment.setQualifiers("+night");
        assertColors(original.apply(application, new AppWidgetHostView(application)), true);
        RuntimeEnvironment.setQualifiers("+notnight");
        assertColors(original.apply(application, new AppWidgetHostView(application)), false);
    }

    private int configured(String householdId, String listId, String name) {
        int id = launcher.createWidget(QuickScanWidgetProvider.class, R.layout.quick_scan_widget);
        setHeight(id, 80);
        store.saveWidget(id, householdId, listId, name);
        QuickScanWidgetProvider.render(application, id);
        return id;
    }

    private void setHeight(int id, int height) {
        Bundle options = new Bundle();
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, height);
        options.putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, height);
        AppWidgetManager.getInstance(application).updateAppWidgetOptions(id, options);
        QuickScanWidgetProvider.render(application, id);
    }

    private void signIn() {
        CookieManager.getInstance().setCookie(NAS, "myhome_session=" + "a".repeat(64));
    }

    private String name(int id) {
        return ((TextView) launcher.getViewFor(id).findViewById(R.id.quick_scan_list)).getText().toString();
    }

    private Intent click(int id, int viewId) {
        assertTrue("The launcher action must be clickable", launcher.getViewFor(id).findViewById(viewId).performClick());
        Intent next = Shadows.shadowOf(application).getNextStartedActivity();
        assertTrue("A widget action must start an activity directly", next != null);
        return next;
    }

    private void assertScan(Intent intent, String householdId, String listId) {
        assertEquals(MainActivity.class.getName(), intent.getComponent().getClassName());
        assertEquals(householdId, intent.getStringExtra("householdId"));
        assertEquals(listId, intent.getStringExtra("listId"));
        assertEquals("scan", intent.getStringExtra("action"));
        assertNull(intent.getStringExtra("itemId"));
    }

    private void assertConfiguration(Intent intent, int widgetId) {
        assertEquals(WidgetConfigureActivity.class.getName(), intent.getComponent().getClassName());
        assertEquals(widgetId, intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1));
    }

    private void assertColors(View root, boolean dark) {
        assertEquals(dark ? Color.rgb(236, 233, 243) : Color.rgb(48, 48, 62),
                ((TextView) root.findViewById(R.id.quick_scan_title)).getCurrentTextColor());
        assertEquals(dark ? Color.rgb(187, 180, 199) : Color.rgb(109, 102, 121),
                ((TextView) root.findViewById(R.id.quick_scan_list)).getCurrentTextColor());
        assertEquals(dark ? Color.rgb(34, 31, 42) : Color.WHITE,
                ((GradientDrawable) root.getBackground()).getColor().getDefaultColor());
    }
}
