// Invoice workflow logic: preview rows, the invoice snapshot, the PDF filename,
// and recording a generated invoice. No DOM; only recordInvoice touches the store.
import { hoursFromSeconds } from '../domain/dates.js';
import { computeInvoiceTotals } from '../domain/invoiceTotals.js';
import { hasReceipt, getReceipt } from '../lib/receipts.js';
import { COLLECTIONS, DOCS } from '../lib/schema.js';
import { compareValues } from '../domain/order.js';

/**
 * entryDatas / expenseDatas: arrays of {id, ...data}. Returns the preview rows
 * ({type, id, ...data}), un-invoiced only unless includeBilled, in invoice line
 * order (compareInvoiceRows).
 */
export function buildPreviewRows(entryDatas, expenseDatas, includeBilled){
  var timeRows=entryDatas.map(function(d){ return Object.assign({type:'time', id:d.id}, d); }).filter(function(r){ return includeBilled || !r.invoiced; });
  var expenseRows=expenseDatas.map(function(d){ return Object.assign({type:'expense', id:d.id}, d); }).filter(function(r){ return includeBilled || !r.invoiced; });
  var rows=timeRows.concat(expenseRows);
  rows.sort(compareInvoiceRows);
  return rows;
}

/**
 * D1/D2: sets attachReceipt on every expense row of newRows that has a receipt.
 * With prevRows (a reload of the same preview), an expense keeps its previous
 * choice exactly as the user left it, even when its receipt was replaced; it
 * defaults to attached only when there is no previous choice for that id (a
 * new row, or a receipt added to an expense that had none). Without prevRows
 * every receipt is attached (a fresh preview). Mutates and returns newRows.
 */
export function applyAttachReceipt(newRows, prevRows){
  var prev={};
  (prevRows||[]).forEach(function(r){ if(r.type==='expense' && hasReceipt(r)) prev[r.id]=r; });
  newRows.forEach(function(r){
    if(r.type!=='expense' || !hasReceipt(r)) return;
    var p=prev[r.id];
    r.attachReceipt = p ? p.attachReceipt!==false : true;
  });
  return newRows;
}

var TYPE_RANK={ time:0, expense:1 };
/**
 * Invoice line order: date asc, then time rows before expense rows, then
 * createdAt asc, then id asc. A total order: 0 only for identical keys, so the
 * result never depends on the input (IndexedDB) order.
 */
export function compareInvoiceRows(a,b){
  return compareValues(a.date, b.date)
    || compareValues(TYPE_RANK[a.type], TYPE_RANK[b.type])
    || compareValues(a.createdAt, b.createdAt)
    || compareValues(a.id, b.id);
}

/**
 * The invoice snapshot that is rendered to PDF and stored in history.
 * meta: { client, month }. Returns { invoiceDoc, timeRows, expenseRows }.
 */
export function buildInvoiceDoc({ rows, meta, settings, generatedAt }){
  var client=meta.client;
  var timeRows=rows.filter(function(r){return r.type==='time';});
  var expenseRows=rows.filter(function(r){return r.type==='expense';});
  var invoiceNumber=settings.nextInvoiceNumber||1;
  // Same totals as the preview (per-entry rounding), so the saved invoice equals the sum of its line items.
  var totals=computeInvoiceTotals(rows, settings);
  var totalHours=totals.totalHours, subtotal=totals.subtotal, taxLines=totals.taxLines, taxTotal=totals.taxTotal, grandTotal=totals.grandTotal;
  var receipts=expenseRows.filter(function(r){return hasReceipt(r) && r.attachReceipt!==false;}).map(function(r){
    var rc=getReceipt(r);
    return { title:r.title, dataUrl:rc.dataUrl, type:rc.type||'image/jpeg', width:rc.width||800, height:rc.height||600 };
  });
  var invoiceDoc={
    number: invoiceNumber, month: meta.month, generatedAt:generatedAt,
    from:{ name:settings.businessName, email:settings.businessEmail, address:settings.businessAddress },
    to:{ name: client?client.name:'Client', email: client?client.email:'', address: client?client.address:'' },
    currency: settings.currency||'$', rate: settings.rate||0,
    totalHours: totalHours, totalAmount: subtotal,
    taxLines: taxLines, taxTotal: taxTotal, grandTotal: grandTotal,
    notes: settings.notes||'',
    lineItems: rows.map(function(r){
      if(r.type==='expense') return { type:'expense', date:r.date, description:r.title, amount:r.amount };
      var h=hoursFromSeconds(r.seconds);
      return { type:'time', date:r.date, description:r.description||'', hours:h, amount:Math.round(h*(settings.rate||0)*100)/100 };
    }),
    receipts: receipts
  };
  return { invoiceDoc:invoiceDoc, timeRows:timeRows, expenseRows:expenseRows };
}

/** 'Invoice-0007-Acme-Co-2026-10.pdf'. Callers sanitize nameSegment. */
export function invoicePdfFilename(number, nameSegment, month){
  return 'Invoice-'+String(number).padStart(4,'0')+'-'+nameSegment+'-'+month+'.pdf';
}

/** Saves the invoice, marks its entries/expenses invoiced, then bumps nextInvoiceNumber. */
export function recordInvoice(store, { invoiceDoc, entryIds, expenseIds, clientId, clientName }){
  var invoiceRecord=Object.assign({}, invoiceDoc, { entryIds:entryIds, expenseIds:expenseIds, clientId:clientId, clientName:clientName });
  return store.collection(COLLECTIONS.invoices).add(invoiceRecord).then(function(ref){
    var updates=entryIds.map(function(id){ return store.collection(COLLECTIONS.entries).doc(id).update({invoiced:true, invoiceId:ref.id}); })
      .concat(expenseIds.map(function(id){ return store.collection(COLLECTIONS.expenses).doc(id).update({invoiced:true, invoiceId:ref.id}); }));
    return Promise.all(updates);
  }).then(function(){
    return store.doc(DOCS.settings).update({ nextInvoiceNumber: invoiceDoc.number+1 });
  });
}
