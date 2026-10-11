// The page-level modals: confirm, edit time entry, view receipt, edit expense.
import { $ } from './dom.js';
import { toast } from './toast.js';
import { state } from '../state.js';
import { COLLECTIONS } from '../lib/schema.js';
import { fileToCompressedDataUrl, hasReceipt, getReceipt, receiptFields, clearedReceiptFields } from '../lib/receipts.js';
import { hoursFromSeconds } from '../domain/dates.js';

var editExpenseReceiptRemoved=false;

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
export function openEditEntry(id){
  var en=state.entries.find(function(x){return x.id===id;}); if(!en) return;
  $('#editEntryId').value=id; $('#editEntryDate').value=en.date; $('#editEntryHours').value=hoursFromSeconds(en.seconds); $('#editEntryDesc').value=en.description||'';
  $('#editEntryModal').hidden=false;
}

/* ---------------- receipt view ---------------- */
export function openReceiptView(expense){
  $('#receiptViewTitle').textContent='Receipt — '+expense.title;
  $('#receiptViewImg').src=getReceipt(expense).dataUrl;
  $('#receiptViewModal').hidden=false;
}

/* ---------------- edit expense ---------------- */
export function openEditExpense(id){
  var x=state.expenses.find(function(e){return e.id===id;}); if(!x) return;
  $('#editExpenseId').value=id; $('#editExpenseDate').value=x.date; $('#editExpenseAmount').value=x.amount; $('#editExpenseTitle').value=x.title;
  $('#editExpenseReceiptFile').value='';
  editExpenseReceiptRemoved=false;
  if(hasReceipt(x)){ $('#editExpenseReceiptThumb').src=getReceipt(x).dataUrl; $('#editExpenseReceiptCurrent').hidden=false; }
  else { $('#editExpenseReceiptCurrent').hidden=true; $('#editExpenseReceiptThumb').src=''; }
  $('#editExpenseModal').hidden=false;
}

export function bind(){
  $('#editEntryCancelBtn').addEventListener('click', function(){ $('#editEntryModal').hidden=true; });
  $('#editEntrySaveBtn').addEventListener('click', function(){
    var id=$('#editEntryId').value; var hours=parseFloat($('#editEntryHours').value);
    if(!hours||hours<=0){ toast('Enter a valid number of hours.','error'); return; }
    state.store.collection(COLLECTIONS.entries).doc(id).update({ date:$('#editEntryDate').value, seconds:Math.round(hours*3600), description:$('#editEntryDesc').value.trim() })
      .then(function(){ $('#editEntryModal').hidden=true; toast('Entry updated.','success'); })
      .catch(function(err){ toast('Could not update: '+err.message,'error'); });
  });

  $('#receiptViewCloseBtn').addEventListener('click', function(){ $('#receiptViewModal').hidden=true; $('#receiptViewImg').src=''; });

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
        Object.assign(data, receiptFields(receipt));
      }catch(err){ toast(err.message,'error'); saveBtn.disabled=false; saveBtn.textContent='Save Changes'; return; }
    } else if(editExpenseReceiptRemoved){
      Object.assign(data, clearedReceiptFields());
    }
    state.store.collection(COLLECTIONS.expenses).doc(id).update(data)
      .then(function(){ $('#editExpenseModal').hidden=true; toast('Expense updated.','success'); })
      .catch(function(err){ toast('Could not update: '+err.message,'error'); })
      .finally(function(){ saveBtn.disabled=false; saveBtn.textContent='Save Changes'; });
  });
}
