package com.billable.app.util

import android.content.Context
import android.net.Uri
import java.io.File

/**
 * Copies a picked receipt image into the app's private storage
 * (filesDir/receipts) so it survives independently of whatever the user does
 * to the original photo/download, and is reachable later — including from a
 * regenerated PDF — without needing to re-request permission to the original
 * content:// URI (which can expire).
 */
object ReceiptStore {
    private const val DIR = "receipts"

    /** "image/jpeg" or "image/png" if the picked file is one of those, else null. */
    fun acceptedMimeType(context: Context, uri: Uri): String? {
        val type = context.contentResolver.getType(uri)
        return if (type == "image/jpeg" || type == "image/png") type else null
    }

    /** Copies [uri] into private storage; returns a filesDir-relative path, or null on failure. */
    fun copyToReceipts(context: Context, uri: Uri, mimeType: String): String? {
        val ext = if (mimeType == "image/png") "png" else "jpg"
        val dir = File(context.filesDir, DIR).apply { mkdirs() }
        val dest = File(dir, "receipt_${System.currentTimeMillis()}.$ext")
        return try {
            context.contentResolver.openInputStream(uri)?.use { input ->
                dest.outputStream().use { output -> input.copyTo(output) }
            } ?: return null
            "$DIR/${dest.name}"
        } catch (e: Exception) {
            null
        }
    }

    fun file(context: Context, relativePath: String): File = File(context.filesDir, relativePath)

    fun exists(context: Context, relativePath: String): Boolean =
        relativePath.isNotBlank() && file(context, relativePath).exists()

    fun delete(context: Context, relativePath: String) {
        if (relativePath.isBlank()) return
        try { file(context, relativePath).delete() } catch (e: Exception) { /* best-effort cleanup */ }
    }
}
