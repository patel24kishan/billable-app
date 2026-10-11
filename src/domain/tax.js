// Sales-tax tables and the rules that turn settings into tax lines. Pure: no DOM, no store.

/*
 * Canada's provinces/territories cover all three of the country's sales-tax
 * shapes — harmonized (HST), dual-rate (GST + a separate provincial tax), and
 * GST-only — so picking a province fills in the correct line(s) automatically.
 * Nobody can ship an accurate, current tax table for every country and
 * sub-region in the world (there are thousands of jurisdictions and they
 * change constantly), so everywhere else — the United States included, since
 * it has no federal sales tax and rates vary by state and even by city —
 * falls back to up to two custom, user-entered tax lines. Rates below were
 * last checked in September 2026; confirm against your local tax authority.
 */
export var TAX_TABLES={
  'Alberta':[{label:'GST',rate:0.05}],
  'British Columbia':[{label:'GST',rate:0.05},{label:'PST',rate:0.07}],
  'Manitoba':[{label:'GST',rate:0.05},{label:'RST',rate:0.07}],
  'New Brunswick':[{label:'HST',rate:0.15}],
  'Newfoundland and Labrador':[{label:'HST',rate:0.15}],
  'Nova Scotia':[{label:'HST',rate:0.14}],
  'Northwest Territories':[{label:'GST',rate:0.05}],
  'Nunavut':[{label:'GST',rate:0.05}],
  'Ontario':[{label:'HST',rate:0.13}],
  'Prince Edward Island':[{label:'HST',rate:0.15}],
  'Quebec':[{label:'GST',rate:0.05},{label:'QST',rate:0.09975}],
  'Saskatchewan':[{label:'GST',rate:0.05},{label:'PST',rate:0.06}],
  'Yukon':[{label:'GST',rate:0.05}]
};
export var CANADA_PROVINCES=Object.keys(TAX_TABLES);
export function formatRatePct(rate){
  var pct=rate*100; var s=pct.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  return s;
}
export function getEffectiveTaxLines(settings){
  if(settings.taxCountry==='Canada') return TAX_TABLES[settings.taxRegion]||[];
  if(settings.taxCountry==='United States' || settings.taxCountry==='Other / custom'){
    var out=[];
    if(settings.taxCustomLabel1 && settings.taxCustomRate1>0) out.push({label:settings.taxCustomLabel1, rate:settings.taxCustomRate1});
    if(settings.taxCustomLabel2 && settings.taxCustomRate2>0) out.push({label:settings.taxCustomLabel2, rate:settings.taxCustomRate2});
    return out;
  }
  return [];
}
export function taxJurisdictionLabel(settings){
  if(!settings.taxCountry) return '';
  return settings.taxRegion ? settings.taxRegion+', '+settings.taxCountry : settings.taxCountry;
}
export function isCustomTaxCountry(c){ return c==='United States' || c==='Other / custom'; }
