package com.dax.supertodo;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import org.json.JSONObject;

public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        if (ReminderScheduler.ACTION_MORNING.equals(action)) {
            ReminderScheduler.fireBriefingNotification(context, true);
            try {
                JSONObject cfg = new JSONObject(NativeStore.getReminderConfig(context));
                if (cfg.optBoolean("enabled", true) && cfg.optBoolean("morningEnabled", true)) {
                    ReminderScheduler.scheduleDaily(context, ReminderScheduler.ACTION_MORNING, 1001, cfg.optString("morningTime", "08:30"), true);
                }
            } catch (Exception ignore) {}
        } else if (ReminderScheduler.ACTION_EVENING.equals(action)) {
            ReminderScheduler.fireBriefingNotification(context, false);
            try {
                JSONObject cfg = new JSONObject(NativeStore.getReminderConfig(context));
                if (cfg.optBoolean("enabled", true) && cfg.optBoolean("eveningEnabled", true)) {
                    ReminderScheduler.scheduleDaily(context, ReminderScheduler.ACTION_EVENING, 1002, cfg.optString("eveningTime", "21:00"), true);
                }
            } catch (Exception ignore) {}
        } else if (ReminderScheduler.ACTION_TASK.equals(action)) {
            String taskId = intent.getStringExtra("task_id");
            String title = intent.getStringExtra("task_title");
            String detail = intent.getStringExtra("task_detail");
            ReminderScheduler.fireTaskNotification(
                    context,
                    taskId,
                    title == null ? "待办提醒" : title,
                    detail == null ? "事项时间已到" : detail
            );
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_TIME_CHANGED.equals(action)
                || Intent.ACTION_TIMEZONE_CHANGED.equals(action)) {
            ReminderScheduler.scheduleAll(context);
            SuperTodoWidgetProvider.refreshAllWidgets(context);
        }
    }
}
