import './style.css';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable'; // patches jsPDF.prototype.autoTable
import { createLocalDb } from './lib/localDb.js';
import { createDownloads } from './lib/downloads.js';

(function () {
"use strict";

/* ---------------- helpers ---------------- */
function $(s,r){ return (r||document).querySelector(s); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function todayStr(){ var d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmtDateShort(iso){ var p=iso.split('-'); var d=new Date(+p[0],+p[1]-1,+p[2]); return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}); }
function fmtDuration(sec){ sec=Math.max(0,Math.round(sec)); var h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60; return [h,m,s].map(function(v){return String(v).padStart(2,'0');}).join(':'); }
function hoursFromSeconds(sec){ return Math.round((sec/3600)*100)/100; }
function money(n){ var c=(settings.currency||'$'); return c+(Math.round(n*100)/100).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function monthRange(monthStr){ // 'YYYY-MM'
  var p=monthStr.split('-'); var y=+p[0], m=+p[1];
  var start=y+'-'+String(m).padStart(2,'0')+'-01';
  var lastDay=new Date(y,m,0).getDate();
  var end=y+'-'+String(m).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
  return {start:start,end:end};
}
function monthLabel(monthStr){ var p=monthStr.split('-'); var d=new Date(+p[0],+p[1]-1,1); return d.toLocaleDateString(undefined,{month:'long',year:'numeric'}); }
function toast(msg,type){
  var el=$('#toast'); el.textContent=msg; el.className='toast'+(type?(' '+type):''); el.hidden=false;
  clearTimeout(toast._t); toast._t=setTimeout(function(){el.hidden=true;},3800);
}
var ACCEPTED_RECEIPT_TYPES={'image/jpeg':true,'image/png':true};
/** Reads an image file, downscales it, and resolves {dataUrl,type,width,height} — keeps stored receipts small. */
function fileToCompressedDataUrl(file){
  return new Promise(function(resolve,reject){
    if(!ACCEPTED_RECEIPT_TYPES[file.type]){ reject(new Error('Please choose a JPEG or PNG image.')); return; }
    var reader=new FileReader();
    reader.onerror=function(){ reject(new Error('Could not read the file.')); };
    reader.onload=function(){
      var img=new Image();
      img.onerror=function(){ reject(new Error('Could not decode the image.')); };
      img.onload=function(){
        var maxDim=1400;
        var scale=Math.min(1, maxDim/Math.max(img.naturalWidth,img.naturalHeight));
        var w=Math.max(1,Math.round(img.naturalWidth*scale)), h=Math.max(1,Math.round(img.naturalHeight*scale));
        var canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
        var ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,w,h);
        var outType = file.type==='image/png' ? 'image/png' : 'image/jpeg';
        var dataUrl = outType==='image/jpeg' ? canvas.toDataURL(outType,0.78) : canvas.toDataURL(outType);
        resolve({ dataUrl:dataUrl, type:outType, width:w, height:h });
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
function confirmDialog(text){
  return new Promise(function(resolve){
    var m=$('#confirmModal'); $('#confirmText').textContent=text; m.hidden=false;
    function cleanup(v){ m.hidden=true; ok.removeEventListener('click',onOk); cancel.removeEventListener('click',onCancel); resolve(v); }
    var ok=$('#confirmOkBtn'), cancel=$('#confirmCancelBtn');
    function onOk(){ cleanup(true); } function onCancel(){ cleanup(false); }
    ok.addEventListener('click',onOk); cancel.addEventListener('click',onCancel);
  });
}

/* ---------------- state ---------------- */
var db=null, downloadsCap=null;
var clients=[], entries=[], expenses=[], invoices=[];
var settings={ rate:0, currency:'$', businessName:'', businessEmail:'', businessAddress:'', notes:'', nextInvoiceNumber:1,
  taxCountry:'', taxRegion:'', taxCustomLabel1:'', taxCustomRate1:0, taxCustomLabel2:'', taxCustomRate2:0 };

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
var TAX_TABLES={
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
var CANADA_PROVINCES=Object.keys(TAX_TABLES);
function formatRatePct(rate){
  var pct=rate*100; var s=pct.toFixed(3).replace(/0+$/,'').replace(/\.$/,'');
  return s;
}
function getEffectiveTaxLines(){
  if(settings.taxCountry==='Canada') return TAX_TABLES[settings.taxRegion]||[];
  if(settings.taxCountry==='United States' || settings.taxCountry==='Other / custom'){
    var out=[];
    if(settings.taxCustomLabel1 && settings.taxCustomRate1>0) out.push({label:settings.taxCustomLabel1, rate:settings.taxCustomRate1});
    if(settings.taxCustomLabel2 && settings.taxCustomRate2>0) out.push({label:settings.taxCustomLabel2, rate:settings.taxCustomRate2});
    return out;
  }
  return [];
}
function taxJurisdictionLabel(){
  if(!settings.taxCountry) return '';
  return settings.taxRegion ? settings.taxRegion+', '+settings.taxCountry : settings.taxCountry;
}
var timerState={ status:'idle', clientId:null, clientName:'', description:'', accumulatedSeconds:0, segmentStartedAt:null, startedAt:null };
var timerTickHandle=null;
var editingClientId=null;
var invPreviewRows=null, invPreviewMeta=null;

function sessionElapsedSeconds(){
  var base = timerState.accumulatedSeconds||0;
  if(timerState.status==='running' && timerState.segmentStartedAt){
    base += (Date.now()-new Date(timerState.segmentStartedAt).getTime())/1000;
  }
  return base;
}

/* ---------------- nav ---------------- */
function goToView(name){
  document.querySelectorAll('.view').forEach(function(v){ v.classList.toggle('active', v.id==='view-'+name); });
  document.querySelectorAll('.nav-item').forEach(function(b){ b.classList.toggle('active', b.dataset.view===name); });
}
window.goToView=goToView;
$('#nav').addEventListener('click',function(e){
  var btn=e.target.closest('.nav-item'); if(!btn) return;
  goToView(btn.dataset.view);
});

/* ---------------- client dropdowns / list ---------------- */
function activeClients(){ return clients.filter(function(c){ return !c.archived; }); }
function fillClientSelect(sel, includeArchived){
  var prev=sel.value;
  var list = includeArchived ? clients : activeClients();
  sel.innerHTML = list.length ? list.map(function(c){ return '<option value="'+esc(c.id)+'">'+esc(c.name)+(c.archived?' (archived)':'')+'</option>'; }).join('') : '<option value="">No clients yet</option>';
  if(list.some(function(c){return c.id===prev;})) sel.value=prev;
}
function renderClientDropdowns(){
  fillClientSelect($('#timerClient'));
  fillClientSelect($('#manClient'));
  fillClientSelect($('#expClient'));
  fillClientSelect($('#invClient'), true);
}
function renderClients(){
  var list=$('#clientList');
  if(!clients.length){ list.innerHTML=''; $('#clientsEmpty').hidden=false; return; }
  $('#clientsEmpty').hidden=true;
  list.innerHTML = clients.map(function(c){
    return '<div class="client-row'+(c.archived?' archived':'')+'">'+
      '<div><div class="client-name">'+esc(c.name)+(c.archived?' <span class="pill pill-muted">Archived</span>':'')+'</div>'+
      '<div class="client-meta">'+esc(c.email||'')+(c.email&&c.address?' · ':'')+esc((c.address||'').split('\n')[0])+'</div></div>'+
      '<div class="row-actions">'+
        '<button class="btn btn-ghost btn-sm" data-edit="'+esc(c.id)+'">Edit</button>'+
        '<button class="btn btn-ghost btn-sm" data-archive="'+esc(c.id)+'">'+(c.archived?'Unarchive':'Archive')+'</button>'+
        '<button class="btn btn-icon" title="Delete permanently" data-delete="'+esc(c.id)+'">✕</button>'+
      '</div></div>';
  }).join('');
}
$('#clientList').addEventListener('click',function(e){
  var t=e.target;
  if(t.dataset.edit){ startEditClient(t.dataset.edit); }
  else if(t.dataset.archive){ toggleArchive(t.dataset.archive); }
  else if(t.dataset.delete){ deleteClient(t.dataset.delete); }
});
function startEditClient(id){
  var c=clients.find(function(x){return x.id===id;}); if(!c) return;
  editingClientId=id;
  $('#clientId').value=id; $('#clientName').value=c.name; $('#clientEmail').value=c.email||''; $('#clientAddress').value=c.address||'';
  $('#clientFormTitle').textContent='Edit client';
  $('#clientSaveBtn').textContent='Save Changes';
  $('#clientCancelBtn').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
$('#clientCancelBtn').addEventListener('click',resetClientForm);
function resetClientForm(){
  editingClientId=null; $('#clientForm').reset(); $('#clientId').value='';
  $('#clientFormTitle').textContent='Add a client'; $('#clientSaveBtn').textContent='Add Client'; $('#clientCancelBtn').hidden=true;
}
$('#clientForm').addEventListener('submit', function(e){
  e.preventDefault();
  if(!db){ toast('Not connected — try reloading the page.','error'); return; }
  var data={ name:$('#clientName').value.trim(), email:$('#clientEmail').value.trim(), address:$('#clientAddress').value.trim(), archived:false };
  if(!data.name) return;
  var p = editingClientId ? db.collection('clients').doc(editingClientId).update(data) : db.collection('clients').add(Object.assign(data,{createdAt:new Date().toISOString()}));
  p.then(function(){ toast(editingClientId?'Client updated.':'Client added.','success'); resetClientForm(); })
   .catch(function(err){ toast('Could not save client: '+err.message,'error'); });
});
function toggleArchive(id){
  var c=clients.find(function(x){return x.id===id;}); if(!c) return;
  db.collection('clients').doc(id).update({archived:!c.archived}).catch(function(err){ toast('Could not update client: '+err.message,'error'); });
}
function deleteClient(id){
  confirmDialog('Delete this client permanently? Past time entries and invoices will keep their record, but you won\'t be able to log new time for them.').then(function(ok){
    if(!ok) return;
    db.collection('clients').doc(id).delete().then(function(){ toast('Client deleted.'); }).catch(function(err){ toast('Could not delete: '+err.message,'error'); });
  });
}

/* ---------------- timer ---------------- */
var IDLE_TIMER={ status:'idle', clientId:null, clientName:'', description:'', accumulatedSeconds:0, segmentStartedAt:null, startedAt:null };
var descEditing=false; // true while the user has focus in the active-session description box, so live sync doesn't clobber their typing

function renderTimer(){
  var active = timerState.status!=='idle';
  $('#timerIdle').hidden=active;
  $('#timerActive').hidden=!active;
  $('#railTimer').hidden=!active;
  document.querySelector('.nav-item[data-view="track"]').classList.toggle('has-live', active);
  if(!active){
    if(timerTickHandle){ clearInterval(timerTickHandle); timerTickHandle=null; }
    return;
  }
  var labels={ running:'Tracking', paused:'Paused', stopped:'Ready to save' };
  $('#timerMeta').textContent=(labels[timerState.status]||'')+' — '+(timerState.clientName||'—');
  $('#railTimer').querySelector('.rail-timer-label').textContent=labels[timerState.status]||'Active';
  if(!descEditing && document.activeElement!==$('#timerActiveNote')) $('#timerActiveNote').value=timerState.description||'';
  renderTimerControls();
  tickTimer();
  if(timerState.status==='running'){
    if(!timerTickHandle) timerTickHandle=setInterval(tickTimer,1000);
  } else if(timerTickHandle){
    clearInterval(timerTickHandle); timerTickHandle=null;
  }
}
function renderTimerControls(){
  var wrap=$('#timerControls'); var s=timerState.status; var html='';
  if(s==='running'){
    html='<button class="btn btn-ghost" id="pauseTimerBtn" type="button">⏸ Pause</button><button class="btn btn-success" id="stopTimerBtn" type="button">■ Stop</button>';
  } else if(s==='paused'){
    html='<button class="btn btn-primary" id="resumeTimerBtn" type="button">▶ Resume</button><button class="btn btn-success" id="stopTimerBtn" type="button">■ Stop</button>';
  } else if(s==='stopped'){
    html='<button class="btn btn-ghost" id="resumeTimerBtn" type="button">↺ Resume</button><button class="btn btn-primary" id="saveTimerBtn" type="button">✓ Save Entry</button>';
  }
  wrap.innerHTML=html;
}
function tickTimer(){
  var d=fmtDuration(sessionElapsedSeconds());
  $('#timerDisplay').textContent=d;
  $('#railElapsed').textContent=d;
}
function setTimerDoc(patch){
  if(!db) return Promise.reject(new Error('not connected'));
  return db.doc('state/timer').set(Object.assign({}, timerState, patch));
}
$('#startTimerBtn').addEventListener('click',function(){
  if(!db) return;
  var clientId=$('#timerClient').value;
  if(!clientId){ toast('Add a client first.','error'); return; }
  var client=clients.find(function(c){return c.id===clientId;});
  var now=new Date().toISOString();
  db.doc('state/timer').set({
    status:'running', clientId:clientId, clientName:client?client.name:'', description:$('#timerNote').value.trim(),
    accumulatedSeconds:0, segmentStartedAt:now, startedAt:now
  }).then(function(){ $('#timerNote').value=''; }).catch(function(err){ toast('Could not start timer: '+err.message,'error'); });
});
document.getElementById('timerActive').addEventListener('focusin', function(e){ if(e.target.id==='timerActiveNote') descEditing=true; });
$('#timerActiveNote').addEventListener('change', function(){
  descEditing=false;
  if(timerState.status==='idle') return;
  setTimerDoc({description:$('#timerActiveNote').value.trim()}).catch(function(err){ toast('Could not update: '+err.message,'error'); });
});
$('#timerControls').addEventListener('click', function(e){
  var btn=e.target.closest('button'); if(!btn) return;
  if(btn.id==='pauseTimerBtn'){
    var elapsed=sessionElapsedSeconds();
    setTimerDoc({status:'paused', accumulatedSeconds:elapsed, segmentStartedAt:null}).catch(function(err){ toast('Could not pause: '+err.message,'error'); });
  } else if(btn.id==='resumeTimerBtn'){
    setTimerDoc({status:'running', segmentStartedAt:new Date().toISOString()}).catch(function(err){ toast('Could not resume: '+err.message,'error'); });
  } else if(btn.id==='stopTimerBtn'){
    var elapsed2=sessionElapsedSeconds();
    setTimerDoc({status:'stopped', accumulatedSeconds:elapsed2, segmentStartedAt:null}).catch(function(err){ toast('Could not stop: '+err.message,'error'); });
  } else if(btn.id==='saveTimerBtn'){
    saveTimerEntry();
  }
});
function saveTimerEntry(){
  if(!db || timerState.status!=='stopped') return;
  var seconds=Math.round(timerState.accumulatedSeconds||0);
  if(seconds<1){ toast('Nothing tracked yet.','error'); return; }
  var entry={
    clientId:timerState.clientId, clientName:timerState.clientName,
    date:(timerState.startedAt||new Date().toISOString()).slice(0,10), description:timerState.description||'', seconds:seconds,
    invoiced:false, createdAt:new Date().toISOString()
  };
  db.collection('entries').add(entry)
    .then(function(){ return db.doc('state/timer').set(IDLE_TIMER); })
    .then(function(){ toast('Saved '+hoursFromSeconds(seconds)+' hours to '+entry.clientName+'.','success'); })
    .catch(function(err){ toast('Could not save entry: '+err.message,'error'); });
}
$('#discardTimerBtn').addEventListener('click',function(){
  confirmDialog('Discard this session without saving it as an entry?').then(function(ok){
    if(!ok) return;
    db.doc('state/timer').set(IDLE_TIMER).catch(function(err){ toast('Could not discard: '+err.message,'error'); });
  });
});

/* ---------------- manual entry + recent list ---------------- */
$('#manDate').value=todayStr();
$('#manualForm').addEventListener('submit',function(e){
  e.preventDefault();
  if(!db) return;
  var clientId=$('#manClient').value; if(!clientId){ toast('Add a client first.','error'); return; }
  var client=clients.find(function(c){return c.id===clientId;});
  var hours=parseFloat($('#manHours').value); if(!hours||hours<=0) return;
  var entry={ clientId:clientId, clientName:client?client.name:'', date:$('#manDate').value||todayStr(), description:$('#manDesc').value.trim(), seconds:Math.round(hours*3600), invoiced:false, createdAt:new Date().toISOString() };
  db.collection('entries').add(entry).then(function(){
    toast('Entry added.','success'); $('#manualForm').reset(); $('#manDate').value=todayStr();
  }).catch(function(err){ toast('Could not add entry: '+err.message,'error'); });
});

var entriesUnsub=null;
function subscribeEntries(){
  if(entriesUnsub) entriesUnsub();
  entriesUnsub = db.collection('entries').orderBy('date','desc').limit(200).onSnapshot(function(snap){
    entries = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderEntries();
  }, function(err){ toast('Time log error: '+err.message,'error'); });
}
function renderEntries(){
  var body=$('#entriesBody');
  if(!entries.length){ body.innerHTML=''; $('#entriesEmpty').hidden=false; return; }
  $('#entriesEmpty').hidden=true;
  body.innerHTML = entries.map(function(e){
    return '<tr><td>'+fmtDateShort(e.date)+'</td><td>'+esc(e.clientName)+'</td><td>'+esc(e.description||'—')+
      (e.invoiced?' <span class="pill pill-success" style="margin-left:6px;">Invoiced</span>':'')+
      '</td><td class="hours num">'+hoursFromSeconds(e.seconds).toFixed(2)+'</td>'+
      '<td class="row-actions"><button class="btn btn-icon" title="Edit" data-edit-entry="'+esc(e.id)+'">✎</button>'+
      '<button class="btn btn-icon" title="Delete" data-del-entry="'+esc(e.id)+'">✕</button></td></tr>';
  }).join('');
}
$('#entriesBody').addEventListener('click',function(e){
  var btn=e.target.closest('button'); if(!btn) return;
  if(btn.dataset.delEntry){
    var id=btn.dataset.delEntry;
    confirmDialog('Delete this time entry? This can\'t be undone.').then(function(ok){
      if(!ok) return;
      db.collection('entries').doc(id).delete().catch(function(err){ toast('Could not delete: '+err.message,'error'); });
    });
  } else if(btn.dataset.editEntry){
    openEditEntry(btn.dataset.editEntry);
  }
});
function openEditEntry(id){
  var en=entries.find(function(x){return x.id===id;}); if(!en) return;
  $('#editEntryId').value=id; $('#editEntryDate').value=en.date; $('#editEntryHours').value=hoursFromSeconds(en.seconds); $('#editEntryDesc').value=en.description||'';
  $('#editEntryModal').hidden=false;
}
$('#editEntryCancelBtn').addEventListener('click', function(){ $('#editEntryModal').hidden=true; });
$('#editEntrySaveBtn').addEventListener('click', function(){
  var id=$('#editEntryId').value; var hours=parseFloat($('#editEntryHours').value);
  if(!hours||hours<=0){ toast('Enter a valid number of hours.','error'); return; }
  db.collection('entries').doc(id).update({ date:$('#editEntryDate').value, seconds:Math.round(hours*3600), description:$('#editEntryDesc').value.trim() })
    .then(function(){ $('#editEntryModal').hidden=true; toast('Entry updated.','success'); })
    .catch(function(err){ toast('Could not update: '+err.message,'error'); });
});

/* ---------------- expenses ---------------- */
$('#expDate').value=todayStr();
$('#expenseForm').addEventListener('submit', async function(e){
  e.preventDefault();
  if(!db) return;
  var clientId=$('#expClient').value; if(!clientId){ toast('Add a client first.','error'); return; }
  var client=clients.find(function(c){return c.id===clientId;});
  var amount=parseFloat($('#expAmount').value); if(!amount||amount<=0) return;
  var exp={ clientId:clientId, clientName:client?client.name:'', date:$('#expDate').value||todayStr(), title:$('#expTitle').value.trim(), amount:Math.round(amount*100)/100, invoiced:false, createdAt:new Date().toISOString() };
  var receiptFile=$('#expReceipt').files[0];
  var submitBtn=$('#expSubmitBtn');
  if(receiptFile){
    submitBtn.disabled=true; submitBtn.textContent='Attaching receipt…';
    try{
      var receipt=await fileToCompressedDataUrl(receiptFile);
      exp.receiptData=receipt.dataUrl; exp.receiptType=receipt.type; exp.receiptW=receipt.width; exp.receiptH=receipt.height;
    }catch(err){ toast(err.message,'error'); submitBtn.disabled=false; submitBtn.textContent='Add Expense'; return; }
  }
  db.collection('expenses').add(exp).then(function(){
    toast('Expense added.','success'); $('#expenseForm').reset(); $('#expDate').value=todayStr();
  }).catch(function(err){ toast('Could not add expense: '+err.message,'error'); }).finally(function(){
    submitBtn.disabled=false; submitBtn.textContent='Add Expense';
  });
});
var expensesUnsub=null;
function subscribeExpenses(){
  if(expensesUnsub) expensesUnsub();
  expensesUnsub = db.collection('expenses').orderBy('date','desc').limit(200).onSnapshot(function(snap){
    expenses = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderExpenses();
  }, function(err){ toast('Expenses error: '+err.message,'error'); });
}
function renderExpenses(){
  var body=$('#expensesBody');
  if(!expenses.length){ body.innerHTML=''; $('#expensesEmpty').hidden=false; return; }
  $('#expensesEmpty').hidden=true;
  body.innerHTML = expenses.map(function(x){
    return '<tr><td>'+fmtDateShort(x.date)+'</td><td>'+esc(x.clientName)+'</td><td>'+esc(x.title)+
      (x.invoiced?' <span class="pill pill-success" style="margin-left:6px;">Invoiced</span>':'')+
      '</td><td class="amount num">'+money(x.amount)+'</td>'+
      '<td class="row-actions">'+
      (x.receiptData?'<button class="btn btn-icon" title="View receipt" data-view-receipt="'+esc(x.id)+'">📎</button>':'')+
      '<button class="btn btn-icon" title="Edit" data-edit-exp="'+esc(x.id)+'">✎</button>'+
      '<button class="btn btn-icon" title="Delete" data-del-exp="'+esc(x.id)+'">✕</button></td></tr>';
  }).join('');
}
$('#expensesBody').addEventListener('click', function(e){
  var btn=e.target.closest('button'); if(!btn) return;
  if(btn.dataset.delExp){
    var id=btn.dataset.delExp;
    confirmDialog('Delete this expense? This can\'t be undone.').then(function(ok){
      if(!ok) return;
      db.collection('expenses').doc(id).delete().catch(function(err){ toast('Could not delete: '+err.message,'error'); });
    });
  } else if(btn.dataset.editExp){
    openEditExpense(btn.dataset.editExp);
  } else if(btn.dataset.viewReceipt){
    var x=expenses.find(function(e){return e.id===btn.dataset.viewReceipt;}); if(!x||!x.receiptData) return;
    $('#receiptViewTitle').textContent='Receipt — '+x.title;
    $('#receiptViewImg').src=x.receiptData;
    $('#receiptViewModal').hidden=false;
  }
});
$('#receiptViewCloseBtn').addEventListener('click', function(){ $('#receiptViewModal').hidden=true; $('#receiptViewImg').src=''; });
var editExpenseReceiptRemoved=false;
function openEditExpense(id){
  var x=expenses.find(function(e){return e.id===id;}); if(!x) return;
  $('#editExpenseId').value=id; $('#editExpenseDate').value=x.date; $('#editExpenseAmount').value=x.amount; $('#editExpenseTitle').value=x.title;
  $('#editExpenseReceiptFile').value='';
  editExpenseReceiptRemoved=false;
  if(x.receiptData){ $('#editExpenseReceiptThumb').src=x.receiptData; $('#editExpenseReceiptCurrent').hidden=false; }
  else { $('#editExpenseReceiptCurrent').hidden=true; $('#editExpenseReceiptThumb').src=''; }
  $('#editExpenseModal').hidden=false;
}
$('#editExpenseCancelBtn').addEventListener('click', function(){ $('#editExpenseModal').hidden=true; });
$('#editExpenseReceiptRemoveBtn').addEventListener('click', function(){
  editExpenseReceiptRemoved=true;
  $('#editExpenseReceiptCurrent').hidden=true; $('#editExpenseReceiptThumb').src='';
});
$('#editExpenseSaveBtn').addEventListener('click', async function(){
  var id=$('#editExpenseId').value; var amount=parseFloat($('#editExpenseAmount').value);
  var title=$('#editExpenseTitle').value.trim();
  if(!amount||amount<=0||!title){ toast('Enter a title and a valid amount.','error'); return; }
  var data={ date:$('#editExpenseDate').value, amount:Math.round(amount*100)/100, title:title };
  var newFile=$('#editExpenseReceiptFile').files[0];
  var saveBtn=$('#editExpenseSaveBtn');
  if(newFile){
    saveBtn.disabled=true; saveBtn.textContent='Attaching…';
    try{
      var receipt=await fileToCompressedDataUrl(newFile);
      data.receiptData=receipt.dataUrl; data.receiptType=receipt.type; data.receiptW=receipt.width; data.receiptH=receipt.height;
    }catch(err){ toast(err.message,'error'); saveBtn.disabled=false; saveBtn.textContent='Save Changes'; return; }
  } else if(editExpenseReceiptRemoved){
    data.receiptData=null; data.receiptType=null; data.receiptW=null; data.receiptH=null;
  }
  db.collection('expenses').doc(id).update(data)
    .then(function(){ $('#editExpenseModal').hidden=true; toast('Expense updated.','success'); })
    .catch(function(err){ toast('Could not update: '+err.message,'error'); })
    .finally(function(){ saveBtn.disabled=false; saveBtn.textContent='Save Changes'; });
});

/* ---------------- invoices ---------------- */
(function(){ var d=new Date(); $('#invMonth').value=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); })();

$('#invPreviewBtn').addEventListener('click',function(){
  if(!db) return;
  var clientId=$('#invClient').value, monthVal=$('#invMonth').value;
  if(!clientId||!monthVal){ toast('Pick a client and month.','error'); return; }
  var range=monthRange(monthVal);
  var includeBilled=$('#invIncludeBilled').checked;
  Promise.all([
    db.collection('entries').where('clientId','==',clientId).where('date','>=',range.start).where('date','<=',range.end).get(),
    db.collection('expenses').where('clientId','==',clientId).where('date','>=',range.start).where('date','<=',range.end).get()
  ]).then(function(results){
    var timeRows=results[0].docs.map(function(d){ return Object.assign({type:'time', id:d.id}, d.data()); }).filter(function(r){ return includeBilled || !r.invoiced; });
    var expenseRows=results[1].docs.map(function(d){ return Object.assign({type:'expense', id:d.id}, d.data()); }).filter(function(r){ return includeBilled || !r.invoiced; });
    var rows=timeRows.concat(expenseRows);
    rows.sort(function(a,b){ return a.date<b.date?-1:a.date>b.date?1:(a.type<b.type?1:-1); });
    invPreviewRows=rows;
    invPreviewMeta={ clientId:clientId, client:clients.find(function(c){return c.id===clientId;}), month:monthVal, range:range };
    renderInvoicePreview();
  }).catch(function(err){ toast('Could not load entries: '+err.message,'error'); });
});
function computeInvoiceTotals(){
  var totalHours=0, subtotal=0;
  invPreviewRows.forEach(function(r){
    if(r.type==='expense'){ subtotal+=r.amount; }
    else { var h=hoursFromSeconds(r.seconds); totalHours+=h; subtotal+=Math.round(h*settings.rate*100)/100; }
  });
  totalHours=Math.round(totalHours*100)/100;
  subtotal=Math.round(subtotal*100)/100;
  var taxLines=getEffectiveTaxLines().map(function(t){ return { label:t.label, rate:t.rate, amount:Math.round(subtotal*t.rate*100)/100 }; });
  var taxTotal=Math.round(taxLines.reduce(function(a,t){return a+t.amount;},0)*100)/100;
  var grandTotal=Math.round((subtotal+taxTotal)*100)/100;
  return { totalHours:totalHours, subtotal:subtotal, taxLines:taxLines, taxTotal:taxTotal, grandTotal:grandTotal };
}
function renderInvoicePreview(){
  var wrap=$('#invPreviewWrap'); wrap.hidden=false;
  var body=$('#invPreviewBody');
  var foot=$('#invTotalsFoot');
  if(!invPreviewRows.length){ body.innerHTML=''; foot.innerHTML=''; $('#invPreviewEmpty').hidden=false; $('#invTaxJurisdiction').hidden=true; return; }
  $('#invPreviewEmpty').hidden=true;
  body.innerHTML = invPreviewRows.map(function(r){
    if(r.type==='expense'){
      return '<tr><td>'+fmtDateShort(r.date)+'</td><td>'+esc(r.title)+' <span class="pill pill-muted">Expense</span>'+
        (r.receiptData?' 📎':'')+'</td><td class="hours num">—</td><td class="amount num">'+money(r.amount)+'</td></tr>';
    }
    var h=hoursFromSeconds(r.seconds); var amt=Math.round(h*settings.rate*100)/100;
    return '<tr><td>'+fmtDateShort(r.date)+'</td><td>'+esc(r.description||'—')+'</td><td class="hours num">'+h.toFixed(2)+'</td><td class="amount num">'+money(amt)+'</td></tr>';
  }).join('');

  var t=computeInvoiceTotals();
  var footRows='<tr><td colspan="2">Subtotal</td><td class="hours num">'+t.totalHours.toFixed(2)+' hrs</td><td class="amount num">'+money(t.subtotal)+'</td></tr>';
  t.taxLines.forEach(function(line){
    footRows+='<tr><td colspan="2">'+esc(line.label)+' ('+formatRatePct(line.rate)+'%)</td><td></td><td class="amount num">'+money(line.amount)+'</td></tr>';
  });
  footRows+='<tr class="invoice-total-row"><td colspan="2">Total Due</td><td></td><td class="amount num">'+money(t.grandTotal)+'</td></tr>';
  foot.innerHTML=footRows;

  var jurisdiction=taxJurisdictionLabel();
  $('#invTaxJurisdiction').hidden=!jurisdiction;
  $('#invTaxJurisdiction').textContent='Tax jurisdiction: '+jurisdiction;
}

$('#invGenerateBtn').addEventListener('click', function(){ generateInvoicePdf(); });

function buildPdfDoc(invoiceDoc){
  var doc = new jsPDF({ unit:'pt', format:'letter' });
  var pageWidth = doc.internal.pageSize.getWidth();
  var margin = 48;

  doc.setFont('helvetica','bold'); doc.setFontSize(20);
  doc.text('INVOICE', margin, 64);

  doc.setFont('helvetica','normal'); doc.setFontSize(10); doc.setTextColor(90);
  doc.text('Invoice #'+invoiceDoc.number, margin, 82);
  doc.text('Date: '+new Date(invoiceDoc.generatedAt).toLocaleDateString(), margin, 96);
  doc.text('Period: '+monthLabel(invoiceDoc.month), margin, 110);

  doc.setTextColor(30); doc.setFont('helvetica','bold'); doc.setFontSize(11);
  doc.text(invoiceDoc.from.name || 'Your Business', pageWidth-margin, 64, {align:'right'});
  doc.setFont('helvetica','normal'); doc.setFontSize(9.5); doc.setTextColor(90);
  var y=78;
  (invoiceDoc.from.email? [invoiceDoc.from.email]:[]).concat((invoiceDoc.from.address||'').split('\n').filter(Boolean)).forEach(function(line){
    doc.text(line, pageWidth-margin, y, {align:'right'}); y+=13;
  });

  var billY=140;
  doc.setDrawColor(225); doc.line(margin,billY-14,pageWidth-margin,billY-14);
  doc.setTextColor(30); doc.setFont('helvetica','bold'); doc.setFontSize(10);
  doc.text('BILL TO', margin, billY);
  doc.setFont('helvetica','normal'); doc.setFontSize(10.5);
  doc.text(invoiceDoc.to.name||'Client', margin, billY+16);
  doc.setFontSize(9.5); doc.setTextColor(90);
  var y2=billY+30;
  (invoiceDoc.to.email? [invoiceDoc.to.email]:[]).concat((invoiceDoc.to.address||'').split('\n').filter(Boolean)).forEach(function(line){
    doc.text(line, margin, y2); y2+=12;
  });

  var rows = invoiceDoc.lineItems.map(function(li){
    return [fmtDateShort(li.date), (li.description||'—')+(li.type==='expense'?'  (expense)':''), li.type==='expense'?'—':li.hours.toFixed(2), invoiceDoc.currency+li.amount.toFixed(2)];
  });
  var grandTotalDisplay = (invoiceDoc.grandTotal!=null ? invoiceDoc.grandTotal : invoiceDoc.totalAmount);
  var footRows=[['', '', 'Subtotal', invoiceDoc.currency+invoiceDoc.totalAmount.toFixed(2)]];
  (invoiceDoc.taxLines||[]).forEach(function(t){
    footRows.push(['', '', t.label+' ('+formatRatePct(t.rate)+'%)', invoiceDoc.currency+t.amount.toFixed(2)]);
  });
  footRows.push(['', '', 'Total due', invoiceDoc.currency+grandTotalDisplay.toFixed(2)]);
  doc.autoTable({
    startY: Math.max(y2,billY+40)+16,
    margin:{left:margin,right:margin},
    head:[['Date','Description','Hours', 'Amount']],
    body: rows,
    styles:{ font:'helvetica', fontSize:9.5, textColor:40, cellPadding:6 },
    headStyles:{ fillColor:[52,82,225], textColor:255, fontStyle:'bold' },
    columnStyles:{ 2:{halign:'right',cellWidth:60}, 3:{halign:'right',cellWidth:80} },
    foot: footRows,
    footStyles:{ fillColor:[247,248,250], textColor:20, fontStyle:'bold' },
    didParseCell: function(data){
      // Only the very last foot row ("Total due") should read as the bold grand total; the rest are plain.
      if(data.section==='foot' && data.row.index < footRows.length-1){ data.cell.styles.fontStyle='normal'; data.cell.styles.fillColor=[255,255,255]; }
    }
  });

  var finalY = doc.lastAutoTable.finalY + 26;
  doc.setFontSize(9); doc.setTextColor(90); doc.setFont('helvetica','normal');
  doc.text('Rate: '+invoiceDoc.currency+invoiceDoc.rate.toFixed(2)+' / hour  ·  Total hours: '+invoiceDoc.totalHours.toFixed(2), margin, finalY);
  if(invoiceDoc.notes){
    var notesLines=doc.splitTextToSize(invoiceDoc.notes, pageWidth-margin*2);
    doc.text(notesLines, margin, finalY+20);
  }

  // Receipts: one per page, appended after the invoice itself, so the PDF doubles as its own expense-backup packet.
  (invoiceDoc.receipts||[]).forEach(function(r){
    doc.addPage();
    var pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(30);
    doc.text('Receipt — '+r.title, margin, margin);
    var availW=pageWidth-margin*2, availH=pageHeight-margin*2-24;
    var scale=Math.min(availW/r.width, availH/r.height, 1);
    var drawW=r.width*scale, drawH=r.height*scale;
    var left=margin+(availW-drawW)/2, top=margin+24;
    var fmt = r.type==='image/png' ? 'PNG' : 'JPEG';
    try{ doc.addImage(r.dataUrl, fmt, left, top, drawW, drawH); }catch(e){ /* skip a receipt that fails to embed rather than aborting the whole invoice */ }
  });

  return doc;
}

function generateInvoicePdf(){
  if(!invPreviewRows || !invPreviewMeta) return;
  if(!downloadsCap){ toast('Downloads aren\'t available in this view.','error'); return; }
  if(!invPreviewRows.length){ toast('Nothing to invoice for this period.','error'); return; }
  var client=invPreviewMeta.client;
  var timeRows=invPreviewRows.filter(function(r){return r.type==='time';});
  var expenseRows=invPreviewRows.filter(function(r){return r.type==='expense';});
  var totalSeconds=timeRows.reduce(function(a,r){return a+r.seconds;},0);
  var totalHours=hoursFromSeconds(totalSeconds);
  var timeAmount=Math.round(totalHours*(settings.rate||0)*100)/100;
  var expenseAmount=Math.round(expenseRows.reduce(function(a,r){return a+r.amount;},0)*100)/100;
  var invoiceNumber=settings.nextInvoiceNumber||1;
  var subtotal=Math.round((timeAmount+expenseAmount)*100)/100;
  var taxLines=getEffectiveTaxLines().map(function(t){ return { label:t.label, rate:t.rate, amount:Math.round(subtotal*t.rate*100)/100 }; });
  var taxTotal=Math.round(taxLines.reduce(function(a,t){return a+t.amount;},0)*100)/100;
  var grandTotal=Math.round((subtotal+taxTotal)*100)/100;
  var receipts=expenseRows.filter(function(r){return r.receiptData;}).map(function(r){
    return { title:r.title, dataUrl:r.receiptData, type:r.receiptType||'image/jpeg', width:r.receiptW||800, height:r.receiptH||600 };
  });
  var invoiceDoc={
    number: invoiceNumber, month: invPreviewMeta.month, generatedAt:new Date().toISOString(),
    from:{ name:settings.businessName, email:settings.businessEmail, address:settings.businessAddress },
    to:{ name: client?client.name:'Client', email: client?client.email:'', address: client?client.address:'' },
    currency: settings.currency||'$', rate: settings.rate||0,
    totalHours: totalHours, totalAmount: subtotal,
    taxLines: taxLines, taxTotal: taxTotal, grandTotal: grandTotal,
    notes: settings.notes||'',
    lineItems: invPreviewRows.map(function(r){
      if(r.type==='expense') return { type:'expense', date:r.date, description:r.title, amount:r.amount };
      var h=hoursFromSeconds(r.seconds);
      return { type:'time', date:r.date, description:r.description||'', hours:h, amount:Math.round(h*(settings.rate||0)*100)/100 };
    }),
    receipts: receipts
  };
  var pdf;
  try{ pdf=buildPdfDoc(invoiceDoc); }catch(err){ toast('Could not build the PDF: '+err.message,'error'); return; }
  var blob=pdf.output('blob');
  var filename='Invoice-'+String(invoiceNumber).padStart(4,'0')+'-'+(client?client.name.replace(/[^a-z0-9]+/gi,'-'):'client')+'-'+invoiceDoc.month+'.pdf';
  var genBtn=$('#invGenerateBtn'); genBtn.disabled=true; genBtn.textContent='Saving…';
  downloadsCap.save({ filename:filename, data:blob }).then(function(){
    toast('Invoice #'+invoiceNumber+' saved.','success');
    var entryIds=timeRows.map(function(r){return r.id;});
    var expenseIds=expenseRows.map(function(r){return r.id;});
    var invoiceRecord=Object.assign({}, invoiceDoc, { entryIds:entryIds, expenseIds:expenseIds, clientId:invPreviewMeta.clientId, clientName:client?client.name:'' });
    return db.collection('invoices').add(invoiceRecord).then(function(ref){
      var updates=entryIds.map(function(id){ return db.collection('entries').doc(id).update({invoiced:true, invoiceId:ref.id}); })
        .concat(expenseIds.map(function(id){ return db.collection('expenses').doc(id).update({invoiced:true, invoiceId:ref.id}); }));
      return Promise.all(updates);
    }).then(function(){
      return db.doc('settings/main').update({ nextInvoiceNumber: invoiceNumber+1 });
    });
  }).catch(function(err){
    if(err && err.code==='declined'){ toast('Invoice download was declined — nothing was recorded.'); }
    else { toast('Could not save invoice: '+(err&&err.message?err.message:'unknown error'),'error'); }
  }).finally(function(){
    genBtn.disabled=false; genBtn.textContent='Generate PDF Invoice';
  });
}

var invoicesUnsub=null;
function subscribeInvoices(){
  if(invoicesUnsub) invoicesUnsub();
  invoicesUnsub = db.collection('invoices').orderBy('generatedAt','desc').limit(100).onSnapshot(function(snap){
    invoices = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderInvoices();
  }, function(err){ toast('Invoice history error: '+err.message,'error'); });
}
function renderInvoices(){
  var body=$('#invoicesBody');
  if(!invoices.length){ body.innerHTML=''; $('#invoicesEmpty').hidden=false; return; }
  $('#invoicesEmpty').hidden=true;
  body.innerHTML = invoices.map(function(inv){
    var due = (inv.grandTotal!=null ? inv.grandTotal : inv.totalAmount);
    return '<tr><td class="num">#'+String(inv.number).padStart(4,'0')+'</td><td>'+esc(inv.clientName)+'</td><td>'+esc(monthLabel(inv.month))+'</td>'+
      '<td class="hours num">'+inv.totalHours.toFixed(2)+'</td><td class="amount num">'+inv.currency+due.toFixed(2)+'</td>'+
      '<td><button class="btn btn-ghost btn-sm" data-redownload="'+esc(inv.id)+'">Re-download</button></td></tr>';
  }).join('');
}
$('#invoicesBody').addEventListener('click', function(e){
  var id=e.target.dataset.redownload; if(!id) return;
  var inv=invoices.find(function(x){return x.id===id;}); if(!inv) return;
  if(!downloadsCap){ toast('Downloads aren\'t available in this view.','error'); return; }
  var pdf;
  try{ pdf=buildPdfDoc(inv); }catch(err){ toast('Could not rebuild PDF: '+err.message,'error'); return; }
  var blob=pdf.output('blob');
  var filename='Invoice-'+String(inv.number).padStart(4,'0')+'-'+inv.clientName.replace(/[^a-z0-9]+/gi,'-')+'-'+inv.month+'.pdf';
  downloadsCap.save({filename:filename,data:blob}).catch(function(err){ if(err.code!=='declined') toast('Could not save: '+err.message,'error'); });
});

/* ---------------- settings ---------------- */
function isCustomTaxCountry(c){ return c==='United States' || c==='Other / custom'; }
function populateProvinceSelect(){
  var sel=$('#taxProvince');
  if(!sel.options.length){ sel.innerHTML = CANADA_PROVINCES.map(function(p){return '<option value="'+esc(p)+'">'+esc(p)+'</option>';}).join(''); }
}
function getFormTaxLines(){
  var country=$('#taxCountry').value;
  if(country==='Canada') return TAX_TABLES[$('#taxProvince').value]||[];
  if(isCustomTaxCountry(country)){
    var out=[];
    var l1=$('#taxLabel1').value.trim(), r1=parseFloat($('#taxRate1').value)||0;
    if(l1 && r1>0) out.push({label:l1, rate:r1/100});
    var l2=$('#taxLabel2').value.trim(), r2=parseFloat($('#taxRate2').value)||0;
    if(l2 && r2>0) out.push({label:l2, rate:r2/100});
    return out;
  }
  return [];
}
function updateTaxPreviewUI(){
  var lines=getFormTaxLines();
  $('#taxPreview').textContent = lines.length ? 'Applied to invoices: '+lines.map(function(t){return t.label+' '+formatRatePct(t.rate)+'%';}).join('  +  ') : 'No tax will be added to invoices.';
}
$('#taxCountry').addEventListener('change', function(){
  var c=$('#taxCountry').value;
  $('#taxProvinceField').hidden = c!=='Canada';
  $('#taxCustomFields').hidden = !isCustomTaxCountry(c);
  if(c==='Canada') populateProvinceSelect();
  updateTaxPreviewUI();
});
$('#taxProvince').addEventListener('change', updateTaxPreviewUI);
['#taxLabel1','#taxRate1','#taxLabel2','#taxRate2'].forEach(function(sel){ $(sel).addEventListener('input', updateTaxPreviewUI); });

function renderSettings(){
  $('#setRate').value=settings.rate||'';
  $('#setCurrency').value=settings.currency||'$';
  $('#setNextInv').value=settings.nextInvoiceNumber||1;
  $('#setBizName').value=settings.businessName||'';
  $('#setBizEmail').value=settings.businessEmail||'';
  $('#setBizAddress').value=settings.businessAddress||'';
  $('#setNotes').value=settings.notes||'';

  populateProvinceSelect();
  var country=settings.taxCountry||'';
  $('#taxCountry').value=country;
  $('#taxProvinceField').hidden = country!=='Canada';
  $('#taxCustomFields').hidden = !isCustomTaxCountry(country);
  if(country==='Canada') $('#taxProvince').value=settings.taxRegion||'';
  if(isCustomTaxCountry(country)){
    $('#taxLabel1').value=settings.taxCustomLabel1||''; $('#taxRate1').value = settings.taxCustomRate1 ? formatRatePct(settings.taxCustomRate1) : '';
    $('#taxLabel2').value=settings.taxCustomLabel2||''; $('#taxRate2').value = settings.taxCustomRate2 ? formatRatePct(settings.taxCustomRate2) : '';
  } else {
    $('#taxLabel1').value=''; $('#taxRate1').value=''; $('#taxLabel2').value=''; $('#taxRate2').value='';
  }
  updateTaxPreviewUI();

  $('#setupBanner').hidden = !!(settings.rate && settings.businessName);
}
$('#saveSettingsBtn').addEventListener('click', function(){
  if(!db) return;
  var country=$('#taxCountry').value;
  var data={
    rate: parseFloat($('#setRate').value)||0, currency:$('#setCurrency').value.trim()||'$',
    nextInvoiceNumber: parseInt($('#setNextInv').value,10)||1,
    businessName:$('#setBizName').value.trim(), businessEmail:$('#setBizEmail').value.trim(),
    businessAddress:$('#setBizAddress').value.trim(), notes:$('#setNotes').value.trim(),
    taxCountry: country,
    taxRegion: country==='Canada' ? $('#taxProvince').value : '',
    taxCustomLabel1: isCustomTaxCountry(country) ? $('#taxLabel1').value.trim() : '',
    taxCustomRate1: isCustomTaxCountry(country) ? (parseFloat($('#taxRate1').value)||0)/100 : 0,
    taxCustomLabel2: isCustomTaxCountry(country) ? $('#taxLabel2').value.trim() : '',
    taxCustomRate2: isCustomTaxCountry(country) ? (parseFloat($('#taxRate2').value)||0)/100 : 0
  };
  db.doc('settings/main').set(data).then(function(){ toast('Settings saved.','success'); }).catch(function(err){ toast('Could not save: '+err.message,'error'); });
});

/* ---------------- boot ---------------- */
function subscribeSettings(){
  db.doc('settings/main').onSnapshot(function(snap){
    settings = Object.assign({ rate:0, currency:'$', businessName:'', businessEmail:'', businessAddress:'', notes:'', nextInvoiceNumber:1,
      taxCountry:'', taxRegion:'', taxCustomLabel1:'', taxCustomRate1:0, taxCustomLabel2:'', taxCustomRate2:0 }, snap.exists?snap.data():{});
    renderSettings();
    if(invPreviewRows) renderInvoicePreview();
  }, function(err){ toast('Settings error: '+err.message,'error'); });
}
function subscribeClientsList(){
  db.collection('clients').orderBy('name').onSnapshot(function(snap){
    clients = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderClients(); renderClientDropdowns();
  }, function(err){ toast('Clients error: '+err.message,'error'); });
}
function subscribeTimer(){
  db.doc('state/timer').onSnapshot(function(snap){
    timerState = snap.exists ? Object.assign({}, IDLE_TIMER, snap.data()) : Object.assign({}, IDLE_TIMER);
    renderTimer();
  }, function(err){ toast('Timer sync error: '+err.message,'error'); });
}

async function init(){
  try{
    db = await createLocalDb();
  }catch(err){
    toast('This page can\'t reach its local data store right now — reload to try again.','error');
    return;
  }
  downloadsCap = createDownloads();
  subscribeSettings();
  subscribeClientsList();
  subscribeEntries();
  subscribeExpenses();
  subscribeInvoices();
  subscribeTimer();
}
init();

})();
