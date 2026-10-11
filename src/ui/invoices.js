// Invoices screen: preview, generate PDF, history and re-download.
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { state } from '../state.js';
import { COLLECTIONS } from '../lib/schema.js';
import { hasReceipt } from '../lib/receipts.js';
import { fmtDateShort, hoursFromSeconds, monthRange, monthLabel, currentMonthStr } from '../domain/dates.js';
import { money } from '../domain/money.js';
import { formatRatePct, taxJurisdictionLabel } from '../domain/tax.js';
import { computeInvoiceTotals } from '../domain/invoiceTotals.js';
import { buildPdfDoc } from '../services/invoicePdf.js';
import { buildPreviewRows, applyAttachReceipt, buildInvoiceDoc, invoicePdfFilename, recordInvoice } from '../services/invoices.js';
import { openEditExpense, onExpenseSaved, openEditEntry, onEntrySaved } from './dialogs.js';

var invoicesUnsub=null;

export function renderInvoicePreview(){
  var wrap=$('#invPreviewWrap'); wrap.hidden=false;
  var body=$('#invPreviewBody');
  var foot=$('#invTotalsFoot');
  if(!state.invPreviewRows.length){ body.innerHTML=''; foot.innerHTML=''; $('#invReceiptChoice').hidden=true; $('#invPreviewEmpty').hidden=false; $('#invTaxJurisdiction').hidden=true; return; }
  $('#invPreviewEmpty').hidden=true;
  // 13b-1: every row's Edit button sits in its own actions column (after Amount).
  function editCell(attr, id, label){
    return '<td class="col-actions"><button type="button" class="btn btn-icon inv-edit" title="Edit" aria-label="'+esc(label)+'" '+attr+'="'+esc(id)+'">✎</button></td>';
  }
  body.innerHTML = state.invPreviewRows.map(function(r){
    if(r.type==='expense'){
      return '<tr><td>'+fmtDateShort(r.date)+'</td><td>'+esc(r.title)+' <span class="pill pill-muted">Expense</span>'+
        (hasReceipt(r)?' 📎 <label class="attach-receipt"><input type="checkbox" data-attach-receipt="'+esc(r.id)+'"'+(r.attachReceipt!==false?' checked':'')+' aria-label="Attach receipt for '+esc(r.title)+'"> Attach receipt</label>':'')+
        '</td><td class="hours num">—</td><td class="amount num">'+money(r.amount, state.settings.currency)+'</td>'+
        editCell('data-edit-preview-exp', r.id, 'Edit expense '+r.title)+'</tr>';
    }
    var h=hoursFromSeconds(r.seconds); var amt=Math.round(h*state.settings.rate*100)/100;
    return '<tr><td>'+fmtDateShort(r.date)+'</td><td>'+esc(r.description||'—')+'</td><td class="hours num">'+h.toFixed(2)+'</td><td class="amount num">'+money(amt, state.settings.currency)+'</td>'+
      editCell('data-edit-preview-entry', r.id, 'Edit time entry '+fmtDateShort(r.date))+'</tr>';
  }).join('');

  $('#invReceiptChoice').hidden=!state.invPreviewRows.some(function(r){return r.type==='expense' && hasReceipt(r);});

  var t=computeInvoiceTotals(state.invPreviewRows, state.settings);
  // Footer rows: label (Date+Description), Hours, Amount, and an empty cell under the actions column.
  var actionsPad='<td class="col-actions"></td>';
  var footRows='<tr><td colspan="2">Subtotal</td><td class="hours num">'+t.totalHours.toFixed(2)+' hrs</td><td class="amount num">'+money(t.subtotal, state.settings.currency)+'</td>'+actionsPad+'</tr>';
  t.taxLines.forEach(function(line){
    footRows+='<tr><td colspan="2">'+esc(line.label)+' ('+formatRatePct(line.rate)+'%)</td><td></td><td class="amount num">'+money(line.amount, state.settings.currency)+'</td>'+actionsPad+'</tr>';
  });
  footRows+='<tr class="invoice-total-row"><td colspan="2">Total Due</td><td></td><td class="amount num">'+money(t.grandTotal, state.settings.currency)+'</td>'+actionsPad+'</tr>';
  foot.innerHTML=footRows;

  var jurisdiction=taxJurisdictionLabel(state.settings);
  $('#invTaxJurisdiction').hidden=!jurisdiction;
  $('#invTaxJurisdiction').textContent='Tax jurisdiction: '+jurisdiction;
}

// Drop the on-screen preview and its state (shared by generate success, B3, D2).
export function clearInvoicePreview(){
  state.invPreviewRows=null; state.invPreviewMeta=null;
  var wrap=$('#invPreviewWrap'); if(wrap) wrap.hidden=true;
}

/**
 * Loads the preview rows for a preview meta ({clientId, client, month, range,
 * includeBilled}) and renders them. Defaults to the current preview's meta
 * (a reload, D2). keepAttach carries each expense's receipt choice over by id
 * (applyAttachReceipt). A reload whose preview was cleared or replaced while
 * loading changes nothing. Resolves to the new rows, or null when nothing was
 * applied (no preview, or it went stale).
 */
export function loadInvoicePreview(opts){
  opts=opts||{};
  var meta=opts.meta||state.invPreviewMeta;
  var isReload=!opts.meta;
  if(!meta || !state.store) return Promise.resolve(null);
  var range=meta.range;
  return Promise.all([
    state.store.collection(COLLECTIONS.entries).where('clientId','==',meta.clientId).where('date','>=',range.start).where('date','<=',range.end).get(),
    state.store.collection(COLLECTIONS.expenses).where('clientId','==',meta.clientId).where('date','>=',range.start).where('date','<=',range.end).get()
  ]).then(function(results){
    if(isReload && state.invPreviewMeta!==meta) return null;
    var toData=function(d){ return Object.assign({id:d.id}, d.data()); };
    var rows=buildPreviewRows(results[0].docs.map(toData), results[1].docs.map(toData), meta.includeBilled);
    applyAttachReceipt(rows, opts.keepAttach ? state.invPreviewRows : null);
    state.invPreviewRows=rows;
    state.invPreviewMeta=meta;
    renderInvoicePreview();
    return rows;
  });
}

// The preview is "showing" while it has state and its panel is not hidden.
function previewShowing(){
  return !!(state.invPreviewRows && state.invPreviewMeta && !$('#invPreviewWrap').hidden);
}

// D2 / 13b-1: after an expense or a time entry is saved in its edit modal, reload a
// showing preview, keeping receipt ticks; a row that left the period gets a toast.
function savedReloader(type, movedText){
  return function(id){
    if(!previewShowing()) return Promise.resolve();
    var isRow=function(r){ return r.type===type && r.id===id; };
    var wasShown=state.invPreviewRows.some(isRow);
    return loadInvoicePreview({ keepAttach:true }).then(function(rows){
      if(rows && wasShown && !rows.some(isRow)) toast(movedText);
    }).catch(function(err){ toast('Could not reload the preview: '+err.message,'error'); });
  };
}
var onExpenseSavedReload=savedReloader('expense', 'Expense moved out of this invoice period.');
var onEntrySavedReload=savedReloader('time', 'Entry moved out of this invoice period.');

/** Called after every clients snapshot: a deleted client's preview is dropped (archive/rename keep it). */
export function onClientsChanged(){
  var meta=state.invPreviewMeta;
  if(meta && !state.clients.some(function(c){ return c.id===meta.clientId; })) clearInvoicePreview();
}

function generateInvoicePdf(){
  if(!state.invPreviewRows || !state.invPreviewMeta) return;
  if(!state.downloads){ toast('Downloads aren\'t available in this view.','error'); return; }
  if(!state.invPreviewRows.length){ toast('Nothing to invoice for this period.','error'); return; }
  var meta=state.invPreviewMeta;
  var client=meta.client;
  var built=buildInvoiceDoc({ rows:state.invPreviewRows, meta:meta, settings:state.settings, generatedAt:new Date().toISOString() });
  var invoiceDoc=built.invoiceDoc, timeRows=built.timeRows, expenseRows=built.expenseRows;
  var invoiceNumber=invoiceDoc.number;
  var pdf;
  try{ pdf=buildPdfDoc(invoiceDoc); }catch(err){ toast('Could not build the PDF: '+err.message,'error'); return; }
  var blob=pdf.output('blob');
  var filename=invoicePdfFilename(invoiceNumber, (client?client.name.replace(/[^a-z0-9]+/gi,'-'):'client'), invoiceDoc.month);
  var genBtn=$('#invGenerateBtn'); genBtn.disabled=true; genBtn.textContent='Saving…';
  state.downloads.save({ filename:filename, data:blob }).then(function(){
    toast('Invoice #'+invoiceNumber+' saved.','success');
    var entryIds=timeRows.map(function(r){return r.id;});
    var expenseIds=expenseRows.map(function(r){return r.id;});
    return recordInvoice(state.store, { invoiceDoc:invoiceDoc, entryIds:entryIds, expenseIds:expenseIds, clientId:state.invPreviewMeta.clientId, clientName:client?client.name:'' });
  }).then(function(){
    clearInvoicePreview();
  }).catch(function(err){
    if(err && err.code==='declined'){ toast('Invoice download was declined — nothing was recorded.'); }
    else { toast('Could not save invoice: '+(err&&err.message?err.message:'unknown error'),'error'); }
  }).finally(function(){
    genBtn.disabled=false; genBtn.textContent='Generate PDF Invoice';
  });
}

function renderInvoices(){
  var body=$('#invoicesBody');
  if(!state.invoices.length){ body.innerHTML=''; $('#invoicesEmpty').hidden=false; return; }
  $('#invoicesEmpty').hidden=true;
  body.innerHTML = state.invoices.map(function(inv){
    var due = (inv.grandTotal!=null ? inv.grandTotal : inv.totalAmount);
    return '<tr><td class="num">#'+String(inv.number).padStart(4,'0')+'</td><td>'+esc(inv.clientName)+'</td><td>'+esc(monthLabel(inv.month))+'</td>'+
      '<td class="hours num">'+inv.totalHours.toFixed(2)+'</td><td class="amount num">'+money(due, inv.currency)+'</td>'+
      '<td><button class="btn btn-ghost btn-sm" data-redownload="'+esc(inv.id)+'">Re-download</button></td></tr>';
  }).join('');
}

export function subscribe(){
  if(invoicesUnsub) invoicesUnsub();
  invoicesUnsub = state.store.collection(COLLECTIONS.invoices).orderBy('generatedAt','desc').limit(200).onSnapshot(function(snap){
    state.invoices = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderInvoices();
  }, function(err){ toast('Invoice history error: '+err.message,'error'); });
}

export function bind(){
  $('#invMonth').value=currentMonthStr();

  $('#invPreviewBtn').addEventListener('click',function(){
    if(!state.store) return;
    var clientId=$('#invClient').value, monthVal=$('#invMonth').value;
    if(!clientId||!monthVal){ toast('Pick a client and month.','error'); return; }
    var range=monthRange(monthVal);
    var includeBilled=$('#invIncludeBilled').checked;
    var meta={ clientId:clientId, client:state.clients.find(function(c){return c.id===clientId;}), month:monthVal, range:range, includeBilled:includeBilled };
    loadInvoicePreview({ meta:meta }).catch(function(err){ toast('Could not load entries: '+err.message,'error'); });
  });

  // D2 / 13b-1: edit an expense or a time entry from the preview; a successful save reloads the preview.
  $('#invPreviewBody').addEventListener('click', function(e){
    var btn=e.target.closest && e.target.closest('[data-edit-preview-exp],[data-edit-preview-entry]'); if(!btn) return;
    if(btn.dataset.editPreviewExp) openEditExpense(btn.dataset.editPreviewExp);
    else openEditEntry(btn.dataset.editPreviewEntry);
  });
  onExpenseSaved(onExpenseSavedReload);
  onEntrySaved(onEntrySavedReload);

  // B3: changing any selector invalidates the on-screen preview. Only user
  // `change` events fire these; programmatic option/value updates do not.
  ['#invMonth','#invClient','#invIncludeBilled'].forEach(function(sel){
    $(sel).addEventListener('change', clearInvoicePreview);
  });

  // D1: per-expense receipt choice lives on the preview rows only (no DB access, no clearing).
  $('#invPreviewBody').addEventListener('change', function(e){
    var id=e.target.dataset && e.target.dataset.attachReceipt; if(!id || !state.invPreviewRows) return;
    var row=state.invPreviewRows.find(function(r){return r.type==='expense' && r.id===id;});
    if(row) row.attachReceipt=!!e.target.checked;
  });
  function setAllReceipts(on){
    if(!state.invPreviewRows) return;
    state.invPreviewRows.forEach(function(r){ if(r.type==='expense' && hasReceipt(r)) r.attachReceipt=on; });
    renderInvoicePreview();
  }
  $('#invAttachAllBtn').addEventListener('click', function(){ setAllReceipts(true); });
  $('#invAttachNoneBtn').addEventListener('click', function(){ setAllReceipts(false); });

  $('#invGenerateBtn').addEventListener('click', function(){ generateInvoicePdf(); });

  $('#invoicesBody').addEventListener('click', function(e){
    var id=e.target.dataset.redownload; if(!id) return;
    var inv=state.invoices.find(function(x){return x.id===id;}); if(!inv) return;
    if(!state.downloads){ toast('Downloads aren\'t available in this view.','error'); return; }
    var pdf;
    try{ pdf=buildPdfDoc(inv); }catch(err){ toast('Could not rebuild PDF: '+err.message,'error'); return; }
    var blob=pdf.output('blob');
    var filename=invoicePdfFilename(inv.number, inv.clientName.replace(/[^a-z0-9]+/gi,'-'), inv.month);
    state.downloads.save({filename:filename,data:blob}).catch(function(err){ if(err.code!=='declined') toast('Could not save: '+err.message,'error'); });
  });
}
