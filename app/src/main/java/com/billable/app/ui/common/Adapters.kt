package com.billable.app.ui.common

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.billable.app.data.Client
import com.billable.app.data.Expense
import com.billable.app.data.Invoice
import com.billable.app.data.TimeEntry
import com.billable.app.databinding.ItemClientBinding
import com.billable.app.databinding.ItemInvoiceBinding
import com.billable.app.databinding.ItemTimeEntryBinding
import com.billable.app.util.TimeFormat
import java.util.Locale

class TimeEntryAdapter(
    private var items: List<TimeEntry>,
    private val currency: String,
    private val onEdit: (TimeEntry) -> Unit,
    private val onDelete: (TimeEntry) -> Unit
) : RecyclerView.Adapter<TimeEntryAdapter.VH>() {

    fun submit(newItems: List<TimeEntry>) { items = newItems; notifyDataSetChanged() }

    inner class VH(val b: ItemTimeEntryBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemTimeEntryBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val e = items[position]
        holder.b.tvDate.text = TimeFormat.formatDateShort(e.date)
        holder.b.tvTitle.text = e.clientName
        holder.b.tvSubtitle.text = (e.description.ifBlank { "No description" }) + if (e.invoiced) "  ·  Invoiced" else ""
        holder.b.tvValue.text = String.format(Locale.US, "%.2fh", TimeFormat.hoursFromSeconds(e.seconds))
        holder.b.btnEdit.setOnClickListener { onEdit(e) }
        holder.b.btnDelete.setOnClickListener { onDelete(e) }
    }
}

class ExpenseAdapter(
    private var items: List<Expense>,
    private val currency: String,
    private val onEdit: (Expense) -> Unit,
    private val onDelete: (Expense) -> Unit
) : RecyclerView.Adapter<ExpenseAdapter.VH>() {

    fun submit(newItems: List<Expense>) { items = newItems; notifyDataSetChanged() }

    inner class VH(val b: ItemTimeEntryBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemTimeEntryBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val x = items[position]
        holder.b.tvDate.text = TimeFormat.formatDateShort(x.date)
        holder.b.tvTitle.text = x.clientName
        holder.b.tvSubtitle.text = x.title + (if (x.receiptPath.isNotBlank()) "  ·  📎 Receipt" else "") + (if (x.invoiced) "  ·  Invoiced" else "")
        holder.b.tvValue.text = currency + String.format(Locale.US, "%.2f", x.amount)
        holder.b.btnEdit.setOnClickListener { onEdit(x) }
        holder.b.btnDelete.setOnClickListener { onDelete(x) }
    }
}

class ClientAdapter(
    private var items: List<Client>,
    private val onEdit: (Client) -> Unit,
    private val onArchive: (Client) -> Unit,
    private val onDelete: (Client) -> Unit
) : RecyclerView.Adapter<ClientAdapter.VH>() {

    fun submit(newItems: List<Client>) { items = newItems; notifyDataSetChanged() }

    inner class VH(val b: ItemClientBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemClientBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val c = items[position]
        holder.b.tvTitle.text = c.name + if (c.archived) "  (archived)" else ""
        holder.b.tvSubtitle.text = listOf(c.email, c.address.substringBefore("\n")).filter { it.isNotBlank() }.joinToString(" · ")
        holder.b.btnEdit.setOnClickListener { onEdit(c) }
        holder.b.btnArchive.text = if (c.archived) "Unarchive" else "Archive"
        holder.b.btnArchive.setOnClickListener { onArchive(c) }
        holder.b.btnDelete.setOnClickListener { onDelete(c) }
        holder.b.root.alpha = if (c.archived) 0.55f else 1f
    }
}

class InvoiceAdapter(
    private var items: List<Invoice>,
    private val onShare: (Invoice) -> Unit
) : RecyclerView.Adapter<InvoiceAdapter.VH>() {

    fun submit(newItems: List<Invoice>) { items = newItems; notifyDataSetChanged() }

    inner class VH(val b: ItemInvoiceBinding) : RecyclerView.ViewHolder(b.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH =
        VH(ItemInvoiceBinding.inflate(LayoutInflater.from(parent.context), parent, false))

    override fun getItemCount() = items.size

    override fun onBindViewHolder(holder: VH, position: Int) {
        val inv = items[position]
        holder.b.tvTitle.text = String.format(Locale.US, "#%04d  ·  %s", inv.number, inv.clientName)
        holder.b.tvSubtitle.text = TimeFormat.monthLabel(inv.month) + String.format(Locale.US, "  ·  %.2f hrs", inv.totalHours)
        holder.b.tvValue.text = inv.currency + String.format(Locale.US, "%.2f", inv.totalAmount)
        holder.b.btnShare.setOnClickListener { onShare(inv) }
    }
}
