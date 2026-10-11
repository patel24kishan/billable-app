// The app's single data seam. Screens get the store from here (via state.store)
// and never import a concrete adapter. Today it is always the local IndexedDB store.
import { createLocalStore } from './localStore.js';

export async function createStore(options = {}) {
  return createLocalStore(options);
}
