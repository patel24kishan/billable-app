package com.billable.app.util

import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

object TimeFormat {
    /** Seconds -> "H:MM:SS". */
    fun duration(totalSeconds: Long): String {
        val s = totalSeconds.coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val sec = s % 60
        return String.format(Locale.US, "%d:%02d:%02d", h, m, sec)
    }

    /** Seconds -> decimal hours, e.g. 90 minutes -> 1.5. */
    fun hoursFromSeconds(totalSeconds: Long): Double = Math.round((totalSeconds / 3600.0) * 100.0) / 100.0

    fun todayDateString(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(java.util.Date())

    fun formatDateShort(yyyyMmDd: String): String {
        return try {
            val parts = yyyyMmDd.split("-").map { it.toInt() }
            val cal = Calendar.getInstance()
            cal.set(parts[0], parts[1] - 1, parts[2])
            SimpleDateFormat("MMM d, yyyy", Locale.US).format(cal.time)
        } catch (e: Exception) { yyyyMmDd }
    }

    fun monthLabel(yyyyMm: String): String {
        return try {
            val parts = yyyyMm.split("-").map { it.toInt() }
            val cal = Calendar.getInstance()
            cal.set(parts[0], parts[1] - 1, 1)
            SimpleDateFormat("MMMM yyyy", Locale.US).format(cal.time)
        } catch (e: Exception) { yyyyMm }
    }

    /** ["start","end"] YYYY-MM-DD for a given YYYY-MM billing month. */
    fun monthRange(yyyyMm: String): Pair<String, String> {
        val parts = yyyyMm.split("-").map { it.toInt() }
        val year = parts[0]; val month = parts[1]
        val cal = Calendar.getInstance()
        cal.set(year, month - 1, 1)
        val start = String.format(Locale.US, "%04d-%02d-01", year, month)
        val lastDay = cal.getActualMaximum(Calendar.DAY_OF_MONTH)
        val end = String.format(Locale.US, "%04d-%02d-%02d", year, month, lastDay)
        return Pair(start, end)
    }

    fun currentYearMonth(): String = SimpleDateFormat("yyyy-MM", Locale.US).format(java.util.Date())
}
