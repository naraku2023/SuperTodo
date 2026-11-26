package com.dax.supertodo;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.media.RingtoneManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ReminderScheduler {
    public static final String CHANNEL_ID = "supertodo_reminders_high";
    public static final String ACTION_MORNING = "com.dax.supertodo.ACTION_MORNING_BRIEFING";
    public static final String ACTION_EVENING = "com.dax.supertodo.ACTION_EVENING_REVIEW";
    public static final String ACTION_TASK = "com.dax.supertodo.ACTION_TASK_REMINDER";

    private static final int REQ_MORNING = 1001;
    private static final int REQ_EVENING = 1002;
    private static final int REQ_TASK_BASE = 2000;
    private static final int MAX_TASK_ALARMS = 20;

    private ReminderScheduler() {}

    public static void ensureNotificationChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "超级清单 · 高优定时提醒",
                NotificationManager.IMPORTANCE_HIGH
        );
        ch.setDescription("每日早报、晚间复盘及事项到点悬浮通知");
        ch.enableLights(true);
        ch.setLightColor(Color.parseColor("#0B57D0"));
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 260, 140, 260});
        ch.setLockscreenVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION), null);
        nm.createNotificationChannel(ch);
    }

    public static void scheduleAll(Context ctx) {
        ensureNotificationChannel(ctx);
        cancelAllAlarms(ctx);

        try {
            JSONObject cfg = new JSONObject(NativeStore.getReminderConfig(ctx));
            if (!cfg.optBoolean("enabled", true)) return;

            if (cfg.optBoolean("morningEnabled", true)) {
                scheduleDaily(ctx, ACTION_MORNING, REQ_MORNING, cfg.optString("morningTime", "08:30"), false);
            }
            if (cfg.optBoolean("eveningEnabled", true)) {
                scheduleDaily(ctx, ACTION_EVENING, REQ_EVENING, cfg.optString("eveningTime", "21:00"), false);
            }

            JSONArray tasks = cfg.optJSONArray("taskAlarms");
            if (tasks != null) {
                long now = System.currentTimeMillis();
                int count = Math.min(tasks.length(), MAX_TASK_ALARMS);
                for (int i = 0; i < count; i++) {
                    JSONObject item = tasks.optJSONObject(i);
                    if (item == null) continue;
                    long triggerAt = item.optLong("triggerAt", 0L);
                    if (triggerAt <= now + 5000L) continue;

                    Intent intent = new Intent(ctx, ReminderReceiver.class);
                    intent.setAction(ACTION_TASK);
                    intent.putExtra("task_id", item.optString("id"));
                    intent.putExtra("task_title", item.optString("title", "待办事项提醒"));
                    intent.putExtra("task_detail", item.optString("detail", "事项时间已到"));

                    PendingIntent pi = PendingIntent.getBroadcast(
                            ctx,
                            REQ_TASK_BASE + i,
                            intent,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    );
                    setExactAlarmSafe(ctx, triggerAt, pi);
                }
            }
        } catch (Exception ignore) {}
    }

    public static void scheduleDaily(Context ctx, String action, int reqCode, String hhmm, boolean forceTomorrow) {
        int hour = 8;
        int minute = 30;
        try {
            String[] parts = hhmm.split(":");
            hour = Integer.parseInt(parts[0]);
            minute = Integer.parseInt(parts[1]);
        } catch (Exception ignore) {}

        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (forceTomorrow || cal.getTimeInMillis() <= System.currentTimeMillis() + 5000L) {
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }

        Intent intent = new Intent(ctx, ReminderReceiver.class);
        intent.setAction(action);
        PendingIntent pi = PendingIntent.getBroadcast(
                ctx,
                reqCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        setExactAlarmSafe(ctx, cal.getTimeInMillis(), pi);
    }

    private static void cancelAllAlarms(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        cancelOne(ctx, am, ACTION_MORNING, REQ_MORNING);
        cancelOne(ctx, am, ACTION_EVENING, REQ_EVENING);
        for (int i = 0; i < MAX_TASK_ALARMS; i++) {
            cancelOne(ctx, am, ACTION_TASK, REQ_TASK_BASE + i);
        }
    }

    private static void cancelOne(Context ctx, AlarmManager am, String action, int reqCode) {
        try {
            Intent i = new Intent(ctx, ReminderReceiver.class);
            i.setAction(action);
            PendingIntent pi = PendingIntent.getBroadcast(
                    ctx,
                    reqCode,
                    i,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            );
            if (pi != null) {
                am.cancel(pi);
                pi.cancel();
            }
        } catch (Exception ignore) {}
    }

    private static void setExactAlarmSafe(Context ctx, long triggerAtMillis, PendingIntent pi) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
            }
        } catch (SecurityException se) {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                } else {
                    am.set(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi);
                }
            } catch (Exception ignore) {}
        }
    }

    public static void fireBriefingNotification(Context ctx, boolean isMorning) {
        ensureNotificationChannel(ctx);
        try {
            JSONObject widget = new JSONObject(NativeStore.getWidgetJson(ctx));
            int overdue = widget.optInt("overdueCount", 0);
            int today = widget.optInt("todayCount", 0);
            int tomorrow = widget.optInt("tomorrowCount", 0);
            int doneToday = widget.optInt("doneTodayCount", 0);
            int active = widget.optInt("activeCount", 0);
            JSONArray items = widget.optJSONArray("items");

            String title;
            String summary;
            StringBuilder detail = new StringBuilder();

            if (isMorning) {
                title = overdue > 0
                        ? "🚨 超级清单 · 有 " + overdue + " 项已逾期"
                        : "☀️ 超级清单 · 今日待办早报";
                if (overdue == 0 && today == 0) {
                    summary = active > 0 ? "今日无硬性截止，当前共有 " + active + " 项活跃待办" : "今日待办已清零，轻松开启新的一天！";
                } else {
                    summary = (overdue > 0 ? "已逾期 " + overdue + " 项 · " : "") + "今日聚焦 " + today + " 项待处理";
                }
                detail.append(summary);
                if (items != null && items.length() > 0) {
                    int n = Math.min(3, items.length());
                    for (int i = 0; i < n; i++) {
                        JSONObject it = items.optJSONObject(i);
                        if (it != null) {
                            detail.append("\n• ").append(it.optString("title"));
                        }
                    }
                }
                postNotification(ctx, 3001, title, summary, detail.toString(), "open_today");
            } else {
                title = "🌙 超级清单 · 晚间复盘提醒";
                summary = "今日已完成 " + doneToday + " 项 · 明日到期 " + tomorrow + " 项 · 剩余活跃 " + active + " 项";
                detail.append(summary);
                if (items != null && items.length() > 0) {
                    JSONObject first = items.optJSONObject(0);
                    if (first != null) {
                        detail.append("\n优先关注：").append(first.optString("title"));
                    }
                }
                postNotification(ctx, 3002, title, summary, detail.toString(), "open_today");
            }
        } catch (Exception e) {
            postNotification(
                    ctx,
                    isMorning ? 3001 : 3002,
                    isMorning ? "☀️ 超级清单 · 今日待办早报" : "🌙 超级清单 · 晚间复盘提醒",
                    "点击查看今日待办安排与清单进展",
                    "点击查看今日待办安排与清单进展",
                    "open_today"
            );
        }
    }

    public static void fireTaskNotification(Context ctx, String taskId, String title, String detail) {
        ensureNotificationChannel(ctx);
        int nid = 4000 + Math.abs((taskId == null ? "0" : taskId).hashCode() % 500);
        postNotification(
                ctx,
                nid,
                "⏰ 到点提醒：" + title,
                detail,
                detail,
                "open_task:" + (taskId == null ? "" : taskId)
        );
    }

    public static void sendTestNotification(Context ctx) {
        ensureNotificationChannel(ctx);
        String body = "如果你看到这条顶部悬浮通知并感受到震动，说明小米提醒通道已配置成功！";
        postNotification(ctx, 3999, "🔔 超级清单 · 提醒测试成功", body, body, "open_today");
    }

    private static void postNotification(Context ctx, int nid, String title, String shortText, String bigText, String nativeAction) {
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent openIntent = new Intent(ctx, MainActivity.class);
        openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("native_action", nativeAction);

        PendingIntent contentPi = PendingIntent.getActivity(
                ctx,
                nid,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        int iconRes = ctx.getApplicationInfo().icon != 0 ? ctx.getApplicationInfo().icon : android.R.drawable.ic_popup_reminder;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(iconRes)
                .setContentTitle(title)
                .setContentText(shortText)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(bigText))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setAutoCancel(true)
                .setContentIntent(contentPi);

        try {
            nm.notify(nid, builder.build());
        } catch (SecurityException ignore) {}
    }
}
