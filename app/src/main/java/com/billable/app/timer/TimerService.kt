package com.billable.app.timer

import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import android.content.pm.ServiceInfo
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.billable.app.BillableApp
import com.billable.app.MainActivity
import com.billable.app.R
import com.billable.app.data.DbHelper
import com.billable.app.prefs.TimerPrefs
import com.billable.app.prefs.TimerSnapshot
import com.billable.app.prefs.TimerStatus
import com.billable.app.util.TimeFormat
import com.billable.app.widget.TimerWidgetProvider

/**
 * Single source of truth for the active timer session. The app UI, the
 * persistent notification, and the home-screen widget all issue commands to
 * this service rather than editing [TimerPrefs] directly, so state changes
 * always go through one place and every surface stays in sync.
 */
class TimerService : Service() {

    override fun onBind(intent: Intent?) = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        var snap = TimerPrefs.get(this)
        val now = System.currentTimeMillis()

        snap = when (action) {
            ACTION_START -> {
                if (snap.status == TimerStatus.IDLE) {
                    val clientId = intent.getLongExtra(EXTRA_CLIENT_ID, -1)
                    val clientName = intent.getStringExtra(EXTRA_CLIENT_NAME) ?: ""
                    val description = intent.getStringExtra(EXTRA_DESCRIPTION) ?: ""
                    if (clientId <= 0) {
                        openAppInstead(); snap
                    } else {
                        TimerSnapshot(TimerStatus.RUNNING, clientId, clientName, description, 0, now, now)
                    }
                } else snap
            }
            ACTION_PAUSE -> {
                if (snap.status == TimerStatus.RUNNING) snap.copy(status = TimerStatus.PAUSED, accumulatedSeconds = snap.elapsedSeconds(), segmentStartedAtMillis = 0)
                else snap
            }
            ACTION_RESUME -> {
                if (snap.status == TimerStatus.PAUSED || snap.status == TimerStatus.STOPPED) snap.copy(status = TimerStatus.RUNNING, segmentStartedAtMillis = now)
                else snap
            }
            ACTION_STOP -> {
                if (snap.status == TimerStatus.RUNNING || snap.status == TimerStatus.PAUSED) snap.copy(status = TimerStatus.STOPPED, accumulatedSeconds = snap.elapsedSeconds(), segmentStartedAtMillis = 0)
                else snap
            }
            ACTION_SAVE -> {
                if (snap.status == TimerStatus.STOPPED) {
                    val seconds = snap.elapsedSeconds()
                    if (seconds >= 1) {
                        val db = DbHelper(this)
                        val date = if (snap.startedAtMillis > 0)
                            SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(snap.startedAtMillis))
                        else TimeFormat.todayDateString()
                        db.insertTimeEntry(snap.clientId, snap.clientName, date, snap.description, seconds)
                    }
                    TimerSnapshot.IDLE
                } else snap
            }
            ACTION_DISCARD -> TimerSnapshot.IDLE
            ACTION_UPDATE_DESCRIPTION -> {
                if (snap.status != TimerStatus.IDLE) snap.copy(description = intent?.getStringExtra(EXTRA_DESCRIPTION) ?: snap.description)
                else snap
            }
            else -> snap
        }

        TimerPrefs.save(this, snap)
        TimerWidgetProvider.updateAll(this)
        sendBroadcast(Intent(ACTION_TIMER_CHANGED).setPackage(packageName))

        if (snap.status == TimerStatus.IDLE) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
        } else {
            ServiceCompat.startForeground(
                this, NOTIFICATION_ID, buildNotification(snap),
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        }
        return START_NOT_STICKY
    }

    private fun openAppInstead() {
        val i = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        startActivity(i)
    }

    private fun buildNotification(snap: TimerSnapshot): android.app.Notification {
        val contentIntent = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = when (snap.status) {
            TimerStatus.RUNNING -> "Tracking — ${snap.clientName}"
            TimerStatus.PAUSED -> "Paused — ${snap.clientName}"
            TimerStatus.STOPPED -> "Ready to save — ${snap.clientName}"
            else -> "Billable"
        }

        val builder = NotificationCompat.Builder(this, BillableApp.CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        if (snap.status == TimerStatus.RUNNING) {
            builder.setUsesChronometer(true)
            builder.setWhen(System.currentTimeMillis() - snap.accumulatedSeconds * 1000)
            builder.addAction(0, "Pause", actionPendingIntent(ACTION_PAUSE))
            builder.addAction(0, "Stop", actionPendingIntent(ACTION_STOP))
        } else if (snap.status == TimerStatus.PAUSED) {
            builder.setUsesChronometer(false)
            builder.setContentText("Paused at ${TimeFormat.duration(snap.elapsedSeconds())}")
            builder.addAction(0, "Resume", actionPendingIntent(ACTION_RESUME))
            builder.addAction(0, "Stop", actionPendingIntent(ACTION_STOP))
        } else if (snap.status == TimerStatus.STOPPED) {
            builder.setUsesChronometer(false)
            builder.setContentText("${TimeFormat.duration(snap.elapsedSeconds())} — tap Save in the app")
            builder.addAction(0, "Resume", actionPendingIntent(ACTION_RESUME))
            builder.addAction(0, "Save", actionPendingIntent(ACTION_SAVE))
        }

        return builder.build()
    }

    private fun actionPendingIntent(action: String): PendingIntent {
        val i = Intent(this, TimerService::class.java).setAction(action)
        return PendingIntent.getService(this, action.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    companion object {
        const val ACTION_START = "com.billable.app.action.START"
        const val ACTION_PAUSE = "com.billable.app.action.PAUSE"
        const val ACTION_RESUME = "com.billable.app.action.RESUME"
        const val ACTION_STOP = "com.billable.app.action.STOP"
        const val ACTION_SAVE = "com.billable.app.action.SAVE"
        const val ACTION_DISCARD = "com.billable.app.action.DISCARD"
        const val ACTION_UPDATE_DESCRIPTION = "com.billable.app.action.UPDATE_DESCRIPTION"
        const val ACTION_TIMER_CHANGED = "com.billable.app.action.TIMER_CHANGED"

        const val EXTRA_CLIENT_ID = "client_id"
        const val EXTRA_CLIENT_NAME = "client_name"
        const val EXTRA_DESCRIPTION = "description"

        private const val NOTIFICATION_ID = 42
    }
}
