package com.billable.app.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.billable.app.MainActivity
import com.billable.app.R
import com.billable.app.prefs.TimerPrefs
import com.billable.app.prefs.TimerStatus
import com.billable.app.timer.TimerService
import com.billable.app.util.TimeFormat

/**
 * A 3-button home-screen widget for the timer: [Start/Resume] [Pause] [Stop/Save].
 * The middle and right buttons relabel themselves to match the current state;
 * every tap is routed to [TimerService], which is the only thing allowed to
 * change the timer's state, so the widget can never drift out of sync with
 * the app or the notification.
 */
class TimerWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        for (id in appWidgetIds) appWidgetManager.updateAppWidget(id, buildViews(context))
    }

    companion object {
        fun updateAll(context: Context) {
            val mgr = AppWidgetManager.getInstance(context)
            val ids = mgr.getAppWidgetIds(ComponentName(context, TimerWidgetProvider::class.java))
            if (ids.isNotEmpty()) {
                val views = buildViews(context)
                for (id in ids) mgr.updateAppWidget(id, views)
            }
        }

        private fun buildViews(context: Context): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_timer)
            val snap = TimerPrefs.get(context)

            val statusText = when (snap.status) {
                TimerStatus.IDLE -> {
                    val lastName = TimerPrefs.getLastClientName(context)
                    if (lastName.isNotBlank()) "Idle — tap Start for $lastName" else "Idle — open the app to pick a client"
                }
                TimerStatus.RUNNING -> "${snap.clientName} · ${TimeFormat.duration(snap.elapsedSeconds())}"
                TimerStatus.PAUSED -> "${snap.clientName} · Paused at ${TimeFormat.duration(snap.elapsedSeconds())}"
                TimerStatus.STOPPED -> "${snap.clientName} · ${TimeFormat.duration(snap.elapsedSeconds())} ready to save"
            }
            views.setTextViewText(R.id.widget_status, statusText)

            // Left button: Start (idle) or Resume (paused/stopped); disabled look while running.
            val primaryLabel = if (snap.status == TimerStatus.RUNNING) "Tracking…" else if (snap.status == TimerStatus.IDLE) "▶ Start" else "▶ Resume"
            views.setTextViewText(R.id.widget_btn_primary, primaryLabel)
            views.setOnClickPendingIntent(R.id.widget_btn_primary, primaryPendingIntent(context, snap.status))

            // Middle button: Pause — only meaningful while running.
            views.setTextViewText(R.id.widget_btn_pause, "⏸ Pause")
            views.setOnClickPendingIntent(R.id.widget_btn_pause, servicePendingIntent(context, TimerService.ACTION_PAUSE, 1))

            // Right button: Stop (running/paused) or Save (stopped).
            val rightLabel = if (snap.status == TimerStatus.STOPPED) "✓ Save" else "■ Stop"
            val rightAction = if (snap.status == TimerStatus.STOPPED) TimerService.ACTION_SAVE else TimerService.ACTION_STOP
            views.setTextViewText(R.id.widget_btn_stopsave, rightLabel)
            views.setOnClickPendingIntent(R.id.widget_btn_stopsave, servicePendingIntent(context, rightAction, 2))

            // Tapping the status line always opens the app (to switch clients, edit the note, etc).
            val openApp = PendingIntent.getActivity(
                context, 3, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widget_status, openApp)

            return views
        }

        private fun primaryPendingIntent(context: Context, status: TimerStatus): PendingIntent {
            return when (status) {
                TimerStatus.IDLE -> {
                    val lastId = TimerPrefs.getLastClientId(context)
                    val lastName = TimerPrefs.getLastClientName(context)
                    if (lastId > 0) {
                        val i = Intent(context, TimerService::class.java).setAction(TimerService.ACTION_START)
                            .putExtra(TimerService.EXTRA_CLIENT_ID, lastId)
                            .putExtra(TimerService.EXTRA_CLIENT_NAME, lastName)
                            .putExtra(TimerService.EXTRA_DESCRIPTION, "")
                        PendingIntent.getForegroundService(context, 0, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                    } else {
                        PendingIntent.getActivity(
                            context, 0, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                        )
                    }
                }
                TimerStatus.PAUSED, TimerStatus.STOPPED -> servicePendingIntent(context, TimerService.ACTION_RESUME, 0)
                TimerStatus.RUNNING -> servicePendingIntent(context, TimerService.ACTION_PAUSE, 0) // no-op-ish; already tracking
            }
        }

        private fun servicePendingIntent(context: Context, action: String, requestCode: Int): PendingIntent {
            val i = Intent(context, TimerService::class.java).setAction(action)
            return PendingIntent.getService(context, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
    }
}
