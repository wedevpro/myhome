package fr.myhome.android;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.Manifest;
import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Camera;

import com.journeyapps.barcodescanner.BarcodeView;
import com.journeyapps.barcodescanner.camera.CameraSettings;

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
import org.robolectric.shadows.ShadowCamera;

/** Exercises the local scanner boundary; no real camera, network or NAS is required. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {28, 35})
@LooperMode(LooperMode.Mode.PAUSED)
public class NativeScanActivityTest {
    private Application application;

    @Before public void prepare() {
        application = RuntimeEnvironment.getApplication();
        Shadows.shadowOf(application).denyPermissions(Manifest.permission.CAMERA);
        application.getSharedPreferences("myhome_appearance", Context.MODE_PRIVATE).edit().clear().commit();
        ShadowCamera.clearCameraInfo();
    }

    @Test public void cameraChoiceUsesFacingInsteadOfAssumingRearIsCameraZero() {
        addCamera(0, Camera.CameraInfo.CAMERA_FACING_FRONT);
        addCamera(1, Camera.CameraInfo.CAMERA_FACING_BACK);
        assertEquals(1, NativeScanActivity.findCameraId("environment"));
        assertEquals(0, NativeScanActivity.findCameraId("user"));
    }

    @Test public void unavailableOrInvalidCameraNeverFallsBackToTheOppositeSide() {
        addCamera(0, Camera.CameraInfo.CAMERA_FACING_FRONT);
        assertEquals(-1, NativeScanActivity.findCameraId("environment"));
        assertEquals(-1, NativeScanActivity.findCameraId("unexpected"));
        assertEquals(-1, NativeScanActivity.findCameraId(null));
        ShadowCamera.clearCameraInfo();
        assertEquals(-1, NativeScanActivity.findCameraId("user"));
    }

    @Test public void grantedPermissionStartsTheRequestedRearCameraWithRepeatedNativeAutofocus() {
        addCamera(0, Camera.CameraInfo.CAMERA_FACING_FRONT);
        addCamera(1, Camera.CameraInfo.CAMERA_FACING_BACK);
        Shadows.shadowOf(application).grantPermissions(Manifest.permission.CAMERA);
        try (ActivityController<NativeScanActivity> controller = scanner("environment").create().start().resume()) {
            NativeScanActivity activity = controller.get();
            BarcodeView preview = activity.findViewById(R.id.native_scan_preview);
            CameraSettings settings = preview.getCameraSettings();
            assertNotNull("The real startCamera path must initialize the camera instance", preview.getCameraInstance());
            assertEquals(1, settings.getRequestedCameraId());
            assertTrue(settings.isAutoFocusEnabled());
            assertEquals(CameraSettings.FocusMode.AUTO, settings.getFocusMode());
            assertFalse(settings.isContinuousFocusEnabled());
            assertNull(Shadows.shadowOf(activity).getLastRequestedPermission());
            controller.pause();
            assertNull("Pausing must release the native camera before returning to the WebView", preview.getCameraInstance());
        }
    }

    @Test public void invalidCameraExtraReturnsAnActionableErrorWithoutOpeningAPreview() {
        try (ActivityController<NativeScanActivity> controller = scanner("other").create()) {
            NativeScanActivity activity = controller.get();
            assertTrue(activity.isFinishing());
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            assertEquals(activity.getString(R.string.native_scan_invalid_camera),
                    Shadows.shadowOf(activity).getResultIntent().getStringExtra("error"));
            assertNull(activity.findViewById(R.id.native_scan_preview));
        }
    }

    @Test public void permissionDenialReturnsAnErrorWithoutAnyBarcode() {
        try (ActivityController<NativeScanActivity> controller = scanner("environment").create().start().resume()) {
            NativeScanActivity activity = controller.get();
            assertNotNull(Shadows.shadowOf(activity).getLastRequestedPermission());
            activity.onRequestPermissionsResult(NativeScanActivity.CAMERA_PERMISSION,
                    new String[]{Manifest.permission.CAMERA}, new int[]{PackageManager.PERMISSION_DENIED});
            assertTrue(activity.isFinishing());
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            Intent result = Shadows.shadowOf(activity).getResultIntent();
            assertEquals(activity.getString(R.string.native_scan_permission_error), result.getStringExtra("error"));
            assertFalse(result.hasExtra("code"));
        }
    }

    @Test public void validBarcodeReturnsOnceAndDoesNotExposeAnySessionOrListData() {
        try (ActivityController<NativeScanActivity> controller = scanner("environment").create().start().resume()) {
            NativeScanActivity activity = controller.get();
            activity.acceptBarcode(" 3017620422003 ");
            activity.acceptBarcode("1234567890128");
            activity.finishWithError(R.string.native_scan_camera_error);
            assertEquals(Activity.RESULT_OK, Shadows.shadowOf(activity).getResultCode());
            Intent result = Shadows.shadowOf(activity).getResultIntent();
            assertEquals("3017620422003", result.getStringExtra("code"));
            assertEquals(1, result.getExtras().size());
            assertTrue(activity.isFinishing());
        }
    }

    @Test public void unusablePayloadsKeepScanningAndPausedOrCancelledScreensIgnoreLateResults() {
        try (ActivityController<NativeScanActivity> controller = scanner("user").create().start().resume()) {
            NativeScanActivity activity = controller.get();
            activity.acceptBarcode("x".repeat(81));
            activity.acceptBarcode("hello\nworld");
            activity.acceptBarcode(" ");
            assertFalse(activity.isFinishing());
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            controller.pause();
            activity.acceptBarcode("3017620422003");
            assertFalse(activity.isFinishing());
            controller.resume();
            activity.findViewById(R.id.native_scan_cancel).performClick();
            activity.acceptBarcode("3017620422003");
            assertTrue(activity.isFinishing());
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertNull(Shadows.shadowOf(activity).getResultIntent());
        }
    }

    @Test public void systemBackCannotBeOverwrittenByAnAlreadyQueuedCameraCallback() {
        try (ActivityController<NativeScanActivity> controller = scanner("environment").create().start().resume()) {
            NativeScanActivity activity = controller.get();
            activity.finish(); // Android's system Back finishes the Activity before onPause.
            activity.acceptBarcode("3017620422003");
            activity.finishWithError(R.string.native_scan_camera_error);
            assertEquals(Activity.RESULT_CANCELED, Shadows.shadowOf(activity).getResultCode());
            assertNull(Shadows.shadowOf(activity).getResultIntent());
        }
    }

    @Test public void barcodeBoundaryAcceptsUsualFormatsAndRejectsControlCharactersAndOversizedCodes() {
        assertTrue(NativeScanActivity.validCode("3017620422003"));
        assertTrue(NativeScanActivity.validCode("ABC-123/456"));
        assertTrue(NativeScanActivity.validCode("x".repeat(80)));
        assertFalse(NativeScanActivity.validCode("x".repeat(81)));
        assertFalse(NativeScanActivity.validCode(null));
        assertFalse(NativeScanActivity.validCode(""));
        assertFalse(NativeScanActivity.validCode("\t"));
        assertFalse(NativeScanActivity.validCode("123\u007f456"));
        assertFalse(NativeScanActivity.validCode("123\u0000456"));
    }

    private ActivityController<NativeScanActivity> scanner(String camera) {
        return Robolectric.buildActivity(NativeScanActivity.class,
                new Intent(application, NativeScanActivity.class).putExtra("camera", camera));
    }

    private static void addCamera(int id, int facing) {
        Camera.CameraInfo info = new Camera.CameraInfo();
        info.facing = facing;
        info.orientation = 90;
        ShadowCamera.addCameraInfo(id, info);
    }
}
