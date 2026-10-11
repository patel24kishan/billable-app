import { describe, it, expect } from 'vitest';
import { TAX_TABLES, CANADA_PROVINCES, formatRatePct, getEffectiveTaxLines, taxJurisdictionLabel, isCustomTaxCountry } from '../../src/domain/tax.js';
import { defaultSettings } from '../../src/lib/schema.js';

const s = (patch) => Object.assign(defaultSettings(), patch);

const EXPECTED = {
  'Alberta': [{ label: 'GST', rate: 0.05 }],
  'British Columbia': [{ label: 'GST', rate: 0.05 }, { label: 'PST', rate: 0.07 }],
  'Manitoba': [{ label: 'GST', rate: 0.05 }, { label: 'RST', rate: 0.07 }],
  'New Brunswick': [{ label: 'HST', rate: 0.15 }],
  'Newfoundland and Labrador': [{ label: 'HST', rate: 0.15 }],
  'Nova Scotia': [{ label: 'HST', rate: 0.14 }],
  'Northwest Territories': [{ label: 'GST', rate: 0.05 }],
  'Nunavut': [{ label: 'GST', rate: 0.05 }],
  'Ontario': [{ label: 'HST', rate: 0.13 }],
  'Prince Edward Island': [{ label: 'HST', rate: 0.15 }],
  'Quebec': [{ label: 'GST', rate: 0.05 }, { label: 'QST', rate: 0.09975 }],
  'Saskatchewan': [{ label: 'GST', rate: 0.05 }, { label: 'PST', rate: 0.06 }],
  'Yukon': [{ label: 'GST', rate: 0.05 }]
};

describe('Canadian tables', () => {
  it('has the 13 provinces and territories in table order', () => {
    expect(CANADA_PROVINCES).toEqual(Object.keys(EXPECTED));
    expect(CANADA_PROVINCES.length).toBe(13);
  });
  for (const [prov, lines] of Object.entries(EXPECTED)) {
    it(`${prov} returns exactly its table lines`, () => {
      const got = getEffectiveTaxLines(s({ taxCountry: 'Canada', taxRegion: prov }));
      expect(got).toEqual(lines);
      expect(got).toBe(TAX_TABLES[prov]); // returned by reference, as before
    });
  }
});

describe('getEffectiveTaxLines', () => {
  it('returns [] for Canada with no or an unknown region, and for no country', () => {
    expect(getEffectiveTaxLines(s({ taxCountry: 'Canada', taxRegion: '' }))).toEqual([]);
    expect(getEffectiveTaxLines(s({ taxCountry: 'Canada', taxRegion: 'Atlantis' }))).toEqual([]);
    expect(getEffectiveTaxLines(s({ taxCountry: '' }))).toEqual([]);
  });

  for (const country of ['United States', 'Other / custom']) {
    it(`${country}: custom line 1 only, both lines, and skipped lines`, () => {
      expect(getEffectiveTaxLines(s({ taxCountry: country, taxCustomLabel1: 'Sales Tax', taxCustomRate1: 0.0725 })))
        .toEqual([{ label: 'Sales Tax', rate: 0.0725 }]);
      expect(getEffectiveTaxLines(s({ taxCountry: country, taxCustomLabel1: 'State', taxCustomRate1: 0.06, taxCustomLabel2: 'City', taxCustomRate2: 0.02 })))
        .toEqual([{ label: 'State', rate: 0.06 }, { label: 'City', rate: 0.02 }]);
      // label with no rate, rate with no label, rate of 0
      expect(getEffectiveTaxLines(s({ taxCountry: country, taxCustomLabel1: 'State', taxCustomRate1: 0, taxCustomLabel2: '', taxCustomRate2: 0.02 }))).toEqual([]);
      expect(getEffectiveTaxLines(s({ taxCountry: country, taxCustomLabel1: 'A', taxCustomRate1: undefined }))).toEqual([]);
      expect(getEffectiveTaxLines(s({ taxCountry: country, taxCustomLabel1: '', taxCustomRate1: 0.05, taxCustomLabel2: 'B', taxCustomRate2: 0.03 })))
        .toEqual([{ label: 'B', rate: 0.03 }]);
    });
  }

  it('Canada ignores the custom fields', () => {
    expect(getEffectiveTaxLines(s({ taxCountry: 'Canada', taxRegion: 'Ontario', taxCustomLabel1: 'X', taxCustomRate1: 0.5 })))
      .toEqual([{ label: 'HST', rate: 0.13 }]);
    expect(getEffectiveTaxLines(s({ taxCountry: 'Canada', taxRegion: '', taxCustomLabel1: 'X', taxCustomRate1: 0.5 }))).toEqual([]);
  });
});

describe('formatRatePct', () => {
  it('formats fractions as trimmed percentages (max 3 decimals)', () => {
    expect(formatRatePct(0.09975)).toBe('9.975');
    expect(formatRatePct(0.13)).toBe('13');
    expect(formatRatePct(0.05)).toBe('5');
    expect(formatRatePct(0.0725)).toBe('7.25');
    expect(formatRatePct(0.123456)).toBe('12.346');
  });
});

describe('taxJurisdictionLabel', () => {
  it('joins region and country', () => {
    expect(taxJurisdictionLabel(s({ taxCountry: 'Canada', taxRegion: 'Ontario' }))).toBe('Ontario, Canada');
    expect(taxJurisdictionLabel(s({ taxCountry: 'United States', taxRegion: '' }))).toBe('United States');
    expect(taxJurisdictionLabel(s({ taxCountry: '' }))).toBe('');
  });
});

describe('isCustomTaxCountry', () => {
  it('is true only for the custom-line countries', () => {
    expect(isCustomTaxCountry('United States')).toBe(true);
    expect(isCustomTaxCountry('Other / custom')).toBe(true);
    expect(isCustomTaxCountry('Canada')).toBe(false);
    expect(isCustomTaxCountry('')).toBe(false);
  });
});
