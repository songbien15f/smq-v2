import { describe, it, expect } from 'vitest';
import { parseDimension, formatDimension, roundUpTo50, roundDownTo50, normaliseToMm } from '../units';

describe('parseDimension', () => {
  it('passes bare numbers through as millimetres', () => {
    expect(parseDimension(12000, 'mm')).toBe(12000);
  });
  it('reads an explicit metre suffix', () => {
    expect(parseDimension('12m', 'mm')).toBe(12000);
    expect(parseDimension('4.2 m', 'mm')).toBe(4200);
    expect(parseDimension('12 metres', 'mm')).toBe(12000);
  });
  it('reads an explicit millimetre suffix', () => {
    expect(parseDimension('12000mm', 'm')).toBe(12000);
    expect(parseDimension('900 mm', 'm')).toBe(900);
    expect(parseDimension('900 millimeter', 'mm')).toBe(900);
  });
  it('applies the fallback unit to a bare number string', () => {
    expect(parseDimension('12', 'm')).toBe(12000);
    expect(parseDimension('12', 'mm')).toBe(12);
  });
  it('returns integers', () => {
    expect(Number.isInteger(parseDimension('12.345m', 'mm'))).toBe(true);
  });
});

describe('roundUpTo50 / roundDownTo50', () => {
  it('rounds to the nearest 50 mm boundary', () => {
    expect(roundUpTo50(12001)).toBe(12050);
    expect(roundDownTo50(12099)).toBe(12050);
    expect(roundUpTo50(12050)).toBe(12050);
  });
});

describe('normaliseToMm', () => {
  it('multiplies metres by 1000', () => {
    expect(normaliseToMm(12, 'm')).toBe(12000);
  });
});

describe('formatDimension', () => {
  it('formats for display without changing stored value', () => {
    expect(formatDimension(12000, 'mm')).toBe('12000');
    expect(formatDimension(12000, 'm')).toBe('12.00');
  });
});
