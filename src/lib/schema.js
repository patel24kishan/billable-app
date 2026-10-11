// Record shapes shared by the store and the screens: collection names, doc
// paths, default settings, and the createdAt/updatedAt stamping rules.

/** Exported for the later versioned export/import; not stamped on records yet. */
export const SCHEMA_VERSION = 1;

export const COLLECTIONS = { clients: 'clients', entries: 'entries', expenses: 'expenses', invoices: 'invoices' };

export const DOCS = { settings: 'settings/main', timer: 'state/timer' };

/** A fresh default settings object (never shared, safe to mutate). */
export function defaultSettings() {
  return { rate:0, currency:'$', businessName:'', businessEmail:'', businessAddress:'', notes:'', nextInvoiceNumber:1,
    taxCountry:'', taxRegion:'', taxCustomLabel1:'', taxCustomRate1:0, taxCustomLabel2:'', taxCustomRate2:0 };
}

/** Copy for a new record: keeps a caller-supplied createdAt, always sets updatedAt. Never mutates `data`. */
export function stampAdd(data, nowIso) {
  const rec = Object.assign({}, data);
  if (rec.createdAt == null) rec.createdAt = nowIso;
  rec.updatedAt = nowIso;
  return rec;
}

/** Copy for a full replace (set): always sets updatedAt, adds no createdAt. Never mutates `data`. */
export function stampWrite(data, nowIso) {
  return Object.assign({}, data, { updatedAt: nowIso });
}
