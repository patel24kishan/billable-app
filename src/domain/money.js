// Money helpers. Pure: no DOM, no store.

/** Rounds to cents: Math.round(n*100)/100 (same as every inline use in the app). */
export function round2(n) { return Math.round(n*100)/100; }

/** Formats an amount with the given currency symbol ('$' when empty or missing). */
export function money(n, currency) { var c=(currency||'$'); return c+round2(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
