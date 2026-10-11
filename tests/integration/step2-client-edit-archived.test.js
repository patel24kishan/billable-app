// Step 2 (A1): editing a client must not touch its archived flag; only ADD
// sets archived:false. Driven through the real app (index.html + src/main.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../index.html'), 'utf8');
const $ = (s) => document.querySelector(s);
const submit = (form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const WAIT = { timeout: 4000, interval: 10 };

async function storedClients() {
  const { state } = await import('../../src/state.js');
  const snap = await state.store.collection('clients').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
const rowFor = (name) => Array.from(document.querySelectorAll('#clientList .client-row')).find((r) => r.querySelector('.client-name').textContent.includes(name));

describe('step 2: editing a client keeps its archived flag', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    document.documentElement.innerHTML = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  });

  it('archived stays archived, active stays active, new client has archived:false', async () => {
    await import('../../src/main.js');
    await vi_waitFor(() => expect($('#taxProvince').options.length).toBe(13));

    // Add two clients.
    for (const name of ['Archie', 'Activa']) {
      $('#clientName').value = name;
      submit($('#clientForm'));
      await vi_waitFor(() => expect(rowFor(name)).toBeTruthy());
    }
    let stored = await storedClients();
    const archie0 = stored.find((c) => c.name === 'Archie');
    expect(archie0.archived).toBe(false);
    expect(stored.find((c) => c.name === 'Activa').archived).toBe(false);

    // Archive Archie via the button.
    rowFor('Archie').querySelector('[data-archive]').click();
    await vi_waitFor(() => expect(rowFor('Archie').querySelector('.pill').textContent).toBe('Archived'));
    expect(rowFor('Archie').querySelector('[data-archive]').textContent).toBe('Unarchive');

    // Edit both: change the name and submit.
    rowFor('Archie').querySelector('[data-edit]').click();
    $('#clientName').value = 'Archie Renamed';
    submit($('#clientForm'));
    await vi_waitFor(() => expect(rowFor('Archie Renamed')).toBeTruthy());

    rowFor('Activa').querySelector('[data-edit]').click();
    $('#clientName').value = 'Activa Renamed';
    submit($('#clientForm'));
    await vi_waitFor(() => expect(rowFor('Activa Renamed')).toBeTruthy());

    // Store records.
    stored = await storedClients();
    const archie = stored.find((c) => c.id === archie0.id);
    expect(archie.name).toBe('Archie Renamed');
    expect(archie.archived).toBe(true);
    expect(archie.createdAt).toBe(archie0.createdAt);
    const activa = stored.find((c) => c.name === 'Activa Renamed');
    expect(activa.archived).toBe(false);

    // DOM.
    const aRow = rowFor('Archie Renamed');
    expect(aRow.querySelector('.pill').textContent).toBe('Archived');
    expect(aRow.querySelector('[data-archive]').textContent).toBe('Unarchive');
    const bRow = rowFor('Activa Renamed');
    expect(bRow.querySelector('.pill')).toBeNull();
    expect(bRow.querySelector('[data-archive]').textContent).toBe('Archive');
  });
});

import { vi } from 'vitest';
function vi_waitFor(fn) { return vi.waitFor(fn, WAIT); }
