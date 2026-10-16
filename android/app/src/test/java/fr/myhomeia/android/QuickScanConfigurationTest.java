package fr.myhomeia.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Application;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.ListAdapter;
import android.widget.Spinner;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;
import org.robolectric.shadows.ShadowAppWidgetManager;
import org.robolectric.util.ReflectionHelpers;

/** Exercises the real setup form and persistence, without depending on a running NAS. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class QuickScanConfigurationTest {
    private static final String NAS = "https://maison.example.test";
    private static final String HOUSEHOLD = "household-one";
    private static final int WIDGET_ID = 73;
    private Application application;
    private WidgetStore store;
    private ShadowAppWidgetManager launcher;

    @Before public void prepareSession() {
        application = RuntimeEnvironment.getApplication();
        application.getSharedPreferences("myhomeia_widgets", Context.MODE_PRIVATE).edit().clear().commit();
        application.getSharedPreferences("myhomeia_appearance", Context.MODE_PRIVATE).edit().clear().commit();
        CookieManager.getInstance().removeAllCookies(null);
        RuntimeEnvironment.setQualifiers("+notnight");
        store = new WidgetStore(application);
        store.setOrigin(NAS);
        CookieManager.getInstance().setCookie(NAS, "myhomeia_session=" + "a".repeat(64));
        launcher = Shadows.shadowOf(AppWidgetManager.getInstance(application));
    }

    @Test public void quickScanOffersOnlyThisHouseholdsShoppingListsAndRestoresById() throws Exception {
        store.saveWidget(WIDGET_ID, HOUSEHOLD, "shopping-two");
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(entities()));
            Spinner lists = activity.findViewById(R.id.setup_lists);
            assertEquals(3, lists.getAdapter().getCount());
            assertEquals("Courses", lists.getAdapter().getItem(0).toString());
            assertFalse(((ListAdapter) lists.getAdapter()).isEnabled(0));
            assertEquals("Cuisine", lists.getAdapter().getItem(1).toString());
            assertEquals("Cuisine", lists.getAdapter().getItem(2).toString());
            assertEquals("Duplicate labels must retain the saved list identity", 2, lists.getSelectedItemPosition());
            assertTrue(((Button) activity.findViewById(R.id.setup_save)).isEnabled());
            activity.findViewById(R.id.setup_save).performClick();
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            assertEquals("shopping-two", store.getListId(WIDGET_ID));
            assertEquals("Cuisine", store.getWidgetListName(WIDGET_ID));
        }
    }

    @Test public void ordinaryListWidgetKeepsChecklistChoicesRegardlessOfIntentExtras() throws Exception {
        store.saveWidget(WIDGET_ID, HOUSEHOLD, "checklist-one");
        try (ActivityController<WidgetConfigureActivity> controller = configuration(false)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(entities()));
            Spinner lists = activity.findViewById(R.id.setup_lists);
            assertEquals(5, lists.getAdapter().getCount());
            assertEquals("Checklists", lists.getAdapter().getItem(3).toString());
            assertFalse(((ListAdapter) lists.getAdapter()).isEnabled(3));
            assertEquals("Valise", lists.getSelectedItem().toString());
            activity.findViewById(R.id.setup_save).performClick();
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            assertEquals("checklist-one", store.getListId(WIDGET_ID));
            assertTrue("Existing list widgets must retain their normal content cache", store.getSnapshot(WIDGET_ID) != null);
        }
    }

    @Test public void checklistOnlyHouseholdCannotConfigureQuickScanOrSelectAHeading() throws Exception {
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(new JSONArray().put(list("checklist-one", HOUSEHOLD, "checklist", "Valise"))));
            Spinner lists = activity.findViewById(R.id.setup_lists);
            assertEquals(0, lists.getAdapter().getCount());
            assertFalse(lists.isEnabled());
            assertFalse(((Button) activity.findViewById(R.id.setup_save)).isEnabled());
            ReflectionHelpers.callInstanceMethod(activity, "finishConfiguration");
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("", store.getListId(WIDGET_ID));
        }
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(entities()));
            Spinner lists = activity.findViewById(R.id.setup_lists);
            lists.setSelection(0); // A defensive guard is needed even for programmatic selection.
            ReflectionHelpers.callInstanceMethod(activity, "finishConfiguration");
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("", store.getListId(WIDGET_ID));
        }
    }

    @Test public void cancellingKeepsThePreviouslyConfiguredTarget() throws Exception {
        store.saveWidget(WIDGET_ID, HOUSEHOLD, "shopping-two");
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(entities()));
            ((Spinner) activity.findViewById(R.id.setup_lists)).setSelection(1);
            activity.findViewById(R.id.setup_cancel).performClick();
            assertTrue(activity.isFinishing());
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("shopping-two", store.getListId(WIDGET_ID));
        }
    }

    @Test public void quickScanPersistsOnlyItsDestinationAndSessionBoundName() throws Exception {
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            JSONObject result = snapshot(entities().put(new JSONObject().put("id", "item-private")
                    .put("householdId", HOUSEHOLD).put("kind", "item")
                    .put("data", new JSONObject().put("listId", "shopping-one").put("name", "Produit privé"))));
            apply(activity, result);
            activity.findViewById(R.id.setup_save).performClick();
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            assertEquals(HOUSEHOLD, store.getHouseholdId(WIDGET_ID));
            assertEquals("shopping-one", store.getListId(WIDGET_ID));
            assertEquals("Cuisine", store.getWidgetListName(WIDGET_ID));
            assertNull("A scan shortcut must not cache the list or its private items", store.getSnapshot(WIDGET_ID));
            assertFalse(application.getSharedPreferences("myhomeia_widgets", Context.MODE_PRIVATE)
                    .contains("cache_" + WIDGET_ID));
            assertFalse(application.getSharedPreferences("myhomeia_widgets", Context.MODE_PRIVATE)
                    .getAll().toString().contains("Produit privé"));
            CookieManager.getInstance().removeAllCookies(null);
            assertEquals("The destination name must not remain visible after signing out", "", store.getWidgetListName(WIDGET_ID));
        }
    }

    @Test public void validationRejectsAListThatBecameAChecklistAfterItWasSelected() throws Exception {
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            JSONObject shopping = list("shopping-one", HOUSEHOLD, "shopping", "Courses");
            apply(activity, snapshot(new JSONArray().put(shopping)));
            shopping.put("kind", "checklist");
            ReflectionHelpers.callInstanceMethod(activity, "finishConfiguration");
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("", store.getListId(WIDGET_ID));
        }
    }

    @Test public void signingOutWhileChoosingAListCannotCommitTheOldSnapshot() throws Exception {
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            apply(activity, snapshot(entities()));
            CookieManager.getInstance().removeAllCookies(null);
            ReflectionHelpers.callInstanceMethod(activity, "finishConfiguration");
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("", store.getListId(WIDGET_ID));
            assertFalse(((Button) activity.findViewById(R.id.setup_save)).isEnabled());
        }
    }

    @Test public void responseForAnotherHouseholdCannotPopulateOrConfigureQuickScan() throws Exception {
        try (ActivityController<WidgetConfigureActivity> controller = configuration(true)) {
            WidgetConfigureActivity activity = controller.get();
            JSONObject result = snapshot(entities());
            result.getJSONObject("household").put("id", "household-other");
            apply(activity, result);
            assertFalse(((Button) activity.findViewById(R.id.setup_save)).isEnabled());
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertEquals("", store.getListId(WIDGET_ID));
        }
    }

    private ActivityController<WidgetConfigureActivity> configuration(boolean quickScan) {
        AppWidgetProviderInfo info = new AppWidgetProviderInfo();
        info.provider = new ComponentName(application,
                quickScan ? QuickScanWidgetProvider.class : MyHomeWidgetProvider.class);
        launcher.addBoundWidget(WIDGET_ID, info);
        Intent intent = new Intent(application, WidgetConfigureActivity.class)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, WIDGET_ID)
                // An intent extra must not override Android's actual bound provider.
                .putExtra("quickScan", !quickScan).putExtra("widgetType", quickScan ? "list" : "scan");
        ActivityController<WidgetConfigureActivity> controller = Robolectric.buildActivity(WidgetConfigureActivity.class, intent);
        // Robolectric keeps bound widgets per AppWidgetManager instance. The themed activity
        // has its own service, so bind it before onCreate performs the provider lookup.
        Shadows.shadowOf(AppWidgetManager.getInstance(controller.get())).addBoundWidget(WIDGET_ID, info);
        controller.create();
        ReflectionHelpers.setField(controller.get(), "selectedHousehold", HOUSEHOLD);
        return controller;
    }

    private void apply(WidgetConfigureActivity activity, JSONObject result) {
        activity.applyLists(result, HOUSEHOLD, NAS, ServerClient.sessionCookie(NAS));
    }

    private JSONArray entities() throws Exception {
        return new JSONArray()
                .put(list("checklist-one", HOUSEHOLD, "checklist", "Valise"))
                .put(list("shopping-one", HOUSEHOLD, "shopping", "Cuisine"))
                .put(list("shopping-other", "household-other", "shopping", "Autre foyer"))
                .put(list("invalid/id", HOUSEHOLD, "shopping", "ID invalide"))
                .put(list("shopping-two", HOUSEHOLD, "shopping", "Cuisine"))
                .put(list("note-one", HOUSEHOLD, "note", "Note"));
    }

    private JSONObject list(String id, String household, String kind, String name) throws Exception {
        return new JSONObject().put("id", id).put("householdId", household).put("kind", kind)
                .put("data", new JSONObject().put("name", name));
    }

    private JSONObject snapshot(JSONArray entities) throws Exception {
        return new JSONObject().put("user", new JSONObject().put("id", "user-one"))
                .put("household", new JSONObject().put("id", HOUSEHOLD).put("name", "Maison"))
                .put("entities", entities);
    }
}
