package com.billable.app.prefs

import android.content.Context

/** The timer's state machine. IDLE -> RUNNING <-> PAUSED -> STOPPED (reviewing) -> (Save) -> IDLE. */
enum class TimerStatus { IDLE, RUNNING, PAUSED, STOPPED }

data class TimerSnapshot(
    val status: TimerStatus,
    val clientId: Long,
    val clientName: String,
    val description: String,
    val accumulatedSeconds: Long,
    val segmentStartedAtMillis: Long, // 0 = not running
    val startedAtMillis: Long // first Start of this session; used as the saved entry's date
) {
    /** Live elapsed seconds, including the in-progress segment if running. */
    fun elapsedSeconds(): Long {
        var total = accumulatedSeconds
        if (status == TimerStatus.RUNNING && segmentStartedAtMillis > 0) {
            total += (System.currentTimeMillis() - segmentStartedAtMillis) / 1000
        }
        return total
    }

    companion object {
        val IDLE = TimerSnapshot(TimerStatus.IDLE, -1, "", "", 0, 0, 0)
    }
}

/**
 * Persists the single, app-wide active timer session so the foreground
 * service, the widget, and the app's UI all agree on the current state.
 * A real single-writer lock isn't needed here: only one of those three
 * ever changes it at a time, always by asking TimerService to do it.
 */
object TimerPrefs {
    private const val FILE = "billable_timer"
    private const val KEY_STATUS = "status"
    private const val KEY_CLIENT_ID = "client_id"
    private const val KEY_CLIENT_NAME = "client_name"
    private const val KEY_DESCRIPTION = "description"
    private const val KEY_ACCUMULATED = "accumulated_seconds"
    private const val KEY_SEGMENT_STARTED = "segment_started_at"
    private const val KEY_STARTED_AT = "started_at"
    private const val KEY_LAST_CLIENT_ID = "last_client_id"
    private const val KEY_LAST_CLIENT_NAME = "last_client_name"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun get(ctx: Context): TimerSnapshot {
        val p = prefs(ctx)
        val statusName = p.getString(KEY_STATUS, TimerStatus.IDLE.name) ?: TimerStatus.IDLE.name
        val status = try { TimerStatus.valueOf(statusName) } catch (e: IllegalArgumentException) { TimerStatus.IDLE }
        return TimerSnapshot(
            status = status,
            clientId = p.getLong(KEY_CLIENT_ID, -1),
            clientName = p.getString(KEY_CLIENT_NAME, "") ?: "",
            description = p.getString(KEY_DESCRIPTION, "") ?: "",
            accumulatedSeconds = p.getLong(KEY_ACCUMULATED, 0),
            segmentStartedAtMillis = p.getLong(KEY_SEGMENT_STARTED, 0),
            startedAtMillis = p.getLong(KEY_STARTED_AT, 0)
        )
    }

    fun save(ctx: Context, snap: TimerSnapshot) {
        prefs(ctx).edit()
            .putString(KEY_STATUS, snap.status.name)
            .putLong(KEY_CLIENT_ID, snap.clientId)
            .putString(KEY_CLIENT_NAME, snap.clientName)
            .putString(KEY_DESCRIPTION, snap.description)
            .putLong(KEY_ACCUMULATED, snap.accumulatedSeconds)
            .putLong(KEY_SEGMENT_STARTED, snap.segmentStartedAtMillis)
            .putLong(KEY_STARTED_AT, snap.startedAtMillis)
            .apply()
        if (snap.clientId > 0) {
            prefs(ctx).edit()
                .putLong(KEY_LAST_CLIENT_ID, snap.clientId)
                .putString(KEY_LAST_CLIENT_NAME, snap.clientName)
                .apply()
        }
    }

    /** The client the widget starts a new session for when tapped from idle. */
    fun getLastClientId(ctx: Context): Long = prefs(ctx).getLong(KEY_LAST_CLIENT_ID, -1)
    fun getLastClientName(ctx: Context): String = prefs(ctx).getString(KEY_LAST_CLIENT_NAME, "") ?: ""
}
