package com.billable.app.ui.settings

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.AdapterView
import android.widget.ArrayAdapter
import android.widget.Toast
import androidx.fragment.app.Fragment
import com.billable.app.databinding.FragmentSettingsBinding
import com.billable.app.prefs.AppSettings
import com.billable.app.tax.TaxLine
import com.billable.app.tax.TaxTables
import java.util.Locale

class SettingsFragment : Fragment() {

    private var _binding: FragmentSettingsBinding? = null
    private val binding get() = _binding!!

    // Index 0 means "no tax configured" — not one of TaxTables.COUNTRIES, so it maps to an empty
    // stored country and getEffectiveTaxLines() naturally resolves to no tax lines.
    private val countryOptions = listOf("No tax / not set") + TaxTables.COUNTRIES

    // True while load() is programmatically driving the spinners, so their change listeners
    // don't clobber the just-loaded province/custom-rate values with defaults.
    private var suppressCountryCallback = false

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentSettingsBinding.inflate(inflater, container, false)
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        setupTaxCountrySpinner()
        load()
        binding.btnSave.setOnClickListener { save() }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    // ---------------- tax UI ----------------

    private fun setupTaxCountrySpinner() {
        val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, countryOptions)
        adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
        binding.spinnerTaxCountry.adapter = adapter
        binding.spinnerTaxCountry.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
            override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) {
                if (suppressCountryCallback) return
                onCountryChanged(countryOptions.getOrElse(position) { countryOptions[0] }, null)
            }
            override fun onNothingSelected(parent: AdapterView<*>?) {}
        }

        val watcher = object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { updateTaxPreview() }
            override fun afterTextChanged(s: Editable?) {}
        }
        binding.etTaxLabel1.addTextChangedListener(watcher)
        binding.etTaxRate1.addTextChangedListener(watcher)
        binding.etTaxLabel2.addTextChangedListener(watcher)
        binding.etTaxRate2.addTextChangedListener(watcher)
    }

    /** Shows/hides the province spinner or the custom-rate rows for [country], and refreshes the preview. */
    private fun onCountryChanged(country: String, selectedProvince: String?) {
        val isCanada = country == TaxTables.COUNTRY_CANADA
        val isCustom = country == TaxTables.COUNTRY_US || country == TaxTables.COUNTRY_OTHER
        binding.labelTaxProvince.visibility = if (isCanada) View.VISIBLE else View.GONE
        binding.spinnerTaxProvince.visibility = if (isCanada) View.VISIBLE else View.GONE
        binding.layoutTaxCustom.visibility = if (isCustom) View.VISIBLE else View.GONE

        if (isCanada) {
            val provinces = TaxTables.provincesFor(country)
            val adapter = ArrayAdapter(requireContext(), android.R.layout.simple_spinner_item, provinces)
            adapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item)
            binding.spinnerTaxProvince.adapter = adapter
            val idx = selectedProvince?.let { provinces.indexOf(it) }?.takeIf { it >= 0 } ?: 0
            binding.spinnerTaxProvince.setSelection(idx)
            binding.spinnerTaxProvince.onItemSelectedListener = object : AdapterView.OnItemSelectedListener {
                override fun onItemSelected(parent: AdapterView<*>?, view: View?, position: Int, id: Long) { updateTaxPreview() }
                override fun onNothingSelected(parent: AdapterView<*>?) {}
            }
        }
        updateTaxPreview()
    }

    private fun currentCountrySelection(): String = countryOptions.getOrNull(binding.spinnerTaxCountry.selectedItemPosition) ?: countryOptions[0]

    private fun customTaxLinesFromForm(): List<TaxLine> {
        val out = ArrayList<TaxLine>()
        val l1 = binding.etTaxLabel1.text.toString().trim()
        val r1 = (binding.etTaxRate1.text.toString().toDoubleOrNull() ?: 0.0) / 100.0
        if (l1.isNotBlank() && r1 > 0) out.add(TaxLine(l1, r1))
        val l2 = binding.etTaxLabel2.text.toString().trim()
        val r2 = (binding.etTaxRate2.text.toString().toDoubleOrNull() ?: 0.0) / 100.0
        if (l2.isNotBlank() && r2 > 0) out.add(TaxLine(l2, r2))
        return out
    }

    private fun formatRate(rate: Double): String {
        val pct = rate * 100.0
        val s = String.format(Locale.US, "%.3f", pct)
        return s.trimEnd('0').trimEnd('.')
    }

    private fun updateTaxPreview() {
        if (_binding == null) return
        val country = currentCountrySelection()
        val lines = when (country) {
            TaxTables.COUNTRY_CANADA -> {
                val province = (binding.spinnerTaxProvince.selectedItem as? String) ?: ""
                TaxTables.taxLinesFor(country, province)
            }
            TaxTables.COUNTRY_US, TaxTables.COUNTRY_OTHER -> customTaxLinesFromForm()
            else -> emptyList()
        }
        binding.tvTaxPreview.text = if (lines.isEmpty()) "No tax will be added to invoices."
        else "Applied to invoices: " + lines.joinToString("  +  ") { "${it.label} ${formatRate(it.rate)}%" }
    }

    // ---------------- load / save ----------------

    private fun load() {
        val ctx = requireContext()
        binding.etRate.setText(if (AppSettings.getRate(ctx) > 0) AppSettings.getRate(ctx).toString() else "")
        binding.etCurrency.setText(AppSettings.getCurrency(ctx))
        binding.etNextInvoice.setText(AppSettings.getNextInvoiceNumber(ctx).toString())
        binding.etBizName.setText(AppSettings.getBusinessName(ctx))
        binding.etBizEmail.setText(AppSettings.getBusinessEmail(ctx))
        binding.etBizAddress.setText(AppSettings.getBusinessAddress(ctx))
        binding.etNotes.setText(AppSettings.getNotes(ctx))

        val savedCountry = AppSettings.getTaxCountry(ctx)
        val countryIndex = countryOptions.indexOf(savedCountry).takeIf { it >= 0 } ?: 0

        if (savedCountry == TaxTables.COUNTRY_US || savedCountry == TaxTables.COUNTRY_OTHER) {
            binding.etTaxLabel1.setText(AppSettings.getTaxCustomLabel1(ctx))
            AppSettings.getTaxCustomRate1(ctx).let { if (it > 0) binding.etTaxRate1.setText(formatRate(it)) }
            binding.etTaxLabel2.setText(AppSettings.getTaxCustomLabel2(ctx))
            AppSettings.getTaxCustomRate2(ctx).let { if (it > 0) binding.etTaxRate2.setText(formatRate(it)) }
        }

        suppressCountryCallback = true
        binding.spinnerTaxCountry.setSelection(countryIndex)
        onCountryChanged(countryOptions[countryIndex], AppSettings.getTaxRegion(ctx))
        suppressCountryCallback = false
    }

    private fun save() {
        val ctx = requireContext()
        AppSettings.setRate(ctx, binding.etRate.text.toString().toDoubleOrNull() ?: 0.0)
        AppSettings.setCurrency(ctx, binding.etCurrency.text.toString().ifBlank { "$" })
        AppSettings.setNextInvoiceNumber(ctx, binding.etNextInvoice.text.toString().toIntOrNull() ?: 1)
        AppSettings.setBusinessName(ctx, binding.etBizName.text.toString().trim())
        AppSettings.setBusinessEmail(ctx, binding.etBizEmail.text.toString().trim())
        AppSettings.setBusinessAddress(ctx, binding.etBizAddress.text.toString().trim())
        AppSettings.setNotes(ctx, binding.etNotes.text.toString().trim())

        when (val country = currentCountrySelection()) {
            TaxTables.COUNTRY_CANADA -> {
                val province = (binding.spinnerTaxProvince.selectedItem as? String) ?: ""
                AppSettings.setTaxSettings(ctx, country, province, "", 0.0, "", 0.0)
            }
            TaxTables.COUNTRY_US, TaxTables.COUNTRY_OTHER -> {
                val l1 = binding.etTaxLabel1.text.toString().trim()
                val r1 = (binding.etTaxRate1.text.toString().toDoubleOrNull() ?: 0.0) / 100.0
                val l2 = binding.etTaxLabel2.text.toString().trim()
                val r2 = (binding.etTaxRate2.text.toString().toDoubleOrNull() ?: 0.0) / 100.0
                AppSettings.setTaxSettings(ctx, country, "", l1, r1, l2, r2)
            }
            else -> AppSettings.setTaxSettings(ctx, "", "", "", 0.0, "", 0.0)
        }

        Toast.makeText(ctx, "Settings saved.", Toast.LENGTH_SHORT).show()
    }
}
