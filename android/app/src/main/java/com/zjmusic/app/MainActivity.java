package com.zjmusic.app;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Raw HTTP bridge (byte-exact responses, bypasses CapacitorHttp JSON parsing).
        // MUST be registered BEFORE super.onCreate(): BridgeActivity.onCreate creates the
        // bridge inside super, so registerPlugin() after super never reaches the bridge.
        registerPlugin(NativeHttpPlugin.class);
        super.onCreate(savedInstanceState);
        // Edge-to-edge: draw behind status bar and navigation bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat insetsController =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // Keep status bar icons visible (light or dark based on app theme)
        insetsController.setAppearanceLightStatusBars(false);
    }
}
