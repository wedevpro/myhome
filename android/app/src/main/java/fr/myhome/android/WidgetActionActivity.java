package fr.myhome.android;

import android.app.Activity;
import android.os.Bundle;

/** Direct launcher activity target: Android 12+ disallows widget broadcast trampolines. */
public final class WidgetActionActivity extends Activity {
    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        try { MyHomeWidgetProvider.handleItemAction(this, getIntent()); }
        finally { finish(); }
    }
}
