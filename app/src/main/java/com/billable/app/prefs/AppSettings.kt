package com.billable.app.prefs

import android.content.Context
import com.billable.app.tax.TaxLine
import com.billable.app.tax.TaxTables

/**
 * Business-level settings shown on every invoice, plus the auto-incrementing
 * invoice number. Backed by a plain SharedPreferences file — there's only
 * ever one row of this data, so a database table would be overkill.
 */
object AppSettings {
    private const val FILE = "billable_settings"

    private const val KEY_RATE = "rate"
    private const val KEY_CURRENCY = "currency"
    private const val KEY_NEXT_INVOICE = "next_invoice_number"
    private const val KEY_BIZ_NAME = "biz_name"
    private const val KEY_BIZ_EMAIL = "biz_email"
    private const val KEY_BIZ_ADDRESS = "biz_address"
    private const val KEY_NOTES = "notes"

    private const val KEY_TAX_COUNTRY = "tax_country"
    private const val KEY_TAX_REGION = "tax_region"
    private const val KEY_TAX_CUSTOM_LABEL_1 = "tax_custom_label_1"
    private const val KEY_TAX_CUSTOM_RATE_1 = "tax_custom_rate_1"
    private const val KEY_TAX_CUSTOM_LABEL_2 = "tax_custom_label_2"
    private const val KEY_TAX_CUSTOM_RATE_2 = "tax_custom_rate_2"

    private fun prefs(ctx: Context) = ctx.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun getRate(ctx: Context): Double = prefs(ctx).getFloat(KEY_RATE, 0f).toDouble()
    fun setRate(ctx: Context, value: Double) { prefs(ctx).edit().putFloat(KEY_RATE, value.toFloat()).apply() }

    fun getCurrency(ctx: Context): String = prefs(ctx).getString(KEY_CURRENCY, "$") ?: "$"
    fun setCurrency(ctx: Context, value: String) { prefs(ctx).edit().putString(KEY_CURRENCY, value).apply() }

    fun getNextInvoiceNumber(ctx: Context): Int = prefs(ctx).getInt(KEY_NEXT_INVOICE, 1)
    fun setNextInvoiceNumber(ctx: Context, value: Int) { prefs(ctx).edit().putInt(KEY_NEXT_INVOICE, value).apply() }

    fun getBusinessName(ctx: Context): String = prefs(ctx).getString(KEY_BIZ_NAME, "") ?: ""
    fun setBusinessName(ctx: Context, value: String) { prefs(ctx).edit().putString(KEY_BIZ_NAME, value).apply() }

    fun getBusinessEmail(ctx: Context): String = prefs(ctx).getString(KEY_BIZ_EMAIL, "") ?: ""
    fun setBusinessEmail(ctx: Context, value: String) { prefs(ctx).edit().putString(KEY_BIZ_EMAIL, value).apply() }

    fun getBusinessAddress(ctx: Context): String = prefs(ctx).getString(KEY_BIZ_ADDRESS, "") ?: ""
    fun setBusinessAddress(ctx: Context, value: String) { prefs(ctx).edit().putString(KEY_BIZ_ADDRESS, value).apply() }

    fun getNotes(ctx: Context): String = prefs(ctx).getString(KEY_NOTES, "") ?: ""
    fun setNotes(ctx: Context, value: String) { prefs(ctx).edit().putString(KEY_NOTES, value).apply() }

    fun isConfigured(ctx: Context): Boolean = getRate(ctx) > 0 && getBusinessName(ctx).isNotBlank()

    // ---------------- tax ----------------

    fun getTaxCountry(ctx: Context): String = prefs(ctx).getString(KEY_TAX_COUNTRY, "") ?: ""
    fun getTaxRegion(ctx: Context): String = prefs(ctx).getString(KEY_TAX_REGION, "") ?: ""

    fun getTaxCustomLabel1(ctx: Context): String = prefs(ctx).getString(KEY_TAX_CUSTOM_LABEL_1, "") ?: ""
    fun getTaxCustomRate1(ctx: Context): Double = prefs(ctx).getFloat(KEY_TAX_CUSTOM_RATE_1, 0f).toDouble()
    fun getTaxCustomLabel2(ctx: Context): String = prefs(ctx).getString(KEY_TAX_CUSTOM_LABEL_2, "") ?: ""
    fun getTaxCustomRate2(ctx: Context): Double = prefs(ctx).getFloat(KEY_TAX_CUSTOM_RATE_2, 0f).toDouble()

    /**
     * Saves the tax jurisdiction. For Canada, [customLabel1]/[customRate1]/etc. are ignored — the
     * rate(s) come from [TaxTables] for the chosen province. For anywhere else, up to two manual
     * label+rate pairs are stored (an empty label or a zero/blank rate means "unused").
     */
    fun setTaxSettings(
        ctx: Context, country: String, region: String,
        customLabel1: String, customRate1: Double, customLabel2: String, customRate2: Double
    ) {
        prefs(ctx).edit()
            .putString(KEY_TAX_COUNTRY, country)
            .putString(KEY_TAX_REGION, region)
            .putString(KEY_TAX_CUSTOM_LABEL_1, customLabel1)
            .putFloat(KEY_TAX_CUSTOM_RATE_1, customRate1.toFloat())
            .putString(KEY_TAX_CUSTOM_LABEL_2, customLabel2)
            .putFloat(KEY_TAX_CUSTOM_RATE_2, customRate2.toFloat())
            .apply()
    }

    /** The tax line(s) that currently apply, resolved from Canada's built-in table or the manual custom rates. */
    fun getEffectiveTaxLines(ctx: Context): List<TaxLine> {
        val country = getTaxCountry(ctx)
        if (country == TaxTables.COUNTRY_CANADA) return TaxTables.taxLinesFor(country, getTaxRegion(ctx))
        val out = ArrayList<TaxLine>()
        val l1 = getTaxCustomLabel1(ctx); val r1 = getTaxCustomRate1(ctx)
        if (l1.isNotBlank() && r1 > 0) out.add(TaxLine(l1, r1))
        val l2 = getTaxCustomLabel2(ctx); val r2 = getTaxCustomRate2(ctx)
        if (l2.isNotBlank() && r2 > 0) out.add(TaxLine(l2, r2))
        return out
    }

    /** Human-readable jurisdiction for display, e.g. "Nova Scotia, Canada", or "" if not set up. */
    fun getTaxJurisdictionLabel(ctx: Context): String {
        val country = getTaxCountry(ctx)
        if (country.isBlank()) return ""
        val region = getTaxRegion(ctx)
        return if (region.isNotBlank()) "$region, $country" else country
    }
}
