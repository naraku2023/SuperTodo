package com.dax.supertodo;

import android.app.AlarmManager;
import android.app.DownloadManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final int REQ_POST_NOTIF = 9101;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ReminderScheduler.ensureNotificationChannel(this);
        captureIntentAction(getIntent());

        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView wv = getBridge().getWebView();
                wv.addJavascriptInterface(new SuperTodoBridge(), "SuperTodoAndroid");
                wv.setDownloadListener(new DownloadListener() {
                    @Override
                    public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                        try {
                            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                            req.setTitle("SuperTodo 更新");
                            ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                        } catch (Exception ignore) {}
                    }
                });
            }
        } catch (Exception ignore) {}
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureIntentAction(intent);
        notifyWebView("window.__onSuperTodoNativeAction && window.__onSuperTodoNativeAction()");
    }

    @Override
    public void onResume() {
        super.onResume();
        notifyWebView("window.__onSuperTodoNativeResume && window.__onSuperTodoNativeResume()");
    }

    private void captureIntentAction(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra("native_action");
        if (action != null && !action.isEmpty()) {
            NativeStore.setPendingAction(this, action);
            intent.removeExtra("native_action");
        }
    }

    private void notifyWebView(final String js) {
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().post(() -> {
                    try {
                        getBridge().getWebView().evaluateJavascript(js, null);
                    } catch (Exception ignore) {}
                });
            }
        } catch (Exception ignore) {}
    }

    public class SuperTodoBridge {
        @JavascriptInterface
        public void syncWidgetData(String json) {
            NativeStore.saveWidgetJson(MainActivity.this, json);
            SuperTodoWidgetProvider.refreshAllWidgets(MainActivity.this);
        }

        @JavascriptInterface
        public void scheduleReminders(String json) {
            NativeStore.saveReminderConfig(MainActivity.this, json);
            ReminderScheduler.scheduleAll(MainActivity.this);
        }

        @JavascriptInterface
        public void sendTestNotification() {
            ReminderScheduler.sendTestNotification(MainActivity.this);
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= 33) {
                if (ContextCompat.checkSelfPermission(MainActivity.this, "android.permission.POST_NOTIFICATIONS")
                        != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(
                            MainActivity.this,
                            new String[]{"android.permission.POST_NOTIFICATIONS"},
                            REQ_POST_NOTIF
                    );
                }
            }
        }

        @JavascriptInterface
        public String consumeWidgetToggles() {
            return NativeStore.consumePendingWidgetToggles(MainActivity.this);
        }

        @JavascriptInterface
        public String consumePendingAction() {
            return NativeStore.consumePendingAction(MainActivity.this);
        }

        @JavascriptInterface
        public String getNativeStatus() {
            JSONObject obj = new JSONObject();
            try {
                boolean hasNotif = NotificationManagerCompat.from(MainActivity.this).areNotificationsEnabled();
                if (Build.VERSION.SDK_INT >= 33) {
                    hasNotif = hasNotif && ContextCompat.checkSelfPermission(
                            MainActivity.this, "android.permission.POST_NOTIFICATIONS") == PackageManager.PERMISSION_GRANTED;
                }
                boolean canExact = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                    canExact = am != null && am.canScheduleExactAlarms();
                }
                obj.put("isNative", true);
                obj.put("hasNotificationPerm", hasNotif);
                obj.put("canExactAlarm", canExact);
            } catch (Exception ignore) {}
            return obj.toString();
        }

        @JavascriptInterface
        public void openXiaomiPermission(String type) {
            String pkg = getPackageName();
            if ("alarm".equals(type) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (tryStartActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg)))) {
                    return;
                }
            }
            if ("notification".equals(type)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    Intent ni = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                    if (tryStartActivity(ni)) return;
                }
            }
            if ("battery".equals(type)) {
                Intent miuiPower = new Intent()
                        .setComponent(new ComponentName("com.miui.powerkeeper", "com.miui.powerkeeper.ui.HiddenAppsConfigActivity"))
                        .putExtra("package_name", pkg)
                        .putExtra("package_label", "超级清单");
                if (tryStartActivity(miuiPower)) return;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent bat = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    if (tryStartActivity(bat)) return;
                }
            }
            if ("autostart".equals(type)) {
                Intent miuiAuto = new Intent()
                        .setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
                if (tryStartActivity(miuiAuto)) return;
                Intent miuiPerm = new Intent("miui.intent.action.APP_PERM_EDITOR")
                        .putExtra("extra_pkgname", pkg);
                if (tryStartActivity(miuiPerm)) return;
            }
            // 通用降级：打开系统应用详情页
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
            tryStartActivity(details);
        }

        private boolean tryStartActivity(Intent i) {
            try {
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
