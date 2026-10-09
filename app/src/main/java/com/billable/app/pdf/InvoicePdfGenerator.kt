package com.billable.app.pdf

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.text.TextPaint
import android.text.StaticLayout
import android.text.Layout
import androidx.core.content.FileProvider
import com.billable.app.data.Invoice
import com.billable.app.util.TimeFormat
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Renders an [Invoice] to a one-page-per-overflow US Letter PDF using the
 * platform's built-in PdfDocument — no extra library, so nothing here can
 * fail to resolve at Gradle sync time.
 */
object InvoicePdfGenerator {
    private const val PAGE_W = 612 // 8.5in * 72dpi
    private const val PAGE_H = 792 // 11in * 72dpi
    private const val MARGIN = 48f

    fun generate(context: Context, invoice: Invoice): File {
        val doc = PdfDocument()
        var pageNumber = 1
        var page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
        var canvas = page.canvas
        var y = drawHeader(canvas, invoice)
        y = drawBillTo(canvas, invoice, y)
        y += 10f

        val headerPaint = fillPaint(Color.WHITE, 9.5f, bold = true)
        val rowPaint = textPaint(9.5f, Color.rgb(40, 40, 46))
        val mutedRowPaint = textPaint(9.5f, Color.rgb(90, 96, 108))

        val colDate = MARGIN
        val colDesc = MARGIN + 70f
        val colHours = PAGE_W - MARGIN - 150f
        val colAmount = PAGE_W - MARGIN

        // table header
        canvas.drawRect(MARGIN, y, PAGE_W - MARGIN, y + 22f, fillRectPaint(Color.rgb(52, 82, 225)))
        canvas.drawText("DATE", colDate + 4f, y + 15f, headerPaint)
        canvas.drawText("DESCRIPTION", colDesc, y + 15f, headerPaint)
        canvas.drawText("HOURS", colHours, y + 15f, rightAlign(headerPaint))
        canvas.drawText("AMOUNT", colAmount, y + 15f, rightAlign(headerPaint))
        y += 22f

        val currency = invoice.currency
        for ((index, li) in invoice.lineItems.withIndex()) {
            if (y > PAGE_H - 160f) {
                doc.finishPage(page)
                pageNumber++
                page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
                canvas = page.canvas
                y = MARGIN
            }
            if (index % 2 == 1) canvas.drawRect(MARGIN, y, PAGE_W - MARGIN, y + 20f, fillRectPaint(Color.rgb(247, 248, 250)))
            val desc = li.description + if (li.type == "expense") "  (expense)" else ""
            canvas.drawText(TimeFormat.formatDateShort(li.date), colDate + 4f, y + 14f, rowPaint)
            canvas.drawText(truncate(desc, 46), colDesc, y + 14f, rowPaint)
            val hoursText = if (li.type == "expense") "—" else String.format(Locale.US, "%.2f", li.hours)
            canvas.drawText(hoursText, colHours, y + 14f, rightAlign(mutedRowPaint))
            canvas.drawText(currency + String.format(Locale.US, "%.2f", li.amount), colAmount, y + 14f, rightAlign(rowPaint))
            y += 20f
        }

        // Room needed for the totals block below (subtotal + up to a few tax lines + grand total + notes).
        val totalsBlockHeight = 44f + invoice.taxLines.size * 16f + 20f + (if (invoice.notes.isNotBlank()) 40f else 0f)
        if (y + totalsBlockHeight > PAGE_H - MARGIN) {
            doc.finishPage(page)
            pageNumber++
            page = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, pageNumber).create())
            canvas = page.canvas
            y = MARGIN
        }

        y += 6f
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, strokePaint(Color.rgb(220, 222, 228)))
        y += 18f

        val subtotalPaint = textPaint(10.5f, Color.rgb(90, 96, 108))
        canvas.drawText("Subtotal", colDesc, y, subtotalPaint)
        canvas.drawText(currency + String.format(Locale.US, "%.2f", invoice.totalAmount), colAmount, y, rightAlign(subtotalPaint))
        y += 16f

        for (t in invoice.taxLines) {
            val label = "${t.label} (${formatRate(t.rate)}%)"
            canvas.drawText(label, colDesc, y, subtotalPaint)
            canvas.drawText(currency + String.format(Locale.US, "%.2f", t.amount), colAmount, y, rightAlign(subtotalPaint))
            y += 16f
        }

        y += 6f
        val totalPaint = fillPaint(Color.rgb(20, 22, 28), 12f, bold = true)
        canvas.drawText("Total due", colDesc, y, totalPaint)
        canvas.drawText(currency + String.format(Locale.US, "%.2f", invoice.grandTotal), colAmount, y, rightAlign(totalPaint))
        y += 24f

        val smallMuted = textPaint(9f, Color.rgb(90, 96, 108))
        canvas.drawText(
            "Rate: $currency${String.format(Locale.US, "%.2f", invoice.rate)} / hour   ·   Total hours: ${String.format(Locale.US, "%.2f", invoice.totalHours)}",
            MARGIN, y, smallMuted
        )
        y += 20f

        if (invoice.notes.isNotBlank()) {
            y = drawWrapped(canvas, invoice.notes, MARGIN, y, PAGE_W - MARGIN * 2, smallMuted)
        }

        doc.finishPage(page)

        // Receipts: one per page, appended after the invoice itself, so the invoice PDF doubles as
        // its own expense-backup packet.
        for (receipt in invoice.receipts) {
            val bitmap = try { decodeReceiptBitmap(context, receipt.path) } catch (e: Exception) { null } ?: continue
            val receiptPage = doc.startPage(PdfDocument.PageInfo.Builder(PAGE_W, PAGE_H, ++pageNumber).create())
            val rc = receiptPage.canvas
            val captionPaint = fillPaint(Color.rgb(20, 22, 28), 11f, bold = true)
            rc.drawText("Receipt — ${receipt.expenseTitle}", MARGIN, MARGIN, captionPaint)

            val availW = PAGE_W - MARGIN * 2
            val availH = PAGE_H - MARGIN * 2 - 24f
            val scale = minOf(availW / bitmap.width, availH / bitmap.height, 1f)
            val drawW = bitmap.width * scale
            val drawH = bitmap.height * scale
            val left = MARGIN + (availW - drawW) / 2f
            val top = MARGIN + 24f
            rc.drawBitmap(bitmap, null, RectF(left, top, left + drawW, top + drawH), Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
            bitmap.recycle()
            doc.finishPage(receiptPage)
        }

        val dir = File(context.cacheDir, "invoices").apply { mkdirs() }
        val safeClient = invoice.clientName.ifBlank { "client" }.replace(Regex("[^a-zA-Z0-9]+"), "-")
        val file = File(dir, "Invoice-${String.format(Locale.US, "%04d", invoice.number)}-$safeClient-${invoice.month}.pdf")
        FileOutputStream(file).use { doc.writeTo(it) }
        doc.close()
        return file
    }

    private fun decodeReceiptBitmap(context: Context, relativePath: String): Bitmap? {
        val f = File(context.filesDir, relativePath)
        if (!f.exists()) return null
        // Downsample large photos so a single receipt page doesn't balloon the PDF's file size.
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, bounds)
        var sample = 1
        while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        return BitmapFactory.decodeFile(f.absolutePath, opts)
    }

    private fun formatRate(rate: Double): String {
        val pct = rate * 100.0
        val s = String.format(Locale.US, "%.3f", pct)
        return s.trimEnd('0').trimEnd('.')
    }

    fun shareUri(context: Context, file: File) =
        FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

    private fun drawHeader(canvas: Canvas, invoice: Invoice): Float {
        val titlePaint = fillPaint(Color.rgb(20, 22, 28), 22f, bold = true)
        canvas.drawText("INVOICE", MARGIN, 60f, titlePaint)

        val meta = textPaint(10f, Color.rgb(90, 96, 108))
        canvas.drawText("Invoice #${invoice.number}", MARGIN, 78f, meta)
        canvas.drawText("Date: ${SimpleDateFormat("MMM d, yyyy", Locale.US).format(Date(invoice.generatedAtMillis))}", MARGIN, 92f, meta)
        canvas.drawText("Period: ${TimeFormat.monthLabel(invoice.month)}", MARGIN, 106f, meta)

        val bizName = fillPaint(Color.rgb(20, 22, 28), 12f, bold = true)
        canvas.drawText(invoice.businessName.ifBlank { "Your Business" }, PAGE_W - MARGIN, 60f, rightAlign(bizName))
        var by = 76f
        val bizMuted = textPaint(9.5f, Color.rgb(90, 96, 108))
        val bizLines = (if (invoice.businessEmail.isNotBlank()) listOf(invoice.businessEmail) else emptyList()) +
            invoice.businessAddress.split("\n").filter { it.isNotBlank() }
        for (line in bizLines) { canvas.drawText(line, PAGE_W - MARGIN, by, rightAlign(bizMuted)); by += 13f }

        return maxOf(120f, by + 6f)
    }

    private fun drawBillTo(canvas: Canvas, invoice: Invoice, startY: Float): Float {
        var y = startY
        canvas.drawLine(MARGIN, y, PAGE_W - MARGIN, y, strokePaint(Color.rgb(225, 225, 230)))
        y += 16f
        canvas.drawText("BILL TO", MARGIN, y, fillPaint(Color.rgb(20, 22, 28), 10f, bold = true))
        y += 16f
        canvas.drawText(invoice.clientName.ifBlank { "Client" }, MARGIN, y, textPaint(10.5f, Color.rgb(20, 22, 28)))
        y += 14f
        val muted = textPaint(9.5f, Color.rgb(90, 96, 108))
        val lines = (if (invoice.clientEmail.isNotBlank()) listOf(invoice.clientEmail) else emptyList()) +
            invoice.clientAddress.split("\n").filter { it.isNotBlank() }
        for (line in lines) { canvas.drawText(line, MARGIN, y, muted); y += 13f }
        return y
    }

    private fun drawWrapped(canvas: Canvas, text: String, x: Float, y: Float, width: Float, paint: TextPaint): Float {
        val layout = StaticLayout.Builder.obtain(text, 0, text.length, paint, width.toInt())
            .setAlignment(Layout.Alignment.ALIGN_NORMAL)
            .build()
        canvas.save()
        canvas.translate(x, y)
        layout.draw(canvas)
        canvas.restore()
        return y + layout.height
    }

    private fun truncate(s: String, max: Int) = if (s.length > max) s.substring(0, max - 1) + "…" else s

    private fun textPaint(size: Float, color: Int): TextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size; this.color = color
    }
    private fun fillPaint(color: Int, size: Float, bold: Boolean = false): TextPaint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color; textSize = size; isFakeBoldText = bold
    }
    private fun rightAlign(p: TextPaint): TextPaint { val c = TextPaint(p); c.textAlign = Paint.Align.RIGHT; return c }
    private fun strokePaint(color: Int): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; strokeWidth = 1f }
    private fun fillRectPaint(color: Int): Paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color; style = Paint.Style.FILL }
}
