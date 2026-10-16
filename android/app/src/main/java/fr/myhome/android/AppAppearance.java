package fr.myhome.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;

/** The web preference is per device and NAS origin, just like its localStorage. */
public final class AppAppearance {
    private AppAppearance() {}

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences("myhome_appearance", Context.MODE_PRIVATE);
    }

    public static boolean validMode(String mode) {
        return "light".equals(mode) || "dark".equals(mode) || "system".equals(mode);
    }

    public static String getMode(Context context) {
        SharedPreferences prefs = preferences(context);
        String origin = new WidgetStore(context).getOrigin();
        String mode = prefs.getString("mode", "light");
        return !origin.isEmpty() && origin.equals(prefs.getString("origin", "")) && validMode(mode) ? mode : "light";
    }

    /** Reject callbacks from a previous server and anything outside the three UI choices. */
    public static boolean saveMode(Context context, String expectedOrigin, String mode) {
        if (expectedOrigin == null || expectedOrigin.isEmpty() || !validMode(mode) ||
                !expectedOrigin.equals(new WidgetStore(context).getOrigin())) return false;
        if (mode.equals(getMode(context))) return false;
        preferences(context).edit().putString("origin", expectedOrigin).putString("mode", mode).apply();
        return true;
    }

    public static boolean isDeviceDark(Context context) {
        return (context.getApplicationContext().getResources().getConfiguration().uiMode &
                Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    public static boolean isDark(Context context) {
        String mode = getMode(context);
        return "dark".equals(mode) || ("system".equals(mode) && isDeviceDark(context));
    }

    /** Resolve native colors from the app's choice, independently of the launcher's theme. */
    public static Context themedContext(Context context) {
        Configuration config = new Configuration(context.getResources().getConfiguration());
        config.uiMode = (config.uiMode & ~Configuration.UI_MODE_NIGHT_MASK) |
                (isDark(context) ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        return context.createConfigurationContext(config);
    }
}
