package fr.myhome.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotSame;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.appwidget.AppWidgetHostView;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.webkit.CookieManager;
import android.widget.FrameLayout;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowAppWidgetManager;
import org.robolectric.util.ReflectionHelpers;

import java.util.Map;

/** Applies the production RemoteViews against real Android layouts and color resources. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class WidgetAppearanceTest {
    private static final String NAS = "https://maison.example.test";
    private Application application;
    private ShadowAppWidgetManager launcher;

    @Before public void resetWidget() {
        application = RuntimeEnvironment.getApplication();
        application.getSharedPreferences("myhome_widgets", Context.MODE_PRIVATE).edit().clear().commit();
        application.getSharedPreferences("myhome_appearance", Context.MODE_PRIVATE).edit().clear().commit();
        CookieManager.getInstance().removeAllCookies(null);
        RuntimeEnvironment.setQualifiers("+notnight");
        new WidgetStore(application).setOrigin(NAS);
        launcher = Shadows.shadowOf(AppWidgetManager.getInstance(application));
    }

    @Test public void forcedWidgetKeepsItsPaletteAgainstOppositeLauncherMode() {
        for (boolean deviceDark : new boolean[] {false, true}) {
            setDeviceDark(deviceDark);
            int id = launcher.createWidget(MyHomeWidgetProvider.class, R.layout.widget_list);
            AppAppearance.saveMode(application, NAS, deviceDark ? "light" : "dark");
            MyHomeWidgetProvider.render(application, id);
            assertWidgetColors(launcher.getViewFor(id), !deviceDark);
            launcher.reconstructWidgetViewAsIfPhoneWasRotated(id);
            assertWidgetColors(launcher.getViewFor(id), !deviceDark);
        }
    }

    @Test public void switchingFromForcedToSystemReinflatesAliasAndClearsForcedColors() {
        assertNotEquals(R.layout.widget_list, R.layout.widget_list_forced);
        assertNotEquals(R.layout.widget_item, R.layout.widget_item_forced);
        for (boolean deviceDark : new boolean[] {false, true}) {
            setDeviceDark(deviceDark);
            int id = launcher.createWidget(MyHomeWidgetProvider.class, R.layout.widget_list);
            AppAppearance.saveMode(application, NAS, deviceDark ? "light" : "dark");
            MyHomeWidgetProvider.render(application, id);
            View forced = launcher.getViewFor(id);
            assertWidgetColors(forced, !deviceDark);
            AppAppearance.saveMode(application, NAS, "system");
            MyHomeWidgetProvider.render(application, id);
            View system = launcher.getViewFor(id);
            assertNotSame("A different layout alias must prevent reapplying over forced setters", forced, system);
            assertWidgetColors(system, deviceDark);
        }
    }

    @Test public void systemWidgetFollowsLauncherReinflationWithoutAnotherProviderRender() {
        AppAppearance.saveMode(application, NAS, "system");
        int id = launcher.createWidget(MyHomeWidgetProvider.class, R.layout.widget_list);
        // Retain the actual production RemoteViews before changing configuration: an Application
        // callback may render a newer instance, which must not accidentally satisfy this test.
        Map<Integer, ?> widgets = ReflectionHelpers.getField(launcher, "widgetInfos");
        RemoteViews original = ReflectionHelpers.getField(widgets.get(id), "lastRemoteViews");
        assertEquals(R.layout.widget_list, original.getLayoutId());
        assertWidgetColors(original.apply(application, new AppWidgetHostView(application)), false);
        setDeviceDark(true);
        assertWidgetColors(original.apply(application, new AppWidgetHostView(application)), true);
        setDeviceDark(false);
        assertWidgetColors(original.apply(application, new AppWidgetHostView(application)), false);
    }

    @Test public void collectionRowsApplyBothForcedPalettesAndKeepSystemResourcesDynamic() throws Exception {
        int id = 51;
        cacheListWithTwoItems(id);
        WidgetItemsService service = Robolectric.buildService(WidgetItemsService.class).create().get();
        try {
            for (boolean deviceDark : new boolean[] {false, true}) {
                setDeviceDark(deviceDark);
                RemoteViewsService.RemoteViewsFactory forced = factory(service, id, true, !deviceDark);
                forced.onCreate();
                try {
                    assertEquals(2, forced.getCount());
                    RemoteViews row = forced.getViewAt(0);
                    assertEquals(R.layout.widget_item_forced, row.getLayoutId());
                    assertRowColors(row.apply(application, new FrameLayout(application)), !deviceDark, false);
                    RemoteViews completed = forced.getViewAt(1);
                    assertRowColors(completed.apply(application, new FrameLayout(application)), !deviceDark, true);
                } finally { forced.onDestroy(); }
            }
            setDeviceDark(false);
            RemoteViewsService.RemoteViewsFactory system = factory(service, id, false, false);
            system.onCreate();
            try {
                RemoteViews row = system.getViewAt(0);
                assertEquals(R.layout.widget_item, row.getLayoutId());
                assertRowColors(row.apply(application, new FrameLayout(application)), false, false);
                setDeviceDark(true);
                assertRowColors(row.apply(application, new FrameLayout(application)), true, false);
            } finally { system.onDestroy(); }
        } finally { service.onDestroy(); }
    }

    private RemoteViewsService.RemoteViewsFactory factory(WidgetItemsService service, int id, boolean forced, boolean dark) {
        return service.onGetViewFactory(new Intent(application, WidgetItemsService.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                .putExtra("widgetThemeForced", forced).putExtra("widgetThemeDark", dark));
    }

    private void cacheListWithTwoItems(int id) throws Exception {
        CookieManager.getInstance().setCookie(NAS, "myhome_session=" + "a".repeat(64));
        WidgetStore store = new WidgetStore(application);
        store.saveWidget(id, "household-one", "shopping-one");
        JSONArray entities = new JSONArray()
                .put(new JSONObject().put("id", "shopping-one").put("householdId", "household-one")
                        .put("kind", "shopping").put("data", new JSONObject().put("name", "Courses")))
                .put(new JSONObject().put("id", "item-pending").put("householdId", "household-one")
                        .put("kind", "item").put("data", new JSONObject().put("listId", "shopping-one")
                                .put("name", "Pommes").put("comment", "Bien rouges").put("quantity", 2)))
                .put(new JSONObject().put("id", "item-completed").put("householdId", "household-one")
                        .put("kind", "item").put("data", new JSONObject().put("listId", "shopping-one")
                                .put("name", "Pain").put("comment", "Complet").put("checked", true)));
        JSONObject snapshot = new JSONObject().put("user", new JSONObject().put("id", "user-one"))
                .put("household", new JSONObject().put("id", "household-one").put("name", "Maison"))
                .put("entities", entities);
        store.saveSnapshot(id, snapshot, NAS, ServerClient.sessionCookie(NAS));
        assertTrue("Fixture must use the real session-bound widget cache", store.getSnapshot(id) != null);
    }

    private void assertWidgetColors(View root, boolean dark) {
        assertEquals(dark ? Color.rgb(236, 233, 243) : Color.rgb(48, 48, 62),
                ((TextView) root.findViewById(R.id.widget_title)).getCurrentTextColor());
        assertEquals(dark ? Color.rgb(34, 31, 42) : Color.WHITE,
                ((GradientDrawable) root.getBackground()).getColor().getDefaultColor());
    }

    private void assertRowColors(View row, boolean dark, boolean checked) {
        int nameColor = checked ? (dark ? Color.rgb(170, 161, 185) : Color.rgb(116, 107, 133))
                : (dark ? Color.rgb(236, 233, 243) : Color.rgb(48, 48, 62));
        assertEquals(nameColor, ((TextView) row.findViewById(R.id.widget_item_name)).getCurrentTextColor());
        assertEquals(dark ? Color.rgb(187, 180, 199) : Color.rgb(109, 102, 121),
                ((TextView) row.findViewById(R.id.widget_item_note)).getCurrentTextColor());
    }

    private void setDeviceDark(boolean dark) {
        RuntimeEnvironment.setQualifiers(dark ? "+night" : "+notnight");
    }
}
