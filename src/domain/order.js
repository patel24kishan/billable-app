// Deterministic value ordering shared by the store's orderBy and the invoice
// line comparator. Pure; no DOM, no store.

/**
 * Total order on field values: a missing value (undefined/null) sorts as the
 * empty string, i.e. before any other string; values of different types are
 * grouped by type name, so the comparison is never inconsistent.
 * Returns -1, 0 or 1.
 */
export function compareValues(av, bv) {
  if (av === undefined || av === null) av = '';
  if (bv === undefined || bv === null) bv = '';
  const at = typeof av, bt = typeof bv;
  if (at !== bt) return at < bt ? -1 : 1;
  return av < bv ? -1 : av > bv ? 1 : 0;
}
