// Track Time screen: the live timer, manual entries, recent entries, expenses.
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { confirmDialog, openEditEntry, openEditExpense, openReceiptView } from './dialogs.js';
import { state } from '../state.js';
import { COLLECTIONS, DOCS } from '../lib/schema.js';
import { fileToCompressedDataUrl, hasReceipt, receiptFields } from '../lib/receipts.js';
import { todayStr, fmtDateShort, fmtDuration, hoursFromSeconds } from '../domain/dates.js';
import { money } from '../domain/money.js';
import { IDLE_TIMER, TIMER_LABELS, sessionElapsedSeconds, startTimer, pauseTimer, resumeTimer, stopTimer, entryFromStoppedTimer } from '../domain/timer.js';

var timerTickHandle=null;
var descEditing=false; // true while the user has focus in the active-session description box, so live sync doesn't clobber their typing
var entriesUnsub=null;
var expensesUnsub=null;

/* ---------------- timer ---------------- */
export function renderTimer(){
  var active = state.timer.status!=='idle';
  $('#timerIdle').hidden=active;
  $('#timerActive').hidden=!active;
  $('#railTimer').hidden=!active;
  document.querySelector('.nav-item[data-view="track"]').classList.toggle('has-live', active);
  if(!active){
    if(timerTickHandle){ clearInterval(timerTickHandle); timerTickHandle=null; }
    return;
  }
  var labels=TIMER_LABELS;
  $('#timerMeta').textContent=(labels[state.timer.status]||'')+' — '+(state.timer.clientName||'—');
  $('#railTimer').querySelector('.rail-timer-label').textContent=labels[state.timer.status]||'Active';
  if(!descEditing && document.activeElement!==$('#timerActiveNote')) $('#timerActiveNote').value=state.timer.description||'';
  renderTimerControls();
  tickTimer();
  if(state.timer.status==='running'){
    if(!timerTickHandle) timerTickHandle=setInterval(tickTimer,1000);
  } else if(timerTickHandle){
    clearInterval(timerTickHandle); timerTickHandle=null;
  }
}
function renderTimerControls(){
  var wrap=$('#timerControls'); var s=state.timer.status; var html='';
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
  var d=fmtDuration(sessionElapsedSeconds(state.timer));
  $('#timerDisplay').textContent=d;
  $('#railElapsed').textContent=d;
}
function setTimerDoc(patch){
  if(!state.store) return Promise.reject(new Error('not connected'));
  return state.store.doc(DOCS.timer).set(Object.assign({}, state.timer, patch));
}
function saveTimerEntry(){
  if(!state.store || state.timer.status!=='stopped') return;
  var saved=entryFromStoppedTimer(state.timer, new Date().toISOString());
  var seconds=saved.seconds;
  if(seconds<1){ toast('Nothing tracked yet.','error'); return; }
  var entry=saved.entry;
  state.store.collection(COLLECTIONS.entries).add(entry)
    .then(function(){ return state.store.doc(DOCS.timer).set(IDLE_TIMER); })
    .then(function(){ toast('Saved '+hoursFromSeconds(seconds)+' hours to '+entry.clientName+'.','success'); })
    .catch(function(err){ toast('Could not save entry: '+err.message,'error'); });
}

export function subscribeTimer(){
  state.store.doc(DOCS.timer).onSnapshot(function(snap){
    state.timer = snap.exists ? Object.assign({}, IDLE_TIMER, snap.data()) : Object.assign({}, IDLE_TIMER);
    renderTimer();
  }, function(err){ toast('Timer sync error: '+err.message,'error'); });
}

/* ---------------- recent entries ---------------- */
export function subscribeEntries(){
  if(entriesUnsub) entriesUnsub();
  entriesUnsub = state.store.collection(COLLECTIONS.entries).orderBy('date','desc').limit(200).onSnapshot(function(snap){
    state.entries = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderEntries();
  }, function(err){ toast('Time log error: '+err.message,'error'); });
}
function renderEntries(){
  var body=$('#entriesBody');
  if(!state.entries.length){ body.innerHTML=''; $('#entriesEmpty').hidden=false; return; }
  $('#entriesEmpty').hidden=true;
  body.innerHTML = state.entries.map(function(e){
    return '<tr><td>'+fmtDateShort(e.date)+'</td><td>'+esc(e.clientName)+'</td><td>'+esc(e.description||'—')+
      (e.invoiced?' <span class="pill pill-success" style="margin-left:6px;">Invoiced</span>':'')+
      '</td><td class="hours num">'+hoursFromSeconds(e.seconds).toFixed(2)+'</td>'+
      '<td class="row-actions"><button class="btn btn-icon" title="Edit" data-edit-entry="'+esc(e.id)+'">✎</button>'+
      '<button class="btn btn-icon" title="Delete" data-del-entry="'+esc(e.id)+'">✕</button></td></tr>';
  }).join('');
}

/* ---------------- expenses ---------------- */
export function subscribeExpenses(){
  if(expensesUnsub) expensesUnsub();
  expensesUnsub = state.store.collection(COLLECTIONS.expenses).orderBy('date','desc').limit(200).onSnapshot(function(snap){
    state.expenses = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderExpenses();
  }, function(err){ toast('Expenses error: '+err.message,'error'); });
}
function renderExpenses(){
  var body=$('#expensesBody');
  if(!state.expenses.length){ body.innerHTML=''; $('#expensesEmpty').hidden=false; return; }
  $('#expensesEmpty').hidden=true;
  body.innerHTML = state.expenses.map(function(x){
    return '<tr><td>'+fmtDateShort(x.date)+'</td><td>'+esc(x.clientName)+'</td><td>'+esc(x.title)+
      (x.invoiced?' <span class="pill pill-success" style="margin-left:6px;">Invoiced</span>':'')+
      '</td><td class="amount num">'+money(x.amount, state.settings.currency)+'</td>'+
      '<td class="row-actions">'+
      (hasReceipt(x)?'<button class="btn btn-icon" title="View receipt" data-view-receipt="'+esc(x.id)+'">📎</button>':'')+
      '<button class="btn btn-icon" title="Edit" data-edit-exp="'+esc(x.id)+'">✎</button>'+
      '<button class="btn btn-icon" title="Delete" data-del-exp="'+esc(x.id)+'">✕</button></td></tr>';
  }).join('');
}

export function bind(){
  /* timer */
  $('#startTimerBtn').addEventListener('click',function(){
    if(!state.store) return;
    var clientId=$('#timerClient').value;
    if(!clientId){ toast('Add a client first.','error'); return; }
    var client=state.clients.find(function(c){return c.id===clientId;});
    var now=new Date().toISOString();
    state.store.doc(DOCS.timer).set(startTimer({
      clientId:clientId, clientName:client?client.name:'', description:$('#timerNote').value.trim()
    }, now)).then(function(){ $('#timerNote').value=''; }).catch(function(err){ toast('Could not start timer: '+err.message,'error'); });
  });
  document.getElementById('timerActive').addEventListener('focusin', function(e){ if(e.target.id==='timerActiveNote') descEditing=true; });
  $('#timerActiveNote').addEventListener('change', function(){
    descEditing=false;
    if(state.timer.status==='idle') return;
    setTimerDoc({description:$('#timerActiveNote').value.trim()}).catch(function(err){ toast('Could not update: '+err.message,'error'); });
  });
  $('#timerControls').addEventListener('click', function(e){
    var btn=e.target.closest('button'); if(!btn) return;
    if(btn.id==='pauseTimerBtn'){
      setTimerDoc(pauseTimer(state.timer)).catch(function(err){ toast('Could not pause: '+err.message,'error'); });
    } else if(btn.id==='resumeTimerBtn'){
      setTimerDoc(resumeTimer(state.timer, new Date().toISOString())).catch(function(err){ toast('Could not resume: '+err.message,'error'); });
    } else if(btn.id==='stopTimerBtn'){
      setTimerDoc(stopTimer(state.timer)).catch(function(err){ toast('Could not stop: '+err.message,'error'); });
    } else if(btn.id==='saveTimerBtn'){
      saveTimerEntry();
    }
  });
  $('#discardTimerBtn').addEventListener('click',function(){
    confirmDialog('Discard this session without saving it as an entry?').then(function(ok){
      if(!ok) return;
      state.store.doc(DOCS.timer).set(IDLE_TIMER).catch(function(err){ toast('Could not discard: '+err.message,'error'); });
    });
  });

  /* manual entry */
  $('#manDate').value=todayStr();
  $('#manualForm').addEventListener('submit',function(e){
    e.preventDefault();
    if(!state.store) return;
    var clientId=$('#manClient').value; if(!clientId){ toast('Add a client first.','error'); return; }
    var client=state.clients.find(function(c){return c.id===clientId;});
    var hours=parseFloat($('#manHours').value); if(!hours||hours<=0) return;
    var entry={ clientId:clientId, clientName:client?client.name:'', date:$('#manDate').value||todayStr(), description:$('#manDesc').value.trim(), seconds:Math.round(hours*3600), invoiced:false, createdAt:new Date().toISOString() };
    state.store.collection(COLLECTIONS.entries).add(entry).then(function(){
      toast('Entry added.','success'); $('#manualForm').reset(); $('#manDate').value=todayStr();
    }).catch(function(err){ toast('Could not add entry: '+err.message,'error'); });
  });

  /* recent entries */
  $('#entriesBody').addEventListener('click',function(e){
    var btn=e.target.closest('button'); if(!btn) return;
    if(btn.dataset.delEntry){
      var id=btn.dataset.delEntry;
      confirmDialog('Delete this time entry? This can\'t be undone.').then(function(ok){
        if(!ok) return;
        state.store.collection(COLLECTIONS.entries).doc(id).remove().catch(function(err){ toast('Could not delete: '+err.message,'error'); });
      });
    } else if(btn.dataset.editEntry){
      openEditEntry(btn.dataset.editEntry);
    }
  });

  /* expenses */
  $('#expDate').value=todayStr();
  $('#expenseForm').addEventListener('submit', async function(e){
    e.preventDefault();
    if(!state.store) return;
    var clientId=$('#expClient').value; if(!clientId){ toast('Add a client first.','error'); return; }
    var client=state.clients.find(function(c){return c.id===clientId;});
    var amount=parseFloat($('#expAmount').value); if(!amount||amount<=0) return;
    var exp={ clientId:clientId, clientName:client?client.name:'', date:$('#expDate').value||todayStr(), title:$('#expTitle').value.trim(), amount:Math.round(amount*100)/100, invoiced:false, createdAt:new Date().toISOString() };
    var receiptFile=$('#expReceipt').files[0];
    var submitBtn=$('#expSubmitBtn');
    if(receiptFile){
      submitBtn.disabled=true; submitBtn.textContent='Attaching receipt…';
      try{
        var receipt=await fileToCompressedDataUrl(receiptFile);
        Object.assign(exp, receiptFields(receipt));
      }catch(err){ toast(err.message,'error'); submitBtn.disabled=false; submitBtn.textContent='Add Expense'; return; }
    }
    state.store.collection(COLLECTIONS.expenses).add(exp).then(function(){
      toast('Expense added.','success'); $('#expenseForm').reset(); $('#expDate').value=todayStr();
    }).catch(function(err){ toast('Could not add expense: '+err.message,'error'); }).finally(function(){
      submitBtn.disabled=false; submitBtn.textContent='Add Expense';
    });
  });
  $('#expensesBody').addEventListener('click', function(e){
    var btn=e.target.closest('button'); if(!btn) return;
    if(btn.dataset.delExp){
      var id=btn.dataset.delExp;
      confirmDialog('Delete this expense? This can\'t be undone.').then(function(ok){
        if(!ok) return;
        state.store.collection(COLLECTIONS.expenses).doc(id).remove().catch(function(err){ toast('Could not delete: '+err.message,'error'); });
      });
    } else if(btn.dataset.editExp){
      openEditExpense(btn.dataset.editExp);
    } else if(btn.dataset.viewReceipt){
      var x=state.expenses.find(function(e){return e.id===btn.dataset.viewReceipt;}); if(!x||!hasReceipt(x)) return;
      openReceiptView(x);
    }
  });
}
