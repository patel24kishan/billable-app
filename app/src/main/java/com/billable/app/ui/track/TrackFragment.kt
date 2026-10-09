package com.billable.app.ui.track

import android.app.DatePickerDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ArrayAdapter
import android.widget.Button
import com.google.android.material.button.MaterialButton
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.fragment.app.Fragment
import com.billable.app.data.Client
import com.billable.app.data.DbHelper
import com.billable.app.data.Expense
import com.billable.app.data.TimeEntry
import com.billable.app.databinding.FragmentTrackBinding
import com.billable.app.prefs.AppSettings
import com.billable.app.prefs.TimerPrefs
import com.billable.app.prefs.TimerStatus
import com.billable.app.timer.TimerService
import com.billable.app.ui.common.ExpenseAdapter
import com.billable.app.ui.common.TimeEntryAdapter
import com.billable.app.util.ReceiptStore
import com.billable.app.util.TimeFormat
import java.util.Calendar

class TrackFragment : Fragment() {

    private var _binding: FragmentTrackBinding? = null
    private val binding get() = _binding!!
    private lateinit var db: DbHelper

    private var activeClients: List<Client> = emptyList()
    private var manualDate = TimeFormat.todayDateString()
    private var expenseDate = TimeFormat.todayDateString()

    // The receipt image picked for the "log an expense" form, staged until addExpense() copies it.
    private var pickedAddReceiptUri: Uri? = null
    private var pickedAddReceiptMime: String? = null

    // Whichever picker flow (add-expense card, or an open edit dialog) is currently waiting on a pick.
    private var onReceiptPicked: ((Uri, String) -> Unit)? = null

    private val pickReceiptLauncher = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri == null) return@registerForActivityResult
        val mime = ReceiptStore.acceptedMimeType(requireContext(), uri)
        if (mime == null) { toast("Please choose a JPEG or PNG image."); return@registerForActivityResult }
        onReceiptPicked?.invoke(uri, mime)
    }

    private lateinit var entriesAdapter: TimeEntryAdapter
    private lateinit var expensesAdapter: ExpenseAdapter

    private val tickHandler = Handler(Looper.getMainLooper())
    private val tickRunnable = object : Runnable {
        override fun run() {
            val snap = TimerPrefs.get(requireContext())
            if (snap.status == TimerStatus.RUNNING) {
                binding.tvTimerDisplay.text = TimeFormat.duration(snap.elapsedSeconds())
            }
            tickHandler.postDelayed(this, 1000)
        }
    }

    private val timerChangedReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) { renderTimer() }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentTrackBinding.inflate(inflater, container, false)
        db = DbHelper(requireContext())
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)

        entriesAdapter = TimeEntryAdapter(emptyList(), AppSettings.getCurrency(requireContext()), ::onEditEntry, ::onDeleteEntry)
        binding.rvEntries.adapter = entriesAdapter
        binding.rvEntries.layoutManager = androidx.recyclerview.widget.LinearLayoutManager(requireContext())
        binding.rvEntries.itemAnimator = null

        expensesAdapter = ExpenseAdapter(emptyList(), AppSettings.getCurrency(requireContext()), ::onEditExpense, ::onDeleteExpense)
        binding.rvExpenses.adapter = expensesAdapter
        binding.rvExpenses.layoutManager = androidx.recyclerview.widget.LinearLayoutManager(requireContext())
        binding.rvExpenses.itemAnimator = null

        binding.etManualDate.setOnClickListener { pickDate(manualDate) { manualDate = it; binding.etManualDate.setText(TimeFormat.formatDateShort(it)) } }
        binding.etExpenseDate.setOnClickListener { pickDate(expenseDate) { expenseDate = it; binding.etExpenseDate.setText(TimeFormat.formatDateShort(it)) } }
        binding.etManualDate.setText(TimeFormat.formatDateShort(manualDate))
        binding.etExpenseDate.setText(TimeFormat.formatDateShort(expenseDate))

        binding.btnStartTimer.setOnClickListener { startTimer() }
        binding.btnDiscardTimer.setOnClickListener { discardTimer() }
        binding.etActiveNote.setOnFocusChangeListener { _, hasFocus ->
            if (!hasFocus) sendServiceAction(TimerService.ACTION_UPDATE_DESCRIPTION, binding.etActiveNote.text.toString())
        }

        binding.btnAddEntry.setOnClickListener { addManualEntry() }
        binding.btnAddExpense.setOnClickListener { addExpense() }

        binding.btnAttachReceipt.setOnClickListener {
            onReceiptPicked = { uri, mime ->
                pickedAddReceiptUri = uri; pickedAddReceiptMime = mime
                binding.tvReceiptName.text = receiptLabel(mime)
                binding.btnRemoveReceipt.visibility = View.VISIBLE
            }
            pickReceiptLauncher.launch("image/*")
        }
        binding.btnRemoveReceipt.setOnClickListener { clearAddReceiptPick() }
    }

    override fun onResume() {
        super.onResume()
        loadClients()
        refreshLists()
        renderTimer()
        tickHandler.post(tickRunnable)
        ContextCompat.registerReceiver(
            requireContext(), timerChangedReceiver, IntentFilter(TimerService.ACTION_TIMER_CHANGED),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onPause() {
        super.onPause()
        tickHandler.removeCallbacks(tickRunnable)
        try { requireContext().unregisterReceiver(timerChangedReceiver) } catch (e: IllegalArgumentException) { /* not registered */ }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun loadClients() {
        activeClients = db.getClients(includeArchived = false)
        val names = if (activeClients.isEmpty()) listOf("Add a client first") else activeClients.map { it.name }
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, names)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.spinnerTimerClient.adapter = adapter
        binding.spinnerExpenseClient.adapter = adapter
        binding.spinnerManualClient.adapter = adapter

        binding.tvSetupBanner.visibility = if (AppSettings.isConfigured(requireContext())) View.GONE else View.VISIBLE
    }

    private fun selectedClient(spinnerPosition: Int): Client? = activeClients.getOrNull(spinnerPosition)

    private fun refreshLists() {
        val entries = db.getRecentTimeEntries()
        entriesAdapter.submit(entries)
        binding.tvEntriesEmpty.visibility = if (entries.isEmpty()) View.VISIBLE else View.GONE

        val exps = db.getRecentExpenses()
        expensesAdapter.submit(exps)
        binding.tvExpensesEmpty.visibility = if (exps.isEmpty()) View.VISIBLE else View.GONE
    }

    // ---------------- timer ----------------

    private fun renderTimer() {
        if (_binding == null) return
        val snap = TimerPrefs.get(requireContext())
        val active = snap.status != TimerStatus.IDLE
        binding.layoutTimerIdle.visibility = if (active) View.GONE else View.VISIBLE
        binding.layoutTimerActive.visibility = if (active) View.VISIBLE else View.GONE
        if (!active) return

        val label = when (snap.status) {
            TimerStatus.RUNNING -> "Tracking"
            TimerStatus.PAUSED -> "Paused"
            TimerStatus.STOPPED -> "Ready to save"
            else -> ""
        }
        binding.tvTimerMeta.text = "$label — ${snap.clientName}"
        binding.tvTimerDisplay.text = TimeFormat.duration(snap.elapsedSeconds())
        if (!binding.etActiveNote.isFocused) binding.etActiveNote.setText(snap.description)

        renderTimerControls(snap.status)
    }

    private enum class BtnStyle { PRIMARY, GHOST, SUCCESS }

    private fun renderTimerControls(status: TimerStatus) {
        val row = binding.timerControls
        row.removeAllViews()
        fun makeButton(text: String, style: BtnStyle, onClick: () -> Unit): MaterialButton {
            val outlined = style == BtnStyle.GHOST
            val b = MaterialButton(
                requireContext(),
                null,
                if (outlined) com.google.android.material.R.attr.materialButtonOutlinedStyle
                else com.google.android.material.R.attr.materialButtonStyle
            )
            b.text = text
            b.isAllCaps = false
            b.textSize = 13f
            b.cornerRadius = (10 * resources.displayMetrics.density).toInt()
            val lp = android.widget.LinearLayout.LayoutParams(0, android.widget.LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            lp.marginEnd = 8
            b.layoutParams = lp
            when (style) {
                BtnStyle.PRIMARY -> {
                    b.backgroundTintList = android.content.res.ColorStateList.valueOf(
                        resources.getColor(com.billable.app.R.color.accent, null)
                    )
                    b.setTextColor(resources.getColor(com.billable.app.R.color.on_accent, null))
                    b.strokeWidth = 0
                }
                BtnStyle.GHOST -> {
                    b.backgroundTintList = android.content.res.ColorStateList.valueOf(
                        android.graphics.Color.TRANSPARENT
                    )
                    b.setTextColor(resources.getColor(com.billable.app.R.color.text_primary, null))
                    b.strokeColor = android.content.res.ColorStateList.valueOf(
                        resources.getColor(com.billable.app.R.color.border, null)
                    )
                    b.strokeWidth = 2
                }
                BtnStyle.SUCCESS -> {
                    b.backgroundTintList = android.content.res.ColorStateList.valueOf(
                        resources.getColor(com.billable.app.R.color.success, null)
                    )
                    b.setTextColor(android.graphics.Color.parseColor("#06231A"))
                    b.strokeWidth = 0
                }
            }
            b.setOnClickListener { onClick() }
            return b
        }
        when (status) {
            TimerStatus.RUNNING -> {
                row.addView(makeButton("⏸ Pause", BtnStyle.GHOST) { sendServiceAction(TimerService.ACTION_PAUSE) })
                row.addView(makeButton("■ Stop", BtnStyle.SUCCESS) { sendServiceAction(TimerService.ACTION_STOP) })
            }
            TimerStatus.PAUSED -> {
                row.addView(makeButton("▶ Resume", BtnStyle.PRIMARY) { sendServiceAction(TimerService.ACTION_RESUME) })
                row.addView(makeButton("■ Stop", BtnStyle.SUCCESS) { sendServiceAction(TimerService.ACTION_STOP) })
            }
            TimerStatus.STOPPED -> {
                row.addView(makeButton("↺ Resume", BtnStyle.GHOST) { sendServiceAction(TimerService.ACTION_RESUME) })
                row.addView(makeButton("✓ Save Entry", BtnStyle.PRIMARY) { sendServiceAction(TimerService.ACTION_SAVE) })
            }
            else -> {}
        }
    }

    private fun startTimer() {
        val client = selectedClient(binding.spinnerTimerClient.selectedItemPosition)
        if (client == null) { toast("Add a client first."); return }
        val i = Intent(requireContext(), TimerService::class.java).setAction(TimerService.ACTION_START)
            .putExtra(TimerService.EXTRA_CLIENT_ID, client.id)
            .putExtra(TimerService.EXTRA_CLIENT_NAME, client.name)
            .putExtra(TimerService.EXTRA_DESCRIPTION, binding.etTimerNote.text.toString().trim())
        ContextCompat.startForegroundService(requireContext(), i)
        binding.etTimerNote.setText("")
    }

    private fun discardTimer() {
        android.app.AlertDialog.Builder(requireContext())
            .setMessage("Discard this session without saving it as an entry?")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Discard") { _, _ -> sendServiceAction(TimerService.ACTION_DISCARD); refreshLists() }
            .show()
    }

    private fun sendServiceAction(action: String, description: String? = null) {
        val i = Intent(requireContext(), TimerService::class.java).setAction(action)
        if (description != null) i.putExtra(TimerService.EXTRA_DESCRIPTION, description)
        ContextCompat.startForegroundService(requireContext(), i)
        if (action == TimerService.ACTION_SAVE) tickHandler.postDelayed({ refreshLists() }, 300)
    }

    // ---------------- manual entry ----------------

    private fun addManualEntry() {
        val client = selectedClient(binding.spinnerManualClient.selectedItemPosition)
        if (client == null) { toast("Add a client first."); return }
        val hours = binding.etManualHours.text.toString().toDoubleOrNull()
        if (hours == null || hours <= 0) { toast("Enter a valid number of hours."); return }
        db.insertTimeEntry(client.id, client.name, manualDate, binding.etManualDesc.text.toString().trim(), Math.round(hours * 3600))
        binding.etManualHours.setText(""); binding.etManualDesc.setText("")
        manualDate = TimeFormat.todayDateString(); binding.etManualDate.setText(TimeFormat.formatDateShort(manualDate))
        refreshLists()
        toast("Entry added.")
    }

    private fun onEditEntry(entry: TimeEntry) {
        val dialogView = layoutInflater.inflate(com.billable.app.R.layout.dialog_edit_entry, null)
        val etHours = dialogView.findViewById<android.widget.EditText>(com.billable.app.R.id.et_dialog_hours)
        val etDesc = dialogView.findViewById<android.widget.EditText>(com.billable.app.R.id.et_dialog_desc)
        val tvDate = dialogView.findViewById<android.widget.TextView>(com.billable.app.R.id.tv_dialog_date)
        var date = entry.date
        etHours.setText(TimeFormat.hoursFromSeconds(entry.seconds).toString())
        etDesc.setText(entry.description)
        tvDate.text = TimeFormat.formatDateShort(date)
        tvDate.setOnClickListener { pickDate(date) { d -> date = d; tvDate.text = TimeFormat.formatDateShort(d) } }

        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Edit time entry")
            .setView(dialogView)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val hours = etHours.text.toString().toDoubleOrNull()
                if (hours == null || hours <= 0) { toast("Enter a valid number of hours."); return@setPositiveButton }
                db.updateTimeEntry(entry.id, date, etDesc.text.toString().trim(), Math.round(hours * 3600))
                refreshLists()
            }
            .show()
    }

    private fun onDeleteEntry(entry: TimeEntry) {
        android.app.AlertDialog.Builder(requireContext())
            .setMessage("Delete this time entry? This can't be undone.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ -> db.deleteTimeEntry(entry.id); refreshLists() }
            .show()
    }

    // ---------------- expenses ----------------

    private fun receiptLabel(mime: String): String = if (mime == "image/png") "Receipt (PNG) attached" else "Receipt (JPEG) attached"

    private fun clearAddReceiptPick() {
        pickedAddReceiptUri = null; pickedAddReceiptMime = null
        binding.tvReceiptName.text = "No receipt attached"
        binding.btnRemoveReceipt.visibility = View.GONE
    }

    private fun addExpense() {
        val client = selectedClient(binding.spinnerExpenseClient.selectedItemPosition)
        if (client == null) { toast("Add a client first."); return }
        val amount = binding.etExpenseAmount.text.toString().toDoubleOrNull()
        val title = binding.etExpenseTitle.text.toString().trim()
        if (amount == null || amount <= 0 || title.isEmpty()) { toast("Enter a title and a valid amount."); return }

        val receiptUri = pickedAddReceiptUri
        val receiptMime = pickedAddReceiptMime
        val receiptPath = if (receiptUri != null && receiptMime != null) {
            ReceiptStore.copyToReceipts(requireContext(), receiptUri, receiptMime) ?: ""
        } else ""

        db.insertExpense(client.id, client.name, expenseDate, title, Math.round(amount * 100) / 100.0, receiptPath)
        binding.etExpenseAmount.setText(""); binding.etExpenseTitle.setText("")
        expenseDate = TimeFormat.todayDateString(); binding.etExpenseDate.setText(TimeFormat.formatDateShort(expenseDate))
        clearAddReceiptPick()
        refreshLists()
        toast("Expense added.")
    }

    private fun onEditExpense(expense: Expense) {
        val dialogView = layoutInflater.inflate(com.billable.app.R.layout.dialog_edit_expense, null)
        val etAmount = dialogView.findViewById<android.widget.EditText>(com.billable.app.R.id.et_dialog_amount)
        val etTitle = dialogView.findViewById<android.widget.EditText>(com.billable.app.R.id.et_dialog_title)
        val tvDate = dialogView.findViewById<android.widget.TextView>(com.billable.app.R.id.tv_dialog_date)
        val tvReceiptName = dialogView.findViewById<android.widget.TextView>(com.billable.app.R.id.tv_dialog_receipt_name)
        val btnAttach = dialogView.findViewById<Button>(com.billable.app.R.id.btn_dialog_attach_receipt)
        val btnRemove = dialogView.findViewById<android.widget.ImageButton>(com.billable.app.R.id.btn_dialog_remove_receipt)

        var date = expense.date
        val originalReceiptPath = expense.receiptPath
        var newReceiptUri: Uri? = null
        var newReceiptMime: String? = null
        var receiptRemoved = false

        etAmount.setText(expense.amount.toString())
        etTitle.setText(expense.title)
        tvDate.text = TimeFormat.formatDateShort(date)
        tvDate.setOnClickListener { pickDate(date) { d -> date = d; tvDate.text = TimeFormat.formatDateShort(d) } }

        if (originalReceiptPath.isNotBlank()) { tvReceiptName.text = "Receipt attached"; btnRemove.visibility = View.VISIBLE }
        btnAttach.setOnClickListener {
            onReceiptPicked = { uri, mime ->
                newReceiptUri = uri; newReceiptMime = mime; receiptRemoved = false
                tvReceiptName.text = receiptLabel(mime)
                btnRemove.visibility = View.VISIBLE
            }
            pickReceiptLauncher.launch("image/*")
        }
        btnRemove.setOnClickListener {
            newReceiptUri = null; receiptRemoved = true
            tvReceiptName.text = "No receipt attached"
            btnRemove.visibility = View.GONE
        }

        android.app.AlertDialog.Builder(requireContext())
            .setTitle("Edit expense")
            .setView(dialogView)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save") { _, _ ->
                val amount = etAmount.text.toString().toDoubleOrNull()
                val title = etTitle.text.toString().trim()
                if (amount == null || amount <= 0 || title.isEmpty()) { toast("Enter a title and a valid amount."); return@setPositiveButton }

                val pickedUri = newReceiptUri
                val finalReceiptPath: String = when {
                    pickedUri != null -> {
                        val copied = ReceiptStore.copyToReceipts(requireContext(), pickedUri, newReceiptMime ?: "image/jpeg")
                        if (copied != null) {
                            if (originalReceiptPath.isNotBlank()) ReceiptStore.delete(requireContext(), originalReceiptPath)
                            copied
                        } else originalReceiptPath
                    }
                    receiptRemoved -> { if (originalReceiptPath.isNotBlank()) ReceiptStore.delete(requireContext(), originalReceiptPath); "" }
                    else -> originalReceiptPath
                }

                db.updateExpense(expense.id, date, title, Math.round(amount * 100) / 100.0, finalReceiptPath)
                refreshLists()
            }
            .show()
    }

    private fun onDeleteExpense(expense: Expense) {
        android.app.AlertDialog.Builder(requireContext())
            .setMessage("Delete this expense? This can't be undone.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ ->
                if (expense.receiptPath.isNotBlank()) ReceiptStore.delete(requireContext(), expense.receiptPath)
                db.deleteExpense(expense.id)
                refreshLists()
            }
            .show()
    }

    // ---------------- helpers ----------------

    private fun pickDate(current: String, onPicked: (String) -> Unit) {
        val parts = current.split("-").map { it.toInt() }
        val cal = Calendar.getInstance()
        cal.set(parts[0], parts[1] - 1, parts[2])
        DatePickerDialog(
            requireContext(),
            { _, y, m, d -> onPicked(String.format(java.util.Locale.US, "%04d-%02d-%02d", y, m + 1, d)) },
            cal.get(Calendar.YEAR), cal.get(Calendar.MONTH), cal.get(Calendar.DAY_OF_MONTH)
        ).show()
    }

    private fun toast(msg: String) = android.widget.Toast.makeText(requireContext(), msg, android.widget.Toast.LENGTH_SHORT).show()
}
