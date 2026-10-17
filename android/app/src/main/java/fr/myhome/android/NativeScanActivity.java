package fr.myhome.android;

import android.Manifest;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.hardware.Camera;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.TextView;

import com.google.zxing.ResultPoint;
import com.journeyapps.barcodescanner.BarcodeCallback;
import com.journeyapps.barcodescanner.BarcodeResult;
import com.journeyapps.barcodescanner.BarcodeView;
import com.journeyapps.barcodescanner.CameraPreview;
import com.journeyapps.barcodescanner.ViewfinderView;
import com.journeyapps.barcodescanner.camera.CameraSettings;

import java.util.List;

/** Local camera/decoder only. The caller retains the household, list and authenticated session. */
@SuppressWarnings("deprecation")
public class NativeScanActivity extends Activity {
    static final int CAMERA_PERMISSION = 731;
    private BarcodeView preview;
    private boolean resumed;
    private boolean permissionRequested;
    private boolean completed;
    private String requestedCamera;

    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(AppAppearance.themedContext(base));
    }

    @Override public void onCreate(Bundle state) {
        setTheme(AppAppearance.isDark(this) ? R.style.AppThemeDark : R.style.AppTheme);
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        requestedCamera = getIntent().getStringExtra("camera");
        if (requestedCamera == null) requestedCamera = "environment";
        if (!"environment".equals(requestedCamera) && !"user".equals(requestedCamera)) {
            finishWithError(R.string.native_scan_invalid_camera);
            return;
        }
        permissionRequested = state != null && state.getBoolean("permissionRequested");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setContentView(R.layout.native_scan);
        MainActivity.applyInsets(findViewById(R.id.native_scan_root));
        ((TextView) findViewById(R.id.native_scan_camera)).setText("user".equals(requestedCamera)
                ? R.string.native_scan_front : R.string.native_scan_rear);
        findViewById(R.id.native_scan_cancel).setOnClickListener(view -> cancelScan());
        preview = findViewById(R.id.native_scan_preview);
        ViewfinderView finder = findViewById(R.id.native_scan_finder);
        finder.setCameraPreview(preview);
        preview.addStateListener(new CameraPreview.StateListener() {
            @Override public void previewSized() {}
            @Override public void previewStarted() {}
            @Override public void previewStopped() {}
            @Override public void cameraClosed() {}
            @Override public void cameraError(Exception error) {
                if (resumed && !completed) finishWithError(R.string.native_scan_camera_error);
            }
        });
        // Continuous decoding ignores unusable QR/text payloads and waits for an actual product code.
        preview.decodeContinuous(new BarcodeCallback() {
            @Override public void barcodeResult(BarcodeResult result) {
                if (result != null) acceptBarcode(result.getText());
            }
            @Override public void possibleResultPoints(List<ResultPoint> points) {
                for (ResultPoint point : points) finder.addPossibleResultPoint(point);
            }
        });
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        if (completed || preview == null) return;
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) startCamera();
        else if (!permissionRequested) {
            permissionRequested = true;
            requestPermissions(new String[]{Manifest.permission.CAMERA}, CAMERA_PERMISSION);
        }
    }

    @Override protected void onPause() {
        resumed = false;
        // Wait for release before returning to the WebView, including when permission or another app pauses us.
        if (preview != null) preview.pauseAndWait();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("permissionRequested", permissionRequested);
        super.onSaveInstanceState(state);
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode != CAMERA_PERMISSION || completed) return;
        if (results.length == 0 || results[0] != PackageManager.PERMISSION_GRANTED) {
            finishWithError(R.string.native_scan_permission_error);
        } else if (resumed) startCamera();
    }

    private void startCamera() {
        if (completed || preview == null || preview.getCameraInstance() != null || !resumed) return;
        try {
            int cameraId = findCameraId(requestedCamera);
            if (cameraId < 0) {
                finishWithError("user".equals(requestedCamera)
                        ? R.string.native_scan_no_front : R.string.native_scan_no_rear);
                return;
            }
            CameraSettings settings = new CameraSettings();
            settings.setRequestedCameraId(cameraId);
            settings.setAutoFocusEnabled(true);
            settings.setContinuousFocusEnabled(false);
            settings.setFocusMode(CameraSettings.FocusMode.AUTO);
            // JourneyApps AutoFocusManager triggers camera.autoFocus now, then every two seconds.
            // It falls back to supported macro/fixed settings on devices without autofocus.
            preview.setCameraSettings(settings);
            preview.resume();
        } catch (RuntimeException error) {
            finishWithError(R.string.native_scan_camera_error);
        }
    }

    /** Camera IDs are not facing constants: a front camera may be ID 0 on a wall tablet. */
    static int findCameraId(String mode) {
        if (!"environment".equals(mode) && !"user".equals(mode)) return -1;
        int facing = "user".equals(mode) ? Camera.CameraInfo.CAMERA_FACING_FRONT : Camera.CameraInfo.CAMERA_FACING_BACK;
        Camera.CameraInfo info = new Camera.CameraInfo();
        for (int id = 0; id < Camera.getNumberOfCameras(); id++) {
            Camera.getCameraInfo(id, info);
            if (info.facing == facing) return id;
        }
        return -1; // Never silently open the opposite camera.
    }

    static boolean validCode(String code) {
        if (code == null || code.trim().isEmpty() || code.length() > 80) return false;
        for (int index = 0; index < code.length(); index++) {
            if (Character.isISOControl(code.charAt(index))) return false;
        }
        return true;
    }

    void acceptBarcode(String code) {
        if (!resumed || completed || isFinishing() || isDestroyed() || !validCode(code)) return;
        completed = true;
        releaseCamera();
        setResult(RESULT_OK, new Intent().putExtra("code", code.trim()));
        finish();
    }

    void finishWithError(int message) {
        if (completed || isFinishing() || isDestroyed()) return;
        completed = true;
        releaseCamera();
        setResult(RESULT_OK, new Intent().putExtra("error", getString(message)));
        finish();
    }

    private void cancelScan() {
        if (completed) return;
        completed = true;
        releaseCamera();
        setResult(RESULT_CANCELED);
        finish();
    }

    private void releaseCamera() {
        if (preview != null) {
            preview.stopDecoding();
            preview.pauseAndWait();
        }
    }
}
