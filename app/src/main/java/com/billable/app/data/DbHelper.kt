package com.billable.app.data

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * All local storage for the app: clients, time entries, expenses, and
 * generated invoices. Plain SQLiteOpenHelper rather than Room, deliberately —
 * it keeps the Gradle dependency graph (and therefore the chance of a build
 * failing on a machine other than the one that wrote this) as small as
 * possible.
 */
class DbHelper(context: Context) : SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE clients(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL DEFAULT '',
                address TEXT NOT NULL DEFAULT '',
                archived INTEGER NOT NULL DEFAULT 0
            )"""
        )
        db.execSQL(
            """CREATE TABLE time_entries(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                client_name TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                seconds INTEGER NOT NULL DEFAULT 0,
                invoiced INTEGER NOT NULL DEFAULT 0,
                invoice_id INTEGER NOT NULL DEFAULT 0
            )"""
        )
        db.execSQL(
            """CREATE TABLE expenses(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                client_id INTEGER NOT NULL,
                client_name TEXT NOT NULL DEFAULT '',
                date TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                amount REAL NOT NULL DEFAULT 0,
                invoiced INTEGER NOT NULL DEFAULT 0,
                invoice_id INTEGER NOT NULL DEFAULT 0,
                receipt_path TEXT NOT NULL DEFAULT ''
            )"""
        )
        db.execSQL(
            """CREATE TABLE invoices(
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                number INTEGER NOT NULL,
                client_id INTEGER NOT NULL,
                client_name TEXT NOT NULL DEFAULT '',
                client_email TEXT NOT NULL DEFAULT '',
                client_address TEXT NOT NULL DEFAULT '',
                month TEXT NOT NULL,
                generated_at INTEGER NOT NULL,
                rate REAL NOT NULL DEFAULT 0,
                currency TEXT NOT NULL DEFAULT '$',
                total_hours REAL NOT NULL DEFAULT 0,
                total_amount REAL NOT NULL DEFAULT 0,
                business_name TEXT NOT NULL DEFAULT '',
                business_email TEXT NOT NULL DEFAULT '',
                business_address TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                line_items TEXT NOT NULL DEFAULT '[]',
                tax_lines TEXT NOT NULL DEFAULT '[]',
                tax_total REAL NOT NULL DEFAULT 0,
                grand_total REAL NOT NULL DEFAULT 0,
                receipts TEXT NOT NULL DEFAULT '[]'
            )"""
        )
        db.execSQL("CREATE INDEX idx_entries_client_date ON time_entries(client_id, date)")
        db.execSQL("CREATE INDEX idx_expenses_client_date ON expenses(client_id, date)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE expenses ADD COLUMN receipt_path TEXT NOT NULL DEFAULT ''")
            db.execSQL("ALTER TABLE invoices ADD COLUMN tax_lines TEXT NOT NULL DEFAULT '[]'")
            db.execSQL("ALTER TABLE invoices ADD COLUMN tax_total REAL NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE invoices ADD COLUMN grand_total REAL NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE invoices ADD COLUMN receipts TEXT NOT NULL DEFAULT '[]'")
            // Older invoices predate tax support: their grand total is simply their (pre-tax) total.
            db.execSQL("UPDATE invoices SET grand_total = total_amount WHERE grand_total = 0")
        }
    }

    // ---------------- clients ----------------

    fun insertClient(name: String, email: String, address: String): Long {
        val cv = ContentValues().apply {
            put("name", name); put("email", email); put("address", address); put("archived", 0)
        }
        return writableDatabase.insert("clients", null, cv)
    }

    fun updateClient(id: Long, name: String, email: String, address: String) {
        val cv = ContentValues().apply { put("name", name); put("email", email); put("address", address) }
        writableDatabase.update("clients", cv, "id=?", arrayOf(id.toString()))
    }

    fun setClientArchived(id: Long, archived: Boolean) {
        val cv = ContentValues().apply { put("archived", if (archived) 1 else 0) }
        writableDatabase.update("clients", cv, "id=?", arrayOf(id.toString()))
    }

    fun deleteClient(id: Long) {
        writableDatabase.delete("clients", "id=?", arrayOf(id.toString()))
    }

    fun getClients(includeArchived: Boolean = true): List<Client> {
        val where = if (includeArchived) null else "archived=0"
        readableDatabase.query("clients", null, where, null, null, null, "name COLLATE NOCASE ASC").use { c ->
            val out = ArrayList<Client>()
            while (c.moveToNext()) {
                out.add(
                    Client(
                        id = c.getLong(c.getColumnIndexOrThrow("id")),
                        name = c.getString(c.getColumnIndexOrThrow("name")),
                        email = c.getString(c.getColumnIndexOrThrow("email")),
                        address = c.getString(c.getColumnIndexOrThrow("address")),
                        archived = c.getInt(c.getColumnIndexOrThrow("archived")) != 0
                    )
                )
            }
            return out
        }
    }

    fun getClient(id: Long): Client? = getClients(true).find { it.id == id }

    // ---------------- time entries ----------------

    fun insertTimeEntry(clientId: Long, clientName: String, date: String, description: String, seconds: Long): Long {
        val cv = ContentValues().apply {
            put("client_id", clientId); put("client_name", clientName); put("date", date)
            put("description", description); put("seconds", seconds); put("invoiced", 0); put("invoice_id", 0)
        }
        return writableDatabase.insert("time_entries", null, cv)
    }

    fun updateTimeEntry(id: Long, date: String, description: String, seconds: Long) {
        val cv = ContentValues().apply { put("date", date); put("description", description); put("seconds", seconds) }
        writableDatabase.update("time_entries", cv, "id=?", arrayOf(id.toString()))
    }

    fun deleteTimeEntry(id: Long) {
        writableDatabase.delete("time_entries", "id=?", arrayOf(id.toString()))
    }

    fun getRecentTimeEntries(limit: Int = 200): List<TimeEntry> {
        readableDatabase.query(
            "time_entries", null, null, null, null, null, "date DESC, id DESC", limit.toString()
        ).use { c -> return c.toTimeEntries() }
    }

    fun getTimeEntriesForClientInRange(clientId: Long, startDate: String, endDate: String, includeInvoiced: Boolean): List<TimeEntry> {
        val where = StringBuilder("client_id=? AND date>=? AND date<=?")
        if (!includeInvoiced) where.append(" AND invoiced=0")
        readableDatabase.query(
            "time_entries", null, where.toString(), arrayOf(clientId.toString(), startDate, endDate),
            null, null, "date ASC"
        ).use { c -> return c.toTimeEntries() }
    }

    fun markTimeEntriesInvoiced(ids: List<Long>, invoiceId: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) {
                val cv = ContentValues().apply { put("invoiced", 1); put("invoice_id", invoiceId) }
                db.update("time_entries", cv, "id=?", arrayOf(id.toString()))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private fun android.database.Cursor.toTimeEntries(): List<TimeEntry> {
        val out = ArrayList<TimeEntry>()
        while (moveToNext()) {
            out.add(
                TimeEntry(
                    id = getLong(getColumnIndexOrThrow("id")),
                    clientId = getLong(getColumnIndexOrThrow("client_id")),
                    clientName = getString(getColumnIndexOrThrow("client_name")),
                    date = getString(getColumnIndexOrThrow("date")),
                    description = getString(getColumnIndexOrThrow("description")),
                    seconds = getLong(getColumnIndexOrThrow("seconds")),
                    invoiced = getInt(getColumnIndexOrThrow("invoiced")) != 0,
                    invoiceId = getLong(getColumnIndexOrThrow("invoice_id"))
                )
            )
        }
        return out
    }

    // ---------------- expenses ----------------

    fun insertExpense(clientId: Long, clientName: String, date: String, title: String, amount: Double, receiptPath: String = ""): Long {
        val cv = ContentValues().apply {
            put("client_id", clientId); put("client_name", clientName); put("date", date)
            put("title", title); put("amount", amount); put("invoiced", 0); put("invoice_id", 0)
            put("receipt_path", receiptPath)
        }
        return writableDatabase.insert("expenses", null, cv)
    }

    fun updateExpense(id: Long, date: String, title: String, amount: Double, receiptPath: String? = null) {
        val cv = ContentValues().apply {
            put("date", date); put("title", title); put("amount", amount)
            if (receiptPath != null) put("receipt_path", receiptPath)
        }
        writableDatabase.update("expenses", cv, "id=?", arrayOf(id.toString()))
    }

    fun deleteExpense(id: Long) {
        writableDatabase.delete("expenses", "id=?", arrayOf(id.toString()))
    }

    fun getRecentExpenses(limit: Int = 200): List<Expense> {
        readableDatabase.query("expenses", null, null, null, null, null, "date DESC, id DESC", limit.toString())
            .use { c -> return c.toExpenses() }
    }

    fun getExpensesForClientInRange(clientId: Long, startDate: String, endDate: String, includeInvoiced: Boolean): List<Expense> {
        val where = StringBuilder("client_id=? AND date>=? AND date<=?")
        if (!includeInvoiced) where.append(" AND invoiced=0")
        readableDatabase.query(
            "expenses", null, where.toString(), arrayOf(clientId.toString(), startDate, endDate),
            null, null, "date ASC"
        ).use { c -> return c.toExpenses() }
    }

    fun markExpensesInvoiced(ids: List<Long>, invoiceId: Long) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (id in ids) {
                val cv = ContentValues().apply { put("invoiced", 1); put("invoice_id", invoiceId) }
                db.update("expenses", cv, "id=?", arrayOf(id.toString()))
            }
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }

    private fun android.database.Cursor.toExpenses(): List<Expense> {
        val out = ArrayList<Expense>()
        while (moveToNext()) {
            out.add(
                Expense(
                    id = getLong(getColumnIndexOrThrow("id")),
                    clientId = getLong(getColumnIndexOrThrow("client_id")),
                    clientName = getString(getColumnIndexOrThrow("client_name")),
                    date = getString(getColumnIndexOrThrow("date")),
                    title = getString(getColumnIndexOrThrow("title")),
                    amount = getDouble(getColumnIndexOrThrow("amount")),
                    invoiced = getInt(getColumnIndexOrThrow("invoiced")) != 0,
                    invoiceId = getLong(getColumnIndexOrThrow("invoice_id")),
                    receiptPath = getString(getColumnIndexOrThrow("receipt_path"))
                )
            )
        }
        return out
    }

    // ---------------- invoices ----------------

    fun insertInvoice(inv: Invoice): Long {
        val cv = ContentValues().apply {
            put("number", inv.number)
            put("client_id", inv.clientId)
            put("client_name", inv.clientName)
            put("client_email", inv.clientEmail)
            put("client_address", inv.clientAddress)
            put("month", inv.month)
            put("generated_at", inv.generatedAtMillis)
            put("rate", inv.rate)
            put("currency", inv.currency)
            put("total_hours", inv.totalHours)
            put("total_amount", inv.totalAmount)
            put("business_name", inv.businessName)
            put("business_email", inv.businessEmail)
            put("business_address", inv.businessAddress)
            put("notes", inv.notes)
            put("line_items", lineItemsToJson(inv.lineItems))
            put("tax_lines", taxLinesToJson(inv.taxLines))
            put("tax_total", inv.taxTotal)
            put("grand_total", inv.grandTotal)
            put("receipts", receiptsToJson(inv.receipts))
        }
        return writableDatabase.insert("invoices", null, cv)
    }

    fun getInvoices(limit: Int = 200): List<Invoice> {
        readableDatabase.query("invoices", null, null, null, null, null, "generated_at DESC", limit.toString())
            .use { c ->
                val out = ArrayList<Invoice>()
                while (c.moveToNext()) out.add(c.toInvoice())
                return out
            }
    }

    fun getInvoice(id: Long): Invoice? {
        readableDatabase.query("invoices", null, "id=?", arrayOf(id.toString()), null, null, null).use { c ->
            return if (c.moveToFirst()) c.toInvoice() else null
        }
    }

    private fun android.database.Cursor.toInvoice(): Invoice {
        val totalAmount = getDouble(getColumnIndexOrThrow("total_amount"))
        val grandTotalRaw = getDouble(getColumnIndexOrThrow("grand_total"))
        return Invoice(
            id = getLong(getColumnIndexOrThrow("id")),
            number = getInt(getColumnIndexOrThrow("number")),
            clientId = getLong(getColumnIndexOrThrow("client_id")),
            clientName = getString(getColumnIndexOrThrow("client_name")),
            clientEmail = getString(getColumnIndexOrThrow("client_email")),
            clientAddress = getString(getColumnIndexOrThrow("client_address")),
            month = getString(getColumnIndexOrThrow("month")),
            generatedAtMillis = getLong(getColumnIndexOrThrow("generated_at")),
            rate = getDouble(getColumnIndexOrThrow("rate")),
            currency = getString(getColumnIndexOrThrow("currency")),
            totalHours = getDouble(getColumnIndexOrThrow("total_hours")),
            totalAmount = totalAmount,
            businessName = getString(getColumnIndexOrThrow("business_name")),
            businessEmail = getString(getColumnIndexOrThrow("business_email")),
            businessAddress = getString(getColumnIndexOrThrow("business_address")),
            notes = getString(getColumnIndexOrThrow("notes")),
            lineItems = jsonToLineItems(getString(getColumnIndexOrThrow("line_items"))),
            taxLines = jsonToTaxLines(getString(getColumnIndexOrThrow("tax_lines"))),
            taxTotal = getDouble(getColumnIndexOrThrow("tax_total")),
            // Pre-tax invoices (migrated rows) stored 0 for grand_total; fall back to the subtotal.
            grandTotal = if (grandTotalRaw > 0) grandTotalRaw else totalAmount,
            receipts = jsonToReceipts(getString(getColumnIndexOrThrow("receipts")))
        )
    }

    companion object {
        private const val DB_NAME = "billable.db"
        private const val DB_VERSION = 2

        fun lineItemsToJson(items: List<InvoiceLineItem>): String {
            val arr = JSONArray()
            for (li in items) {
                arr.put(
                    JSONObject().apply {
                        put("type", li.type); put("date", li.date); put("description", li.description)
                        put("hours", li.hours); put("amount", li.amount)
                    }
                )
            }
            return arr.toString()
        }

        fun jsonToLineItems(json: String): List<InvoiceLineItem> {
            val out = ArrayList<InvoiceLineItem>()
            try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    out.add(
                        InvoiceLineItem(
                            type = o.optString("type", "time"),
                            date = o.optString("date", ""),
                            description = o.optString("description", ""),
                            hours = o.optDouble("hours", 0.0),
                            amount = o.optDouble("amount", 0.0)
                        )
                    )
                }
            } catch (e: Exception) {
                // Corrupt or empty line-items blob — treat as no line items rather than crashing.
            }
            return out
        }

        fun taxLinesToJson(items: List<InvoiceTaxLine>): String {
            val arr = JSONArray()
            for (t in items) {
                arr.put(JSONObject().apply { put("label", t.label); put("rate", t.rate); put("amount", t.amount) })
            }
            return arr.toString()
        }

        fun jsonToTaxLines(json: String): List<InvoiceTaxLine> {
            val out = ArrayList<InvoiceTaxLine>()
            try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    out.add(InvoiceTaxLine(o.optString("label", ""), o.optDouble("rate", 0.0), o.optDouble("amount", 0.0)))
                }
            } catch (e: Exception) { /* treat as no tax lines */ }
            return out
        }

        fun receiptsToJson(items: List<InvoiceReceipt>): String {
            val arr = JSONArray()
            for (r in items) arr.put(JSONObject().apply { put("expenseTitle", r.expenseTitle); put("path", r.path) })
            return arr.toString()
        }

        fun jsonToReceipts(json: String): List<InvoiceReceipt> {
            val out = ArrayList<InvoiceReceipt>()
            try {
                val arr = JSONArray(json)
                for (i in 0 until arr.length()) {
                    val o = arr.getJSONObject(i)
                    out.add(InvoiceReceipt(o.optString("expenseTitle", "Receipt"), o.optString("path", "")))
                }
            } catch (e: Exception) { /* treat as no receipts */ }
            return out
        }
    }
}
