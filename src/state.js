// Shared mutable app state: one object, mutated by property assignment.
// Always read state.x at use time; never destructure or cache it.
import { defaultSettings } from './lib/schema.js';
import { IDLE_TIMER } from './domain/timer.js';

export const state = {
  store: null, downloads: null, receipts: null,
  clients: [], entries: [], expenses: [], invoices: [],
  settings: defaultSettings(),
  timer: { ...IDLE_TIMER },
  invPreviewRows: null, invPreviewMeta: null
};
