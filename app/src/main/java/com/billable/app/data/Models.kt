package com.billable.app.data

data class Client(
    val id: Long = 0,
    val name: String,
    val email: String = "",
    val address: String = "",
    val archived: Boolean = false
)

data class TimeEntry(
    val id: Long = 0,
    val clientId: Long,
    val clientName: String,
    val date: String, // YYYY-MM-DD
    val description: String,
    val seconds: Long,
    val invoiced: Boolean = false,
    val invoiceId: Long = 0
)

data class Expense(
    val id: Long = 0,
    val clientId: Long,
    val clientName: String,
    val date: String, // YYYY-MM-DD
    val title: String,
    val amount: Double,
    val invoiced: Boolean = false,
    val invoiceId: Long = 0,
    /** Path (relative to filesDir) of an attached JPEG/PNG receipt image, or "" if none. */
    val receiptPath: String = ""
)

/** One row on a generated invoice — either tracked time or a flat expense. */
data class InvoiceLineItem(
    val type: String, // "time" | "expense"
    val date: String,
    val description: String,
    val hours: Double = 0.0,
    val amount: Double
)

/** One computed tax line on a generated invoice, e.g. "HST (14%)" -> $12.34. */
data class InvoiceTaxLine(
    val label: String,
    val rate: Double, // decimal, e.g. 0.14 for 14%
    val amount: Double
)

/** A receipt image carried along with an invoice, appended as an extra PDF page. */
data class InvoiceReceipt(
    val expenseTitle: String,
    /** Path relative to filesDir, as stored for the originating Expense. */
    val path: String
)

/**
 * A generated invoice. Line items, business/client details, the rate, and the
 * tax configuration are all snapshotted at generation time so an invoice can
 * be reviewed and re-shared unchanged even if the client's info, your rate,
 * or your tax settings change later.
 */
data class Invoice(
    val id: Long = 0,
    val number: Int,
    val clientId: Long,
    val clientName: String,
    val clientEmail: String,
    val clientAddress: String,
    val month: String, // YYYY-MM
    val generatedAtMillis: Long,
    val rate: Double,
    val currency: String,
    val totalHours: Double,
    /** Sum of time + expense line items, before tax. */
    val totalAmount: Double,
    val businessName: String,
    val businessEmail: String,
    val businessAddress: String,
    val notes: String,
    val lineItems: List<InvoiceLineItem>,
    val taxLines: List<InvoiceTaxLine> = emptyList(),
    val taxTotal: Double = 0.0,
    /** totalAmount + taxTotal — the amount actually owed. */
    val grandTotal: Double = totalAmount,
    /** Receipt images (from expenses on this invoice) appended as extra PDF pages. */
    val receipts: List<InvoiceReceipt> = emptyList()
)
