// The page-level modals: confirm, edit time entry, view receipt, edit expense.
import { $ } from './dom.js';
import { toast } from './toast.js';
import { state } from '../state.js';
import { COLLECTIONS } from '../lib/schema.js';
import { fileToCompressedDataUrl, hasReceipt, getReceipt, receiptFields, clearedReceiptFields } from '../lib/receipts.js';
import { hoursFromSeconds } from '../domain/dates.js';

var editExpenseReceiptRemoved=false;
var editExpenseHadReceipt=false;

export function confirmDialog(text){
  return new Promise(function(resolve){
    var m=$('#confirmModal'); $('#confirmText').textContent=text; m.hidden=false;
    function cleanup(v){ m.hidden=true; ok.removeEventListener('click',onOk); cancel.removeEventListener('click',onCancel); resolve(v); }
    var ok=$('#confirmOkBtn'), cancel=$('#confirmCancelBtn');
    function onOk(){ cleanup(true); } function onCancel(){ cleanup(false); }
    ok.addEventListener('click',onOk); cancel.addEventListener('click',onCancel);
  });
}

/* ---------------- edit time entry ---------------- */
/**
 * Opens the edit-entry modal. Uses the Track list's copy when loaded; an entry
 * outside that list's window (filtered month, beyond the newest 200, or opened
 * from the invoice preview) is read from the store, and the returned promise
 * settles once it is open.
 */
export function openEditEntry(id){
  var en=state.entries.find(function(x){return x.id===id;});
  if(en){ fillEditEntry(id, en); return Promise.resolve(); }
  if(!state.store) return Promise.resolve();
  return state.store.collection(COLLECTIONS.entries).doc(id).get().then(function(snap){
    if(snap.exists) fillEditEntry(id, snap.data());
  }).catch(function(err){ toast('Could not open entry: '+err.message,'error'); });
}
function fillEditEntry(id, en){
  $('#editEntryId').value=id; $('#editEntryDate').value=en.date; $('#editEntryHours').value=hoursFromSeconds(en.seconds); $('#editEntryDesc').value=en.description||'';
  $('#editEntryModal').hidden=false;
}

// 13b-1: listeners run after a successful edit-entry save, with the entry id
// (same pattern as onExpenseSaved; ui/invoices.js registers here).
var entrySavedListeners=[];
export function onEntrySaved(cb){
  entrySavedListeners.push(cb);
  return function(){ entrySavedListeners=entrySavedListeners.filter(function(f){ return f!==cb; }); };
}

/* ---------------- receipt view ---------------- */
export function openReceiptView(expense){
  $('#receiptViewTitle').textContent='Receipt — '+expense.title;
  $('#receiptViewImg').src=getReceipt(expense).dataUrl;
  $('#receiptViewModal').hidden=false;
}

/* ---------------- edit expense ---------------- */
/**
 * Opens the edit-expense modal. Uses the Track list's copy when loaded; an
 * expense outside that list's window (e.g. opened from the invoice preview)
 * is read from the store, and the returned promise settles once it is open.
 */
export function openEditExpense(id){
  var x=state.expenses.find(function(e){return e.id===id;});
  if(x){ fillEditExpense(id, x); return Promise.resolve(); }
  if(!state.store) return Promise.resolve();
  return state.store.collection(COLLECTIONS.expenses).doc(id).get().then(function(snap){
    if(snap.exists) fillEditExpense(id, Object.assign({id:id}, snap.data()));
  }).catch(function(err){ toast('Could not open expense: '+err.message,'error'); });
}

// D2: listeners run after a successful edit-expense save, with the expense id.
// (Callers such as ui/invoices.js register here, so this module imports no screen.)
var expenseSavedListeners=[];
export function onExpenseSaved(cb){
  expenseSavedListeners.push(cb);
  return function(){ expenseSavedListeners=expenseSavedListeners.filter(function(f){ return f!==cb; }); };
}

function fillEditExpense(id, x){
  $('#editExpenseId').value=id; $('#editExpenseDate').value=x.date; $('#editExpenseAmount').value=x.amount; $('#editExpenseTitle').value=x.title;
  $('#editExpenseReceiptFile').value='';
  editExpenseReceiptRemoved=false;
  editExpenseHadReceipt=hasReceipt(x);
  $('#editExpenseReceiptThumb').hidden=false; $('#editExpenseReceiptRemoveBtn').textContent='Remove receipt';
  if(editExpenseHadReceipt){ $('#editExpenseReceiptThumb').src=getReceipt(x).dataUrl; $('#editExpenseReceiptCurrent').hidden=false; }
  else { $('#editExpenseReceiptCurrent').hidden=true; $('#editExpenseReceiptThumb').src=''; }
  $('#editExpenseModal').hidden=false;
}

export function bind(){
  $('#editEntryCancelBtn').addEventListener('click', function(){ $('#editEntryModal').hidden=true; });
  $('#editEntrySaveBtn').addEventListener('click', function(){
    var id=$('#editEntryId').value; var hours=parseFloat($('#editEntryHours').value);
    if(!hours||hours<=0){ toast('Enter a valid number of hours.','error'); return; }
    if(!$('#editEntryDate').value){ toast('Enter a valid date.','error'); return; }
    state.store.collection(COLLECTIONS.entries).doc(id).update({ date:$('#editEntryDate').value, seconds:Math.round(hours*3600), description:$('#editEntryDesc').value.trim() })
      .then(function(){
        $('#editEntryModal').hidden=true; toast('Entry updated.','success');
        entrySavedListeners.forEach(function(cb){ cb(id); });
      })
      .catch(function(err){ toast('Could not update: '+err.message,'error'); });
  });

  $('#receiptViewCloseBtn').addEventListener('click', function(){ $('#receiptViewModal').hidden=true; $('#receiptViewImg').src=''; });

  $('#editExpenseCancelBtn').addEventListener('click', function(){ $('#editExpenseModal').hidden=true; });
  // With no stored receipt the Remove control is hidden; picking a file reveals it as
  // "Clear selected file" (thumb hidden) so the pick can be undone.
  $('#editExpenseReceiptFile').addEventListener('change', function(){
    if(editExpenseHadReceipt) return;
    var picked=!!$('#editExpenseReceiptFile').files[0];
    $('#editExpenseReceiptCurrent').hidden=!picked;
    $('#editExpenseReceiptThumb').hidden=true;
    $('#editExpenseReceiptRemoveBtn').textContent='Clear selected file';
  });
  $('#editExpenseReceiptRemoveBtn').addEventListener('click', function(){
    $('#editExpenseReceiptFile').value=''; // discard any newly picked file
    if(editExpenseHadReceipt) editExpenseReceiptRemoved=true;
    $('#editExpenseReceiptCurrent').hidden=true; $('#editExpenseReceiptThumb').src='';
  });
  $('#editExpenseSaveBtn').addEventListener('click', async function(){
    var id=$('#editExpenseId').value; var amount=parseFloat($('#editExpenseAmount').value);
    var title=$('#editExpenseTitle').value.trim();
    if(!amount||amount<=0||!title){ toast('Enter a title and a valid amount.','error'); return; }
    if(!$('#editExpenseDate').value){ toast('Enter a valid date.','error'); return; }
    var data={ date:$('#editExpenseDate').value, amount:Math.round(amount*100)/100, title:title };
    var newFile=$('#editExpenseReceiptFile').files[0];
    var saveBtn=$('#editExpenseSaveBtn');
    if(newFile){
      saveBtn.disabled=true; saveBtn.textContent='Attaching…';
      try{
        var receipt=await fileToCompressedDataUrl(newFile);
        Object.assign(data, receiptFields(receipt));
      }catch(err){ toast(err.message,'error'); saveBtn.disabled=false; saveBtn.textContent='Save Changes'; return; }
    } else if(editExpenseReceiptRemoved){
      Object.assign(data, clearedReceiptFields());
    }
    state.store.collection(COLLECTIONS.expenses).doc(id).update(data)
      .then(function(){
        $('#editExpenseModal').hidden=true; toast('Expense updated.','success');
        expenseSavedListeners.forEach(function(cb){ cb(id); });
      })
      .catch(function(err){ toast('Could not update: '+err.message,'error'); })
      .finally(function(){ saveBtn.disabled=false; saveBtn.textContent='Save Changes'; });
  });
}
