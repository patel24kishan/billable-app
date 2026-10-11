// Clients screen, plus the client dropdowns used on the other screens.
import { $, esc } from './dom.js';
import { toast } from './toast.js';
import { confirmDialog } from './dialogs.js';
import { state } from '../state.js';
import { COLLECTIONS } from '../lib/schema.js';

var editingClientId=null;

function activeClients(){ return state.clients.filter(function(c){ return !c.archived; }); }
function fillClientSelect(sel, includeArchived){
  var prev=sel.value;
  var list = includeArchived ? state.clients : activeClients();
  sel.innerHTML = list.length ? list.map(function(c){ return '<option value="'+esc(c.id)+'">'+esc(c.name)+(c.archived?' (archived)':'')+'</option>'; }).join('') : '<option value="">No clients yet</option>';
  if(list.some(function(c){return c.id===prev;})) sel.value=prev;
}
export function renderClientDropdowns(){
  fillClientSelect($('#timerClient'));
  fillClientSelect($('#manClient'));
  fillClientSelect($('#expClient'));
  fillClientSelect($('#invClient'), true);
}
export function renderClients(){
  var list=$('#clientList');
  if(!state.clients.length){ list.innerHTML=''; $('#clientsEmpty').hidden=false; return; }
  $('#clientsEmpty').hidden=true;
  list.innerHTML = state.clients.map(function(c){
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
function startEditClient(id){
  var c=state.clients.find(function(x){return x.id===id;}); if(!c) return;
  editingClientId=id;
  $('#clientId').value=id; $('#clientName').value=c.name; $('#clientEmail').value=c.email||''; $('#clientAddress').value=c.address||'';
  $('#clientFormTitle').textContent='Edit client';
  $('#clientSaveBtn').textContent='Save Changes';
  $('#clientCancelBtn').hidden=false;
  window.scrollTo({top:0,behavior:'smooth'});
}
function resetClientForm(){
  editingClientId=null; $('#clientForm').reset(); $('#clientId').value='';
  $('#clientFormTitle').textContent='Add a client'; $('#clientSaveBtn').textContent='Add Client'; $('#clientCancelBtn').hidden=true;
}
function toggleArchive(id){
  var c=state.clients.find(function(x){return x.id===id;}); if(!c) return;
  state.store.collection(COLLECTIONS.clients).doc(id).update({archived:!c.archived}).catch(function(err){ toast('Could not update client: '+err.message,'error'); });
}
function deleteClient(id){
  confirmDialog('Delete this client permanently? Past time entries and invoices will keep their record, but you won\'t be able to log new time for them.').then(function(ok){
    if(!ok) return;
    state.store.collection(COLLECTIONS.clients).doc(id).remove().then(function(){ toast('Client deleted.'); }).catch(function(err){ toast('Could not delete: '+err.message,'error'); });
  });
}

export function bind(){
  $('#clientList').addEventListener('click',function(e){
    var t=e.target;
    if(t.dataset.edit){ startEditClient(t.dataset.edit); }
    else if(t.dataset.archive){ toggleArchive(t.dataset.archive); }
    else if(t.dataset.delete){ deleteClient(t.dataset.delete); }
  });
  $('#clientCancelBtn').addEventListener('click',resetClientForm);
  $('#clientForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!state.store){ toast('Not connected — try reloading the page.','error'); return; }
    var data={ name:$('#clientName').value.trim(), email:$('#clientEmail').value.trim(), address:$('#clientAddress').value.trim(), archived:false };
    if(!data.name) return;
    var p = editingClientId ? state.store.collection(COLLECTIONS.clients).doc(editingClientId).update(data) : state.store.collection(COLLECTIONS.clients).add(Object.assign(data,{createdAt:new Date().toISOString()}));
    p.then(function(){ toast(editingClientId?'Client updated.':'Client added.','success'); resetClientForm(); })
     .catch(function(err){ toast('Could not save client: '+err.message,'error'); });
  });
}

export function subscribe(){
  state.store.collection(COLLECTIONS.clients).orderBy('name').onSnapshot(function(snap){
    state.clients = snap.docs.map(function(d){ return Object.assign({id:d.id}, d.data()); });
    renderClients(); renderClientDropdowns();
  }, function(err){ toast('Clients error: '+err.message,'error'); });
}
