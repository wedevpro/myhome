package fr.myhome.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.ContextThemeWrapper;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONException;
import org.json.JSONTokener;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;

/** Trusted-origin web companion. All privileged widget requests use the same session. */
public final class MainActivity extends Activity {
    private static final int CAMERA_REQUEST = 701;
    private static final Set<String> ACTIONS = new HashSet<>(Arrays.asList("open", "add", "scan", "edit", "delete", "clearCompleted"));
    private WidgetStore store;
    private WebView web;
    private LinearLayout frame;
    private FrameLayout content;
    private ProgressBar progress;
    private PermissionRequest cameraRequest;
    private View fullscreen;
    private WebChromeClient.CustomViewCallback fullscreenCallback;
    private String lastSession = "";
    private boolean appearanceActive;
    private boolean appearanceReading;
    private long appearanceReadId;
    private final Handler appearanceHandler = new Handler(Looper.getMainLooper());
    private final Runnable appearancePoll = new Runnable() {
        @Override public void run() {
            syncAppearance();
            if (appearanceActive) appearanceHandler.postDelayed(this, 1000);
        }
    };

    public static Intent intent(Context context, String householdId, String listId, String itemId, String action) {
        return new Intent(context, MainActivity.class).setAction("fr.myhome.android.OPEN_LIST")
            .setData(new Uri.Builder().scheme("myhome").authority("widget").appendPath(householdId == null ? "" : householdId)
                .appendPath(listId == null ? "" : listId).appendQueryParameter("item", itemId == null ? "" : itemId)
                .appendQueryParameter("action", ACTIONS.contains(action) ? action : "open").build())
            .putExtra("householdId", householdId).putExtra("listId", listId).putExtra("itemId", itemId)
            .putExtra("action", ACTIONS.contains(action) ? action : "open")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    }

    @Override public void onCreate(Bundle state) {
        setTheme(AppAppearance.isDeviceDark(this) ? R.style.AppThemeDark : R.style.AppTheme);
        super.onCreate(state);
        store = new WidgetStore(this);
        CookieManager.getInstance().setAcceptCookie(true);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        lastSession = ServerClient.sessionCookie(store.getOrigin());
        if (store.getOrigin().isEmpty()) showSetup();
        else {
            showBrowser();
            if (state == null || !store.getOrigin().equals(state.getString("origin")) || web.restoreState(state) == null) loadTarget();
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        if (store.getOrigin().isEmpty()) showSetup();
        else { showBrowser(); loadTarget(); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    public static void applyInsets(View root) {
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout() | android.view.WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
    }

    private Button button(String text, View.OnClickListener listener) {
        Button button = new Button(this); button.setText(text); button.setAllCaps(false); button.setOnClickListener(listener);
        button.setMinHeight(dp(44)); return button;
    }

    private void showSetup() {
        hideFullscreen();
        cancelCameraRequest();
        appearanceReadId++; appearanceReading = false;
        if (web != null) { web.destroy(); web = null; }
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this); body.setOrientation(LinearLayout.VERTICAL); body.setPadding(dp(24), dp(28), dp(24), dp(24));
        TextView title = new TextView(this); title.setText("Bienvenue dans myHome"); title.setTextSize(24); title.setTextColor(getColor(R.color.setup_text)); body.addView(title);
        TextView description = new TextView(this); description.setText("Indiquez l’adresse HTTPS de votre application sur le NAS, puis connectez-vous avec votre compte myHome. Les widgets partageront cette connexion.");
        description.setTextSize(16); description.setPadding(0, dp(18), 0, dp(18)); body.addView(description);
        EditText origin = new EditText(this); origin.setSingleLine(true); origin.setHint("https://maison.exemple.fr"); origin.setText(store.getOrigin());
        origin.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); origin.setContentDescription("Adresse HTTPS du NAS"); body.addView(origin);
        TextView error = new TextView(this); error.setTextColor(getColor(R.color.setup_error)); body.addView(error);
        body.addView(button("Ouvrir myHome", view -> {
            final String normalized;
            try { normalized = ServerClient.normalizeOrigin(origin.getText().toString()); }
            catch (IOException invalid) { error.setText(invalid.getMessage()); return; }
            if (!store.getOrigin().isEmpty() && !normalized.equals(store.getOrigin())) {
                new AlertDialog.Builder(this).setTitle("Changer de NAS ?")
                    .setMessage("La connexion sera fermée et les widgets devront être reconfigurés pour ce NAS.")
                    .setNegativeButton("Annuler", null).setPositiveButton("Changer", (dialog, which) ->
                        CookieManager.getInstance().removeAllCookies(removed -> { CookieManager.getInstance().flush(); activateOrigin(normalized); })).show();
            } else activateOrigin(normalized);
        }));
        if (!store.getOrigin().isEmpty()) body.addView(button("Annuler", view -> { showBrowser(); loadTarget(); }));
        TextView details = new TextView(this); details.setText("Utilisez la même adresse que dans votre navigateur. Le NAS doit être joignable depuis cet appareil, et son certificat HTTPS doit être valide.");
        details.setPadding(0, dp(18), 0, 0); body.addView(details);
        scroll.addView(body); applyInsets(scroll); setContentView(scroll);
    }

    private void activateOrigin(String origin) {
        boolean changed = !origin.equals(store.getOrigin());
        store.setOrigin(origin);
        if (changed) {
            boolean configuring = getIntent().getBooleanExtra("widgetConfiguration", false);
            setIntent(new Intent(this, MainActivity.class).putExtra("widgetConfiguration", configuring));
        }
        lastSession = ServerClient.sessionCookie(origin);
        showBrowser(); loadTarget(); MyHomeWidgetProvider.refreshAll(this);
    }

    @SuppressWarnings("SetJavaScriptEnabled")
    private void showBrowser() {
        hideFullscreen();
        cancelCameraRequest();
        appearanceReadId++; appearanceReading = false;
        if (web != null) { web.destroy(); web = null; }
        frame = new LinearLayout(this); frame.setOrientation(LinearLayout.VERTICAL); frame.setBackgroundColor(getColor(R.color.setup_background));
        LinearLayout toolbar = new LinearLayout(this); toolbar.setGravity(android.view.Gravity.CENTER_VERTICAL);
        Button back = button("‹", view -> goBack()); back.setContentDescription("Retour");
        toolbar.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView name = new TextView(this); name.setText("myHome"); name.setTextSize(17); name.setTextColor(getColor(R.color.setup_accent_dark));
        toolbar.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        if (getIntent().getBooleanExtra("widgetConfiguration", false)) toolbar.addView(button("Continuer", view -> finish()));
        else {
            Button pin = button("＋", view -> pinWidget()); pin.setContentDescription("Ajouter un widget"); toolbar.addView(pin, new LinearLayout.LayoutParams(dp(48), dp(48)));
        }
        Button settings = button("⋯", view -> new AlertDialog.Builder(this).setTitle("myHome Android")
            .setItems(new String[]{"Ajouter un widget", "Actualiser la page et les widgets", "Adresse du NAS", "Se déconnecter"}, (dialog, which) -> {
                if (which == 0) pinWidget();
                else if (which == 1) { web.reload(); MyHomeWidgetProvider.refreshAll(this); }
                else if (which == 2) showSetup();
                else web.loadUrl(store.getOrigin() + "/deconnexion");
            }).show());
        settings.setContentDescription("Options de l’application"); toolbar.addView(settings, new LinearLayout.LayoutParams(dp(48), dp(48)));
        frame.addView(toolbar);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); progress.setMax(100); frame.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
        content = new FrameLayout(this); frame.addView(content, new LinearLayout.LayoutParams(-1, 0, 1));
        // CSS 'prefers-color-scheme' represents the device, while next-themes applies
        // explicit light/dark choices in the page. Do not derive this context from that choice.
        web = new WebView(new ContextThemeWrapper(this,
                AppAppearance.isDeviceDark(this) ? R.style.AppThemeDark : R.style.AppTheme));
        WebSettings settingsWeb = web.getSettings();
        settingsWeb.setJavaScriptEnabled(true); settingsWeb.setDomStorageEnabled(true);
        settingsWeb.setAllowFileAccess(false); settingsWeb.setAllowContentAccess(false);
        settingsWeb.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settingsWeb.setSafeBrowsingEnabled(true); settingsWeb.setMediaPlaybackRequiresUserGesture(true);
        settingsWeb.setUserAgentString(settingsWeb.getUserAgentString() + " myHomeAndroid/1.0");
        if (Build.VERSION.SDK_INT >= 29) web.setForceDarkAllowed(false);
        if (Build.VERSION.SDK_INT >= 33) settingsWeb.setAlgorithmicDarkeningAllowed(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrusted(uri)) return false;
                String scheme = uri.getScheme();
                if (request.isForMainFrame() && request.hasGesture() && ("https".equals(scheme) || "http".equals(scheme) || "mailto".equals(scheme) || "tel".equals(scheme))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (android.content.ActivityNotFoundException ignored) { toast("Aucune application ne peut ouvrir ce lien."); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { progress.setVisibility(View.VISIBLE); }
            @Override public void onPageCommitVisible(WebView view, String url) { installCameraFocus(view, url); }
            @Override public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE); CookieManager.getInstance().flush();
                String session = ServerClient.sessionCookie(store.getOrigin());
                if (!session.equals(lastSession)) { lastSession = session; store.clearCaches(); MyHomeWidgetProvider.refreshAll(MainActivity.this); }
                installCameraFocus(view, url);
                syncAppearance();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showNetworkError("Le NAS n’est pas joignable. Vérifiez le réseau, le VPN éventuel et l’adresse configurée.");
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel(); showNetworkError("Le certificat HTTPS du NAS n’est pas valide pour cette adresse. Corrigez le certificat ou l’adresse sur le NAS.");
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> requestCamera(request));
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (cameraRequest == request) cameraRequest = null;
            }
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (fullscreen != null) { callback.onCustomViewHidden(); return; }
                fullscreen = view; fullscreenCallback = callback;
                getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
                ((ViewGroup) getWindow().getDecorView()).addView(view, new ViewGroup.LayoutParams(-1, -1));
            }
            @Override public void onHideCustomView() { hideFullscreen(); }
        });
        content.addView(web, new FrameLayout.LayoutParams(-1,-1)); applyInsets(frame); setContentView(frame);
    }

    private boolean isTrusted(Uri uri) {
        try { return store.getOrigin().equals(ServerClient.normalizeOrigin(new Uri.Builder().scheme(uri.getScheme()).encodedAuthority(uri.getEncodedAuthority()).build().toString())); }
        catch (IOException error) { return false; }
    }

    private void installCameraFocus(WebView view, String url) {
        if (view == web && url != null && isTrusted(Uri.parse(url)))
            CameraFocusSupport.install(view, store.getOrigin());
    }

    /** Read one existing setting from our HTTPS origin; expose no native JS interface. */
    private void syncAppearance() {
        final WebView source = web;
        if (source == null || appearanceReading || isDestroyed()) return;
        String url = source.getUrl();
        if (url == null || !isTrusted(Uri.parse(url))) return;
        final String origin = store.getOrigin();
        final long request = ++appearanceReadId;
        appearanceReading = true;
        source.evaluateJavascript("(function(){try{return localStorage.getItem('myhome-theme')||'light';}catch(e){return null;}})()", value -> {
            if (request != appearanceReadId) return;
            appearanceReading = false;
            if (isDestroyed() || source != web || !origin.equals(store.getOrigin())) return;
            String currentUrl = source.getUrl();
            if (currentUrl == null || !isTrusted(Uri.parse(currentUrl)) || value == null || value.length() > 32) return;
            try {
                Object mode = new JSONTokener(value).nextValue();
                if (mode instanceof String && AppAppearance.saveMode(this, origin, (String) mode))
                    MyHomeWidgetProvider.renderAll(this);
            } catch (JSONException ignored) { /* A failed read must not change the saved preference. */ }
        });
    }

    private void requestCamera(PermissionRequest request) {
        if (!isTrusted(request.getOrigin()) || !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) { request.deny(); return; }
        if (cameraRequest != null) cameraRequest.deny();
        cameraRequest = request;
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) grantCamera();
        else requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_REQUEST);
    }

    private void grantCamera() {
        PermissionRequest request = cameraRequest; cameraRequest = null;
        if (request != null && isTrusted(request.getOrigin())) request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        else if (request != null) request.deny();
    }

    private void cancelCameraRequest() {
        if (cameraRequest != null) { cameraRequest.deny(); cameraRequest = null; }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == CAMERA_REQUEST) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) grantCamera();
            else { if (cameraRequest != null) cameraRequest.deny(); cameraRequest = null; toast("Vous pouvez saisir le code manuellement ou autoriser la caméra dans les paramètres Android."); }
        }
    }

    private static boolean validId(String id) { return id != null && id.matches("[A-Za-z0-9_-]{1,128}"); }

    private void loadTarget() {
        Uri.Builder url = Uri.parse(store.getOrigin() + "/").buildUpon();
        String householdId = getIntent().getStringExtra("householdId"), listId = getIntent().getStringExtra("listId");
        boolean hasTarget = validId(householdId) && validId(listId);
        if (hasTarget) {
            String action = getIntent().getStringExtra("action"), item = getIntent().getStringExtra("itemId");
            url.appendQueryParameter("mobileWidget", "1").appendQueryParameter("household", householdId).appendQueryParameter("list", listId)
                .appendQueryParameter("action", ACTIONS.contains(action) ? action : "open");
            if (("edit".equals(action) || "delete".equals(action)) && validId(item)) url.appendQueryParameter("item", item);
        }
        web.loadUrl(!hasTarget && ServerClient.sessionCookie(store.getOrigin()).isEmpty() ? store.getOrigin() + "/connexion" : url.build().toString());
    }

    private void showNetworkError(String message) {
        if (isFinishing() || content == null) return;
        runOnUiThread(() -> {
            if (content == null || content.getChildCount() > 1) return;
            LinearLayout error = new LinearLayout(this); error.setOrientation(LinearLayout.VERTICAL); error.setPadding(dp(24),dp(24),dp(24),dp(24)); error.setBackgroundColor(getColor(R.color.setup_surface));
            TextView text = new TextView(this); text.setText(message); text.setTextSize(16); error.addView(text);
            error.addView(button("Réessayer", view -> { content.removeView(error); web.reload(); }));
            error.addView(button("Adresse du NAS", view -> showSetup()));
            content.addView(error, new FrameLayout.LayoutParams(-1,-1));
        });
    }

    private void pinWidget() {
        new AlertDialog.Builder(this).setTitle("Ajouter un widget")
                .setItems(new String[]{"Liste de courses ou checklist", "Scan rapide"},
                        (dialog, which) -> pinWidget(which == 1)).show();
    }

    private void pinWidget(boolean quickScan) {
        AppWidgetManager manager = getSystemService(AppWidgetManager.class);
        if (manager.isRequestPinAppWidgetSupported()) {
            // Pin requests skip the provider's usual configuration activity.
            Intent configure = new Intent(this, WidgetConfigureActivity.class)
                .setData(Uri.parse("myhome://pinned-widget/" + (quickScan ? "scan/" : "list/") + System.currentTimeMillis()))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            PendingIntent callback = PendingIntent.getActivity(this, 0, configure,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE);
            manager.requestPinAppWidget(new ComponentName(this,
                    quickScan ? QuickScanWidgetProvider.class : MyHomeWidgetProvider.class), null, callback);
        }
        else toast("Sur l’écran d’accueil Android, faites un appui long, puis Widgets → myHome.");
    }

    private void hideFullscreen() {
        if (fullscreen == null) return;
        ((ViewGroup) fullscreen.getParent()).removeView(fullscreen); fullscreen = null;
        getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_FULLSCREEN);
        WebChromeClient.CustomViewCallback callback = fullscreenCallback; fullscreenCallback = null;
        if (callback != null) callback.onCustomViewHidden();
    }

    private void goBack() {
        if (fullscreen != null) hideFullscreen();
        else if (web != null && web.canGoBack()) web.goBack();
        else if (getIntent().getBooleanExtra("widgetConfiguration", false)) finish();
    }
    @Override public void onBackPressed() { goBack(); }
    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_LONG).show(); }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        appearanceActive = true;
        appearanceHandler.removeCallbacks(appearancePoll);
        appearanceHandler.post(appearancePoll);
        if (store != null && !store.getOrigin().isEmpty()) MyHomeWidgetProvider.refreshAll(this);
    }
    @Override protected void onPause() {
        appearanceActive = false;
        appearanceHandler.removeCallbacks(appearancePoll);
        syncAppearance();
        if (web != null) web.onPause();
        CookieManager.getInstance().flush();
        if (store != null && !store.getOrigin().isEmpty()) MyHomeWidgetProvider.refreshAll(this);
        super.onPause();
    }
    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state); if (web != null) { state.putString("origin", store.getOrigin()); web.saveState(state); }
    }
    @Override protected void onDestroy() {
        appearanceActive = false;
        appearanceHandler.removeCallbacks(appearancePoll);
        appearanceReadId++;
        cancelCameraRequest();
        hideFullscreen(); if (web != null) { web.destroy(); web = null; }
        super.onDestroy();
    }
}
