package com.dax.supertodo;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;

public final class NativeStore {
    private static final String PREF = "supertodo_native_prefs";
    private static final String KEY_WIDGET_JSON = "widget_json";
    private static final String KEY_REMINDER_JSON = "reminder_json";
    private static final String KEY_WIDGET_TOGGLES = "widget_toggles";
    private static final String KEY_PENDING_ACTION = "pending_action";

    private NativeStore() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static void saveWidgetJson(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_WIDGET_JSON, json == null ? "{}" : json).apply();
    }

    public static String getWidgetJson(Context ctx) {
        return prefs(ctx).getString(KEY_WIDGET_JSON, "{}");
    }

    public static void saveReminderConfig(Context ctx, String json) {
        prefs(ctx).edit().putString(KEY_REMINDER_JSON, json == null ? "{}" : json).apply();
    }

    public static String getReminderConfig(Context ctx) {
        return prefs(ctx).getString(KEY_REMINDER_JSON, "{}");
    }

    public static synchronized void addPendingWidgetToggle(Context ctx, String taskId) {
        if (taskId == null || taskId.trim().isEmpty()) return;
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString(KEY_WIDGET_TOGGLES, "[]"));
            for (int i = 0; i < arr.length(); i++) {
                if (taskId.equals(arr.optString(i))) return;
            }
            arr.put(taskId);
            prefs(ctx).edit().putString(KEY_WIDGET_TOGGLES, arr.toString()).apply();
        } catch (Exception ignore) {}
    }

    public static synchronized String consumePendingWidgetToggles(Context ctx) {
        String raw = prefs(ctx).getString(KEY_WIDGET_TOGGLES, "[]");
        prefs(ctx).edit().putString(KEY_WIDGET_TOGGLES, "[]").apply();
        return raw;
    }

    public static void setPendingAction(Context ctx, String action) {
        if (action == null) action = "";
        prefs(ctx).edit().putString(KEY_PENDING_ACTION, action).apply();
    }

    public static String consumePendingAction(Context ctx) {
        String val = prefs(ctx).getString(KEY_PENDING_ACTION, "");
        prefs(ctx).edit().remove(KEY_PENDING_ACTION).apply();
        return val;
    }

    /**
     * 在桌面小组件点击完成某条待办时，立即本地更新缓存以实现零延迟重绘
     */
    public static synchronized void markTaskDoneLocallyInWidgetJson(Context ctx, String taskId) {
        if (taskId == null || taskId.isEmpty()) return;
        try {
            JSONObject root = new JSONObject(getWidgetJson(ctx));
            JSONArray items = root.optJSONArray("items");
            if (items == null) return;
            JSONArray nextItems = new JSONArray();
            int overdueCount = root.optInt("overdueCount", 0);
            int todayCount = root.optInt("todayCount", 0);
            int activeCount = root.optInt("activeCount", items.length());
            int doneTodayCount = root.optInt("doneTodayCount", 0);

            for (int i = 0; i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                if (taskId.equals(it.optString("id"))) {
                    if (it.optBoolean("overdue", false) && overdueCount > 0) overdueCount--;
                    if (it.optBoolean("dueToday", false) && todayCount > 0) todayCount--;
                    if (activeCount > 0) activeCount--;
                    doneTodayCount++;
                } else {
                    nextItems.put(it);
                }
            }

            root.put("items", nextItems);
            root.put("overdueCount", overdueCount);
            root.put("todayCount", todayCount);
            root.put("activeCount", activeCount);
            root.put("doneTodayCount", doneTodayCount);
            saveWidgetJson(ctx, root.toString());
        } catch (Exception ignore) {}
    }
}
