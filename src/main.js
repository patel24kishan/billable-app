// Boot only: bind every screen synchronously, then open the store and subscribe.
import './style.css';
import { createStore } from './lib/store/index.js';
import { createDownloads } from './lib/downloads.js';
import { createReceipts } from './lib/receipts.js';
import { state } from './state.js';
import { toast } from './ui/toast.js';
import { bindNav } from './ui/nav.js';
import * as clientsUi from './ui/clients.js';
import * as dialogs from './ui/dialogs.js';
import * as trackUi from './ui/track.js';
import * as invoicesUi from './ui/invoices.js';
import * as settingsUi from './ui/settings.js';

// Listeners and initial field values are attached before the store opens, even if it fails to open.
bindNav();
clientsUi.bind();
dialogs.bind();
trackUi.bind();
invoicesUi.bind();
settingsUi.bind();

async function boot(){
  try{
    state.store = await createStore();
  }catch(err){
    toast('This page can\'t reach its local data store right now — reload to try again.','error');
    return;
  }
  state.downloads = createDownloads();
  state.receipts = createReceipts(state.store);
  // Fixed order: each onSnapshot fires synchronously on subscribe.
  settingsUi.subscribe(function(){ if(state.invPreviewRows) invoicesUi.renderInvoicePreview(); });
  clientsUi.subscribe();
  trackUi.subscribeEntries();
  trackUi.subscribeExpenses();
  invoicesUi.subscribe();
  trackUi.subscribeTimer();
}

export const appReady = boot();
