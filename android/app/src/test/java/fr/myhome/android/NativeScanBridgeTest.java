package fr.myhome.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.webkit.CookieManager;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
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
import org.robolectric.shadows.ShadowActivity.IntentForResult;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

/** Exercises camera replies and trusted-document/session isolation without a real camera or NAS. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class NativeScanBridgeTest {
    private static final String NAS = "https://maison.example.test";
    private static final String PAGE = NAS + "/?widgetList=shopping-one";
    private static final String OTHER = "https://autre.example.test";
    private ActivityController<RecordingActivity> controller;
    private RecordingActivity activity;
    private WebView web;
    private AtomicReference<WebView> currentWeb;
    private AtomicReference<String> origin;
    private NativeScanBridge bridge;

    public static class RecordingActivity extends Activity {
        final List<Integer> finishedRequests = new ArrayList<>();
        @Override public void finishActivity(int requestCode) { finishedRequests.add(requestCode); }
    }

    public static class UnavailableActivity extends Activity {
        @Override public void startActivityForResult(Intent intent, int requestCode) {
            throw new android.content.ActivityNotFoundException("Scanner unavailable");
        }
    }

    @Before public void prepare() {
        Application application = RuntimeEnvironment.getApplication();
        application.getSharedPreferences("myhome_widgets", Context.MODE_PRIVATE).edit().clear().commit();
        CookieManager.getInstance().removeAllCookies(null);
        cookie('a');
        controller = Robolectric.buildActivity(RecordingActivity.class).create().start().resume();
        activity = controller.get();
        web = new WebView(activity);
        web.loadUrl(PAGE);
        currentWeb = new AtomicReference<>(web);
        origin = new AtomicReference<>(NAS);
        bridge = new NativeScanBridge(activity, currentWeb::get, origin::get);
    }

    @After public void close() {
        bridge.cancel();
        web.destroy();
        controller.pause().stop().destroy();
    }

    @Test public void unrelatedPromptsRemainOrdinaryWebPrompts() {
        Replies replies = new Replies();
        assertFalse(bridge.handlePrompt(web, PAGE, "ordinary prompt", "environment", replies));
        assertEquals(0, replies.values.size());
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
        assertFalse(bridge.hasPending());
    }

    @Test public void bothCamerasLaunchOnlyOurPrivateScannerAndReturnOneExactCode() throws Exception {
        int previousCode = -1;
        for (String camera : new String[]{"environment", "user"}) {
            Replies replies = new Replies();
            int requestCode = begin(camera, replies);
            assertNotEquals(previousCode, requestCode);
            previousCode = requestCode;
            assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("0012345678905")));
            assertEquals("ok", replies.only().getString("status"));
            assertEquals("0012345678905", replies.only().getString("code"));
            assertEquals(2, replies.only().length());
            assertFalse(bridge.hasPending());
            assertFalse(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("OTHER")));
            assertEquals(1, replies.values.size());
        }
    }

    @Test public void callbackOriginAndDocumentMustBothMatchTheConfiguredHttpsPage() throws Exception {
        for (String url : new String[]{null, OTHER + "/", "http://maison.example.test/", "file:///index.html",
                "https://maison.example.test.evil.test/", "https://maison.example.test:8443/",
                "https://user@maison.example.test/", NAS + "/connexion", NAS + "/?widgetList=other"}) {
            Replies replies = new Replies();
            assertTrue(bridge.handlePrompt(web, url, NativeScanBridge.PROMPT, "environment", replies));
            assertEquals("cancelled", replies.only().getString("status"));
            assertFalse(bridge.hasPending());
            assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
        }
        web.loadUrl(OTHER + "/");
        Replies replies = new Replies();
        assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "environment", replies));
        assertEquals("cancelled", replies.only().getString("status"));
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
    }

    @Test public void oldWebViewsAndInvalidCameraParametersCannotOpenTheCamera() throws Exception {
        try {
            currentWeb.set(new WebView(activity));
            Replies discarded = new Replies();
            assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "environment", discarded));
            assertEquals("cancelled", discarded.only().getString("status"));
        } finally {
            currentWeb.get().destroy();
            currentWeb.set(web);
        }
        for (String camera : new String[]{null, "", "rear", "ENVIRONMENT", "environment\n"}) {
            Replies replies = new Replies();
            assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, camera, replies));
            assertEquals("error", replies.only().getString("status"));
            assertFalse(bridge.hasPending());
        }
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
    }

    @Test public void concurrentAndUnknownResultsCannotReplaceThePendingRequest() throws Exception {
        Replies first = new Replies(), second = new Replies();
        int requestCode = begin("environment", first);
        assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "user", second));
        assertEquals("error", second.only().getString("status"));
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
        assertFalse(bridge.handleActivityResult(requestCode + 1, Activity.RESULT_OK, code("WRONG")));
        assertTrue(bridge.hasPending());
        assertEquals(0, first.values.size());
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("RIGHT")));
        assertEquals("RIGHT", first.only().getString("code"));
    }

    @Test public void navigationSessionChangesAndWebViewReplacementDiscardLateCodes() throws Exception {
        for (String mutation : new String[]{"page", "cookie", "origin", "web"}) {
            Replies replies = new Replies();
            int requestCode = begin("environment", replies);
            if (mutation.equals("page")) web.loadUrl(NAS + "/connexion");
            if (mutation.equals("cookie")) cookie('b');
            if (mutation.equals("origin")) origin.set(OTHER);
            if (mutation.equals("web")) currentWeb.set(null);
            assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("PRIVATE-CODE")));
            JSONObject reply = replies.only();
            assertEquals("cancelled", reply.getString("status"));
            assertEquals(1, reply.length());
            assertFalse(bridge.hasPending());
            web.loadUrl(PAGE); cookie('a'); origin.set(NAS); currentWeb.set(web);
        }
    }

    @Test public void cancelClosesItsOwnScannerOnceAndOldResultsCannotConsumeTheNextScan() throws Exception {
        Replies first = new Replies(), next = new Replies();
        int oldCode = begin("environment", first);
        bridge.cancel();
        bridge.cancel();
        assertEquals("cancelled", first.only().getString("status"));
        assertEquals(List.of(oldCode), activity.finishedRequests);
        assertFalse(bridge.hasPending());
        int nextCode = begin("user", next);
        assertNotEquals(oldCode, nextCode);
        assertFalse(bridge.handleActivityResult(oldCode, Activity.RESULT_OK, code("OLD")));
        assertTrue(bridge.hasPending());
        assertEquals(0, next.values.size());
        assertTrue(bridge.handleActivityResult(nextCode, Activity.RESULT_OK, code("NEW")));
        assertEquals("NEW", next.only().getString("code"));
        assertEquals(1, first.values.size());
    }

    @Test public void cancellationAndCameraErrorsReturnNoBarcode() throws Exception {
        Replies cancelled = new Replies();
        int requestCode = begin("environment", cancelled);
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_CANCELED, code("IGNORED")));
        assertEquals("cancelled", cancelled.only().getString("status"));
        assertFalse(cancelled.only().has("code"));
        Replies error = new Replies();
        requestCode = begin("environment", error);
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK,
                new Intent().putExtra("error", "Autorisez la caméra.").putExtra("code", "IGNORED")));
        assertEquals("error", error.only().getString("status"));
        assertEquals("Autorisez la caméra.", error.only().getString("message"));
        assertFalse(error.only().has("code"));
    }

    @Test public void emptyControlCharacterAndOversizedCodesNeverReachTheWebList() throws Exception {
        for (String invalid : new String[]{null, "", " ", "x".repeat(81), "12\n34", "12\u000034", "12\u007f34", "12\u008534"}) {
            Replies replies = new Replies();
            int requestCode = begin("environment", replies);
            assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code(invalid)));
            assertEquals("error", replies.only().getString("status"));
            assertFalse(replies.only().has("code"));
        }
        Replies missing = new Replies();
        int requestCode = begin("environment", missing);
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, null));
        assertEquals("error", missing.only().getString("status"));
    }

    @Test public void demoScansWorkButCannotSurviveAChangeFromDemoToAuthenticatedSession() throws Exception {
        CookieManager.getInstance().removeAllCookies(null);
        Replies demo = new Replies();
        int requestCode = begin("environment", demo);
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("DEMO")));
        assertEquals("DEMO", demo.only().getString("code"));
        Replies staleDemo = new Replies();
        requestCode = begin("environment", staleDemo);
        cookie('b');
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("DEMO")));
        assertEquals("cancelled", staleDemo.only().getString("status"));
    }

    @Test public void finishingOwnerCannotOpenOrDeliverAnotherCameraResult() throws Exception {
        Replies pending = new Replies();
        int requestCode = begin("environment", pending);
        activity.finish();
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("LATE")));
        assertEquals("cancelled", pending.only().getString("status"));
        Replies afterFinish = new Replies();
        assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "environment", afterFinish));
        assertEquals("cancelled", afterFinish.only().getString("status"));
        assertNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
    }

    @Test public void aDiscardedPromptCannotKeepTheNextCameraRequestBlocked() throws Exception {
        assertTrue(bridge.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "environment",
                response -> { throw new IllegalStateException("Document discarded"); }));
        assertNotNull(Shadows.shadowOf(activity).getNextStartedActivityForResult());
        bridge.cancel();
        assertFalse(bridge.hasPending());
        Replies next = new Replies();
        int requestCode = begin("user", next);
        assertTrue(bridge.handleActivityResult(requestCode, Activity.RESULT_OK, code("NEXT")));
        assertEquals("NEXT", next.only().getString("code"));
    }

    @Test public void activityLaunchFailureUnblocksThePromptAndAllowsAnotherAttempt() throws Exception {
        try (ActivityController<UnavailableActivity> unavailable =
                     Robolectric.buildActivity(UnavailableActivity.class).create().start().resume()) {
            NativeScanBridge broken = new NativeScanBridge(unavailable.get(), currentWeb::get, origin::get);
            for (int attempt = 0; attempt < 2; attempt++) {
                Replies replies = new Replies();
                assertTrue(broken.handlePrompt(web, PAGE, NativeScanBridge.PROMPT, "environment", replies));
                assertEquals("error", replies.only().getString("status"));
                assertFalse(replies.only().has("code"));
                assertFalse(broken.hasPending());
            }
        }
    }

    private int begin(String camera, Replies replies) {
        assertTrue(bridge.handlePrompt(web, web.getUrl(), NativeScanBridge.PROMPT, camera, replies));
        IntentForResult started = Shadows.shadowOf(activity).getNextStartedActivityForResult();
        assertNotNull(started);
        assertEquals(NativeScanActivity.class.getName(), started.intent.getComponent().getClassName());
        assertEquals(camera, started.intent.getStringExtra("camera"));
        assertEquals(1, started.intent.getExtras().size());
        assertTrue(bridge.hasPending());
        assertEquals(0, replies.values.size());
        return started.requestCode;
    }

    private static void cookie(char value) {
        CookieManager.getInstance().setCookie(NAS,
                "myhome_session=" + String.valueOf(value).repeat(64) + "; Path=/; Secure; HttpOnly");
    }

    private static Intent code(String code) { return new Intent().putExtra("code", code); }

    private static final class Replies implements NativeScanBridge.Reply {
        final List<String> values = new ArrayList<>();
        @Override public void complete(String response) { values.add(response); }
        JSONObject only() throws JSONException {
            assertEquals(1, values.size());
            return new JSONObject(values.get(0));
        }
    }
}
