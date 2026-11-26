package com.dax.supertodo;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;

public class SuperTodoWidgetProvider extends AppWidgetProvider {
    public static final String ACTION_TOGGLE_TASK = "com.dax.supertodo.WIDGET_TOGGLE_TASK";
    public static final String ACTION_REFRESH_WIDGET = "com.dax.supertodo.WIDGET_REFRESH";

    private static final int[] ROW_IDS = {
            R.id.w_row_0, R.id.w_row_1, R.id.w_row_2,
            R.id.w_row_3, R.id.w_row_4, R.id.w_row_5
    };
    private static final int[] CHK_IDS = {
            R.id.w_chk_0, R.id.w_chk_1, R.id.w_chk_2,
            R.id.w_chk_3, R.id.w_chk_4, R.id.w_chk_5
    };
    private static final int[] DOT_IDS = {
            R.id.w_dot_0, R.id.w_dot_1, R.id.w_dot_2,
            R.id.w_dot_3, R.id.w_dot_4, R.id.w_dot_5
    };
    private static final int[] TITLE_IDS = {
            R.id.w_title_0, R.id.w_title_1, R.id.w_title_2,
            R.id.w_title_3, R.id.w_title_4, R.id.w_title_5
    };
    private static final int[] META_IDS = {
            R.id.w_meta_0, R.id.w_meta_1, R.id.w_meta_2,
            R.id.w_meta_3, R.id.w_meta_4, R.id.w_meta_5
    };

    public static void refreshAllWidgets(Context context) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(context);
            ComponentName cn = new ComponentName(context, SuperTodoWidgetProvider.class);
            int[] ids = mgr.getAppWidgetIds(cn);
            if (ids != null && ids.length > 0) {
                for (int appWidgetId : ids) {
                    updateAppWidget(context, mgr, appWidgetId);
                }
            }
        } catch (Exception ignore) {}
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        if (ACTION_TOGGLE_TASK.equals(action)) {
            String taskId = intent.getStringExtra("task_id");
            if (taskId != null && !taskId.isEmpty()) {
                NativeStore.addPendingWidgetToggle(context, taskId);
                NativeStore.markTaskDoneLocallyInWidgetJson(context, taskId);
                refreshAllWidgets(context);
            }
        } else if (ACTION_REFRESH_WIDGET.equals(action) || Intent.ACTION_DATE_CHANGED.equals(action)) {
            refreshAllWidgets(context);
        }
    }

    private static void updateAppWidget(Context context, AppWidgetManager mgr, int appWidgetId) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_supertodo);

        // 点击头部打开今日聚焦视图
        Intent openTodayIntent = new Intent(context, MainActivity.class);
        openTodayIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openTodayIntent.putExtra("native_action", "open_today");
        PendingIntent openTodayPi = PendingIntent.getActivity(
                context, 5001, openTodayIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.w_header_left, openTodayPi);

        // 刷新按钮
        Intent refreshIntent = new Intent(context, SuperTodoWidgetProvider.class);
        refreshIntent.setAction(ACTION_REFRESH_WIDGET);
        PendingIntent refreshPi = PendingIntent.getBroadcast(
                context, 5002, refreshIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.w_btn_refresh, refreshPi);

        // 快速新建按钮
        Intent addIntent = new Intent(context, MainActivity.class);
        addIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        addIntent.putExtra("native_action", "quick_add");
        PendingIntent addPi = PendingIntent.getActivity(
                context, 5003, addIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.w_btn_add, addPi);

        // 解析待办数据并填充 6 行槽位
        JSONArray items = new JSONArray();
        int overdue = 0;
        int today = 0;
        int active = 0;
        try {
            JSONObject root = new JSONObject(NativeStore.getWidgetJson(context));
            overdue = root.optInt("overdueCount", 0);
            today = root.optInt("todayCount", 0);
            active = root.optInt("activeCount", 0);
            JSONArray parsedItems = root.optJSONArray("items");
            if (parsedItems != null) items = parsedItems;
        } catch (Exception ignore) {}

        if (overdue > 0) {
            views.setTextViewText(R.id.w_summary_badge, "逾期 " + overdue + " · 今日 " + today);
            views.setTextColor(R.id.w_summary_badge, ContextCompat.getColor(context, R.color.widget_danger));
        } else if (today > 0) {
            views.setTextViewText(R.id.w_summary_badge, "今日 " + today + " 项");
            views.setTextColor(R.id.w_summary_badge, ContextCompat.getColor(context, R.color.widget_primary));
        } else if (active > 0) {
            views.setTextViewText(R.id.w_summary_badge, "待办 " + active + " 项");
            views.setTextColor(R.id.w_summary_badge, ContextCompat.getColor(context, R.color.widget_text2));
        } else {
            views.setTextViewText(R.id.w_summary_badge, "今日已清零");
            views.setTextColor(R.id.w_summary_badge, ContextCompat.getColor(context, R.color.widget_success));
        }

        if (items.length() == 0) {
            views.setViewVisibility(R.id.w_empty, View.VISIBLE);
            for (int i = 0; i < ROW_IDS.length; i++) {
                views.setViewVisibility(ROW_IDS[i], View.GONE);
            }
        } else {
            views.setViewVisibility(R.id.w_empty, View.GONE);
            for (int i = 0; i < ROW_IDS.length; i++) {
                if (i < items.length()) {
                    JSONObject it = items.optJSONObject(i);
                    if (it == null) {
                        views.setViewVisibility(ROW_IDS[i], View.GONE);
                        continue;
                    }
                    views.setViewVisibility(ROW_IDS[i], View.VISIBLE);

                    String tid = it.optString("id");
                    String title = it.optString("title", "未命名事项");
                    String meta = it.optString("meta", "");
                    String prio = it.optString("priority", "medium");
                    boolean isOver = it.optBoolean("overdue", false);

                    views.setTextViewText(TITLE_IDS[i], title);
                    views.setTextViewText(META_IDS[i], meta);
                    views.setTextColor(META_IDS[i], ContextCompat.getColor(context, isOver ? R.color.widget_danger : R.color.widget_text2));
                    views.setImageViewResource(DOT_IDS[i], getDotDrawable(prio));

                    // 勾选直接完成
                    Intent toggleIntent = new Intent(context, SuperTodoWidgetProvider.class);
                    toggleIntent.setAction(ACTION_TOGGLE_TASK);
                    toggleIntent.putExtra("task_id", tid);
                    PendingIntent togglePi = PendingIntent.getBroadcast(
                            context, 6000 + i, toggleIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    views.setOnClickPendingIntent(CHK_IDS[i], togglePi);

                    // 点击行直达事项详情
                    Intent detailIntent = new Intent(context, MainActivity.class);
                    detailIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                    detailIntent.putExtra("native_action", "open_task:" + tid);
                    PendingIntent detailPi = PendingIntent.getActivity(
                            context, 7000 + i, detailIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
                    views.setOnClickPendingIntent(ROW_IDS[i], detailPi);
                } else {
                    views.setViewVisibility(ROW_IDS[i], View.GONE);
                }
            }
        }

        mgr.updateAppWidget(appWidgetId, views);
    }

    private static int getDotDrawable(String priority) {
        if ("urgent".equals(priority)) return R.drawable.widget_dot_urgent;
        if ("high".equals(priority)) return R.drawable.widget_dot_high;
        if ("low".equals(priority)) return R.drawable.widget_dot_low;
        return R.drawable.widget_dot_medium;
    }
}
