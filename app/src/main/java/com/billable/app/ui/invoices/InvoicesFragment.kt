package com.billable.app.ui.invoices

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.NumberPicker
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.billable.app.data.Client
import com.billable.app.data.DbHelper
import com.billable.app.data.Expense
import com.billable.app.data.Invoice
import com.billable.app.data.InvoiceLineItem
import com.billable.app.data.InvoiceReceipt
import com.billable.app.data.InvoiceTaxLine
import com.billable.app.data.TimeEntry
import com.billable.app.databinding.FragmentInvoicesBinding
import com.billable.app.databinding.RowInvoicePreviewBinding
import com.billable.app.databinding.RowTaxLineBinding
import com.billable.app.pdf.InvoicePdfGenerator
import com.billable.app.prefs.AppSettings
import com.billable.app.ui.common.InvoiceAdapter
import com.billable.app.util.TimeFormat
import java.util.Calendar
import java.util.Locale

class InvoicesFragment : Fragment() {

    private var _binding: FragmentInvoicesBinding? = null
    private val binding get() = _binding!!
    private lateinit var db: DbHelper

    private var clients: List<Client> = emptyList()
    private var selectedMonth: String = TimeFormat.currentYearMonth()

    private var previewTimeRows: List<TimeEntry> = emptyList()
    private var previewExpenseRows: List<Expense> = emptyList()

    private lateinit var invoiceAdapter: InvoiceAdapter

    private val monthNames = arrayOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentInvoicesBinding.inflate(inflater, container, false)
        db = DbHelper(requireContext())
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        invoiceAdapter = InvoiceAdapter(emptyList(), ::shareInvoice)
        binding.rvInvoices.adapter = invoiceAdapter
        binding.rvInvoices.layoutManager = LinearLayoutManager(requireContext())
        binding.rvInvoices.itemAnimator = null

        updateMonthButtonLabel()
        binding.btnMonth.setOnClickListener { showMonthPicker() }
        binding.btnPreview.setOnClickListener { runPreview() }
        binding.btnGenerate.setOnClickListener { generateInvoice() }
    }

    override fun onResume() {
        super.onResume()
        refreshData()
    }

    private fun refreshData() {
        clients = db.getClients(includeArchived = true)
        val names = if (clients.isEmpty()) listOf("Add a client first") else clients.map { it.name }
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, names)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.spinnerClient.adapter = adapter

        val invoices = db.getInvoices()
        invoiceAdapter.submit(invoices)
        binding.tvHistoryEmpty.visibility = if (invoices.isEmpty()) View.VISIBLE else View.GONE
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun updateMonthButtonLabel() { binding.btnMonth.text = TimeFormat.monthLabel(selectedMonth) }

    private fun showMonthPicker() {
        val parts = selectedMonth.split("-").map { it.toInt() }
        val view = layoutInflater.inflate(com.billable.app.R.layout.dialog_month_picker, null)
        val monthPicker = view.findViewById<NumberPicker>(com.billable.app.R.id.picker_month)
        val yearPicker = view.findViewById<NumberPicker>(com.billable.app.R.id.picker_year)
        monthPicker.minValue = 1; monthPicker.maxValue = 12
        monthPicker.displayedValues = monthNames
        monthPicker.value = parts[1]

        val nowYear = Calendar.getInstance().get(Calendar.YEAR)
        yearPicker.minValue = nowYear - 5; yearPicker.maxValue = nowYear + 1
        yearPicker.value = parts[0]

        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Billing month")
            .setView(view)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("OK") { _, _ ->
                selectedMonth = String.format(Locale.US, "%04d-%02d", yearPicker.value, monthPicker.value)
                updateMonthButtonLabel()
                binding.layoutPreview.visibility = View.GONE
            }
            .show()
    }

    private fun selectedClient(): Client? = clients.getOrNull(binding.spinnerClient.selectedItemPosition)

    /** subtotal (pre-tax) time+expense amount, rounded to cents. */
    private fun computeSubtotal(): Double {
        var total = 0.0
        val rate = AppSettings.getRate(requireContext())
        for (e in previewTimeRows) total += Math.round(TimeFormat.hoursFromSeconds(e.seconds) * rate * 100) / 100.0
        for (x in previewExpenseRows) total += x.amount
        return Math.round(total * 100) / 100.0
    }

    private fun computeTaxLines(subtotal: Double): List<InvoiceTaxLine> {
        val configured = AppSettings.getEffectiveTaxLines(requireContext())
        return configured.map { InvoiceTaxLine(it.label, it.rate, Math.round(subtotal * it.rate * 100) / 100.0) }
    }

    private fun runPreview() {
        val client = selectedClient()
        if (client == null) { toast("Add a client first."); return }
        val (start, end) = TimeFormat.monthRange(selectedMonth)
        val includeInvoiced = binding.cbIncludeInvoiced.isChecked

        previewTimeRows = db.getTimeEntriesForClientInRange(client.id, start, end, includeInvoiced)
        previewExpenseRows = db.getExpensesForClientInRange(client.id, start, end, includeInvoiced)

        binding.layoutPreview.visibility = View.VISIBLE
        binding.previewRows.removeAllViews()

        val hasAny = previewTimeRows.isNotEmpty() || previewExpenseRows.isNotEmpty()
        binding.tvPreviewEmpty.visibility = if (hasAny) View.GONE else View.VISIBLE

        val currency = AppSettings.getCurrency(requireContext())
        var totalHours = 0.0

        data class Row(val date: String, val desc: String, val hours: Double?, val amount: Double)
        val rows = ArrayList<Row>()
        val rate = AppSettings.getRate(requireContext())
        for (e in previewTimeRows) {
            val h = TimeFormat.hoursFromSeconds(e.seconds)
            rows.add(Row(e.date, e.description.ifBlank { "—" }, h, Math.round(h * rate * 100) / 100.0))
        }
        for (x in previewExpenseRows) {
            val label = x.title + "  (expense)" + (if (x.receiptPath.isNotBlank()) "  📎" else "")
            rows.add(Row(x.date, label, null, x.amount))
        }
        rows.sortBy { it.date }

        for (r in rows) {
            val rowBinding = RowInvoicePreviewBinding.inflate(layoutInflater, binding.previewRows, false)
            rowBinding.tvDate.text = TimeFormat.formatDateShort(r.date)
            rowBinding.tvDesc.text = r.desc
            rowBinding.tvHours.text = if (r.hours != null) String.format(Locale.US, "%.2f", r.hours) else "—"
            rowBinding.tvAmount.text = currency + String.format(Locale.US, "%.2f", r.amount)
            binding.previewRows.addView(rowBinding.root)
            if (r.hours != null) totalHours += r.hours
        }
        totalHours = Math.round(totalHours * 100) / 100.0

        val subtotal = computeSubtotal()
        val taxLines = computeTaxLines(subtotal)
        val taxTotal = Math.round(taxLines.sumOf { it.amount } * 100) / 100.0
        val grandTotal = Math.round((subtotal + taxTotal) * 100) / 100.0

        binding.tvSubtotalHours.text = String.format(Locale.US, "%.2f hrs", totalHours)
        binding.tvSubtotalAmount.text = currency + String.format(Locale.US, "%.2f", subtotal)

        binding.layoutTaxLines.removeAllViews()
        for (t in taxLines) {
            val row = RowTaxLineBinding.inflate(layoutInflater, binding.layoutTaxLines, false)
            row.tvTaxLabel.text = "${t.label} (${formatRate(t.rate)}%)"
            row.tvTaxAmount.text = currency + String.format(Locale.US, "%.2f", t.amount)
            binding.layoutTaxLines.addView(row.root)
        }

        binding.tvTotalAmount.text = currency + String.format(Locale.US, "%.2f", grandTotal)
        val jurisdiction = AppSettings.getTaxJurisdictionLabel(requireContext())
        binding.tvTaxJurisdiction.visibility = if (jurisdiction.isNotBlank()) View.VISIBLE else View.GONE
        binding.tvTaxJurisdiction.text = "Tax jurisdiction: $jurisdiction"
    }

    private fun formatRate(rate: Double): String {
        val pct = rate * 100.0
        val s = String.format(Locale.US, "%.3f", pct)
        return s.trimEnd('0').trimEnd('.')
    }

    private fun generateInvoice() {
        val client = selectedClient() ?: return
        if (previewTimeRows.isEmpty() && previewExpenseRows.isEmpty()) { toast("Nothing to invoice for this period."); return }
        val ctx = requireContext()
        val rate = AppSettings.getRate(ctx)
        val currency = AppSettings.getCurrency(ctx)
        val number = AppSettings.getNextInvoiceNumber(ctx)

        val lineItems = ArrayList<InvoiceLineItem>()
        var totalHours = 0.0
        for (e in previewTimeRows) {
            val h = TimeFormat.hoursFromSeconds(e.seconds)
            val amt = Math.round(h * rate * 100) / 100.0
            lineItems.add(InvoiceLineItem("time", e.date, e.description, h, amt))
            totalHours += h
        }
        for (x in previewExpenseRows) {
            lineItems.add(InvoiceLineItem("expense", x.date, x.title, 0.0, x.amount))
        }
        lineItems.sortBy { it.date }
        totalHours = Math.round(totalHours * 100) / 100.0

        val subtotal = computeSubtotal()
        val taxLines = computeTaxLines(subtotal)
        val taxTotal = Math.round(taxLines.sumOf { it.amount } * 100) / 100.0
        val grandTotal = Math.round((subtotal + taxTotal) * 100) / 100.0
        val receipts = previewExpenseRows.filter { it.receiptPath.isNotBlank() }
            .map { InvoiceReceipt(it.title, it.receiptPath) }

        val invoice = Invoice(
            number = number, clientId = client.id, clientName = client.name, clientEmail = client.email, clientAddress = client.address,
            month = selectedMonth, generatedAtMillis = System.currentTimeMillis(), rate = rate, currency = currency,
            totalHours = totalHours, totalAmount = subtotal,
            businessName = AppSettings.getBusinessName(ctx), businessEmail = AppSettings.getBusinessEmail(ctx), businessAddress = AppSettings.getBusinessAddress(ctx),
            notes = AppSettings.getNotes(ctx), lineItems = lineItems,
            taxLines = taxLines, taxTotal = taxTotal, grandTotal = grandTotal, receipts = receipts
        )

        val file = try { InvoicePdfGenerator.generate(ctx, invoice) } catch (e: Exception) { toast("Could not build the PDF: ${e.message}"); return }

        val invoiceId = db.insertInvoice(invoice)
        db.markTimeEntriesInvoiced(previewTimeRows.map { it.id }, invoiceId)
        db.markExpensesInvoiced(previewExpenseRows.map { it.id }, invoiceId)
        AppSettings.setNextInvoiceNumber(ctx, number + 1)

        toast("Invoice #$number saved.")
        binding.layoutPreview.visibility = View.GONE
        refreshData() // refresh history + the next-invoice-number-dependent UI

        shareFile(file)
    }

    private fun shareInvoice(invoice: Invoice) {
        val file = try { InvoicePdfGenerator.generate(requireContext(), invoice) } catch (e: Exception) { toast("Could not rebuild PDF: ${e.message}"); return }
        shareFile(file)
    }

    private fun shareFile(file: java.io.File) {
        val uri = InvoicePdfGenerator.shareUri(requireContext(), file)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(Intent.createChooser(intent, "Share invoice"))
    }

    private fun toast(msg: String) = Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
}
