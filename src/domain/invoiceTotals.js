// Invoice totals for the on-screen preview. Pure: no DOM, no store, never mutates its inputs.
import { hoursFromSeconds } from './dates.js';
import { getEffectiveTaxLines } from './tax.js';

/** rows: preview rows ({type:'time',seconds} | {type:'expense',amount}); settings: the settings object. */
export function computeInvoiceTotals(rows, settings){
  var totalHours=0, subtotal=0;
  rows.forEach(function(r){
    if(r.type==='expense'){ subtotal+=r.amount; }
    else { var h=hoursFromSeconds(r.seconds); totalHours+=h; subtotal+=Math.round(h*(settings.rate||0)*100)/100; }
  });
  totalHours=Math.round(totalHours*100)/100;
  subtotal=Math.round(subtotal*100)/100;
  var taxLines=getEffectiveTaxLines(settings).map(function(t){ return { label:t.label, rate:t.rate, amount:Math.round(subtotal*t.rate*100)/100 }; });
  var taxTotal=Math.round(taxLines.reduce(function(a,t){return a+t.amount;},0)*100)/100;
  var grandTotal=Math.round((subtotal+taxTotal)*100)/100;
  return { totalHours:totalHours, subtotal:subtotal, taxLines:taxLines, taxTotal:taxTotal, grandTotal:grandTotal };
}
