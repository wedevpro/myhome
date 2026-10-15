package fr.myhomeia.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.content.res.TypedArray;
import android.graphics.Color;
import android.os.Build;
import android.webkit.CookieManager;
import android.widget.Button;
import android.widget.TextView;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.LooperMode;

/** Exercises actual Android preferences, configuration contexts, resources, and setup views. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class AppAppearanceTest {
    private static final String NAS = "https://maison.example.test";
    private static final String OTHER_NAS = "https://autre.example.test";
    private Application application;

    @Before public void resetAppearance() {
        application = RuntimeEnvironment.getApplication();
        application.getSharedPreferences("myhomeia_widgets", Context.MODE_PRIVATE).edit().clear().commit();
        application.getSharedPreferences("myhomeia_appearance", Context.MODE_PRIVATE).edit().clear().commit();
        CookieManager.getInstance().removeAllCookies(null);
        setDeviceDark(false);
        new WidgetStore(application).setOrigin(NAS);
    }

    @Test public void absentPreferenceStaysLightEvenOnDarkDevice() {
        setDeviceDark(true);
        assertTrue(AppAppearance.isDeviceDark(application));
        assertEquals("light", AppAppearance.getMode(application));
        assertFalse(AppAppearance.isDark(application));
        assertEquals(Color.WHITE, AppAppearance.themedContext(application).getColor(R.color.widget_background));
    }

    @Test public void eachPreferenceResolvesAgainstBothDeviceModes() {
        for (boolean deviceDark : new boolean[] {false, true}) {
            setDeviceDark(deviceDark);
            for (String mode : new String[] {"light", "dark", "system"}) {
                AppAppearance.saveMode(application, NAS, mode);
                boolean expectedDark = "dark".equals(mode) || ("system".equals(mode) && deviceDark);
                assertEquals("Saved choice " + mode, mode, AppAppearance.getMode(application));
                assertEquals("Device mode must remain independent of the saved choice", deviceDark,
                        AppAppearance.isDeviceDark(application));
                assertEquals("Resolved " + mode + " on device dark=" + deviceDark, expectedDark,
                        AppAppearance.isDark(application));
                Context themed = AppAppearance.themedContext(application);
                assertEquals(expectedDark ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO,
                        themed.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK);
                assertEquals(expectedDark ? Color.rgb(34, 31, 42) : Color.WHITE,
                        themed.getColor(R.color.widget_background));
                assertEquals(expectedDark ? Color.rgb(236, 233, 243) : Color.rgb(48, 48, 62),
                        themed.getColor(R.color.setup_text));
            }
        }
    }

    @Test public void systemChoiceIsPreservedWhenDeviceChanges() {
        assertTrue(AppAppearance.saveMode(application, NAS, "system"));
        assertFalse(AppAppearance.isDark(application));
        setDeviceDark(true);
        assertEquals("system", AppAppearance.getMode(application));
        assertTrue(AppAppearance.isDark(application));
        setDeviceDark(false);
        assertEquals("system", AppAppearance.getMode(application));
        assertFalse(AppAppearance.isDark(application));
    }

    @Test public void rejectsForeignOriginsAndStaleNasCallbacks() {
        assertTrue(AppAppearance.saveMode(application, NAS, "dark"));
        assertFalse(AppAppearance.saveMode(application, OTHER_NAS, "light"));
        assertEquals("dark", AppAppearance.getMode(application));
        new WidgetStore(application).setOrigin(OTHER_NAS);
        assertEquals("light", AppAppearance.getMode(application));
        assertFalse(AppAppearance.saveMode(application, NAS, "dark"));
        assertEquals("light", AppAppearance.getMode(application));
        assertTrue(AppAppearance.saveMode(application, OTHER_NAS, "system"));
        assertEquals("system", AppAppearance.getMode(application));
    }

    @Test public void rejectsInvalidChoicesWithoutChangingPreference() {
        assertTrue(AppAppearance.saveMode(application, NAS, "dark"));
        for (String invalid : new String[] {null, "", "DARK", "auto", "dark;anything"}) {
            assertFalse(AppAppearance.validMode(invalid));
            assertFalse(AppAppearance.saveMode(application, NAS, invalid));
            assertEquals("dark", AppAppearance.getMode(application));
        }
        assertFalse(AppAppearance.saveMode(application, null, "light"));
        assertFalse(AppAppearance.saveMode(application, "", "light"));
        assertEquals("dark", AppAppearance.getMode(application));
    }

    @Test public void duplicateChoiceDoesNotTriggerAnotherAppearanceRefresh() {
        assertFalse(AppAppearance.saveMode(application, NAS, "light"));
        assertTrue(AppAppearance.saveMode(application, NAS, "dark"));
        assertFalse(AppAppearance.saveMode(application, NAS, "dark"));
    }

    @Test public void nativeContextsOverrideLauncherColorsWithoutChangingDeviceMode() {
        for (boolean deviceDark : new boolean[] {false, true}) {
            setDeviceDark(deviceDark);
            AppAppearance.saveMode(application, NAS, deviceDark ? "light" : "dark");
            Context themed = AppAppearance.themedContext(application);
            assertNotEquals(application.getColor(R.color.setup_background), themed.getColor(R.color.setup_background));
            assertEquals(deviceDark, AppAppearance.isDeviceDark(themed));
            assertEquals(deviceDark, AppAppearance.isDeviceDark(application));
        }
    }

    @Test public void setupActivityUsesChosenThemeWithNoSessionOrNetwork() {
        for (boolean deviceDark : new boolean[] {false, true}) {
            setDeviceDark(deviceDark);
            for (String mode : new String[] {"light", "dark", "system"}) {
                AppAppearance.saveMode(application, NAS, mode);
                boolean expectedDark = "dark".equals(mode) || ("system".equals(mode) && deviceDark);
                Intent configure = new Intent(application, WidgetConfigureActivity.class)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, 41);
                ActivityController<WidgetConfigureActivity> controller =
                        Robolectric.buildActivity(WidgetConfigureActivity.class, configure).create().start().resume();
                try {
                    WidgetConfigureActivity activity = controller.get();
                    TextView message = activity.findViewById(R.id.setup_message);
                    assertEquals(activity.getString(R.string.setup_sign_in_needed), message.getText().toString());
                    assertEquals(expectedDark ? Color.rgb(187, 180, 199) : Color.rgb(109, 102, 121),
                            message.getCurrentTextColor());
                    assertFalse(((Button) activity.findViewById(R.id.setup_save)).isEnabled());
                    assertEquals(expectedDark ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO,
                            activity.getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK);
                    if (Build.VERSION.SDK_INT >= 29) {
                        TypedArray theme = activity.obtainStyledAttributes(new int[] {android.R.attr.isLightTheme});
                        try { assertEquals(!expectedDark, theme.getBoolean(0, true)); }
                        finally { theme.recycle(); }
                    }
                } finally { controller.pause().stop().destroy(); }
            }
        }
    }

    private void setDeviceDark(boolean dark) {
        RuntimeEnvironment.setQualifiers(dark ? "+night" : "+notnight");
    }
}
