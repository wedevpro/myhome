package fr.myhome.android;

import android.app.Application;
import android.content.res.Configuration;

public final class MyHomeApplication extends Application {
    @Override public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        if ("system".equals(AppAppearance.getMode(this))) MyHomeWidgetProvider.renderAll(this);
    }
}
