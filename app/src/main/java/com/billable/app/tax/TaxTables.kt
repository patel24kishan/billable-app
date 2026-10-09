package com.billable.app.tax

/** One tax to apply — a label shown on the invoice, and its rate as a decimal (0.14 = 14%). */
data class TaxLine(val label: String, val rate: Double)

/**
 * A small, editable tax-rate reference. Canada's provinces/territories are
 * built in and cover all three of the country's sales-tax shapes — harmonized
 * (HST), dual-rate (GST + a separate provincial tax), and GST-only — so
 * picking a province there fills in the correct line(s) automatically.
 *
 * Nobody can ship an accurate, current sales-tax table for every country and
 * sub-region in the world inside an app like this (there are thousands of
 * jurisdictions and they change constantly), so everywhere else — the United
 * States included, since it has no federal sales tax and rates vary by state
 * and even by city — falls back to up to two custom, user-entered tax lines.
 * Rates below were last checked in September 2026; confirm against your
 * local tax authority before relying on them, especially after a budget.
 */
object TaxTables {
    const val COUNTRY_CANADA = "Canada"
    const val COUNTRY_US = "United States"
    const val COUNTRY_OTHER = "Other / custom"

    val COUNTRIES = listOf(COUNTRY_CANADA, COUNTRY_US, COUNTRY_OTHER)

    /** Province/territory name -> the tax line(s) that apply there. */
    val CANADA_PROVINCES: LinkedHashMap<String, List<TaxLine>> = linkedMapOf(
        "Alberta" to listOf(TaxLine("GST", 0.05)),
        "British Columbia" to listOf(TaxLine("GST", 0.05), TaxLine("PST", 0.07)),
        "Manitoba" to listOf(TaxLine("GST", 0.05), TaxLine("RST", 0.07)),
        "New Brunswick" to listOf(TaxLine("HST", 0.15)),
        "Newfoundland and Labrador" to listOf(TaxLine("HST", 0.15)),
        "Nova Scotia" to listOf(TaxLine("HST", 0.14)),
        "Northwest Territories" to listOf(TaxLine("GST", 0.05)),
        "Nunavut" to listOf(TaxLine("GST", 0.05)),
        "Ontario" to listOf(TaxLine("HST", 0.13)),
        "Prince Edward Island" to listOf(TaxLine("HST", 0.15)),
        "Quebec" to listOf(TaxLine("GST", 0.05), TaxLine("QST", 0.09975)),
        "Saskatchewan" to listOf(TaxLine("GST", 0.05), TaxLine("PST", 0.06)),
        "Yukon" to listOf(TaxLine("GST", 0.05))
    )

    fun provincesFor(country: String): List<String> = if (country == COUNTRY_CANADA) CANADA_PROVINCES.keys.toList() else emptyList()

    fun taxLinesFor(country: String, region: String): List<TaxLine> =
        if (country == COUNTRY_CANADA) CANADA_PROVINCES[region] ?: emptyList() else emptyList()
}
