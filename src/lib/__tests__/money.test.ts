import { describe, it, expect } from 'vitest';
import { addMoney, subMoney, mulMoney, applyPercent, formatMoney, parseMoney } from '../money';

describe('addMoney', () => {
  it('adds two amounts', () => {
    expect(addMoney(100, 200)).toBe(300);
  });
  it('rounds inputs before adding', () => {
    expect(addMoney(100.9, 200.1)).toBe(301);
  });
  it('handles zero', () => {
    expect(addMoney(0, 500)).toBe(500);
  });
});

describe('subMoney', () => {
  it('subtracts two amounts', () => {
    expect(subMoney(500, 200)).toBe(300);
  });
  it('can return negative', () => {
    expect(subMoney(100, 200)).toBe(-100);
  });
});

describe('mulMoney', () => {
  it('multiplies amount by quantity', () => {
    expect(mulMoney(1000, 3)).toBe(3000);
  });
  it('handles quantity of 1', () => {
    expect(mulMoney(750, 1)).toBe(750);
  });
  it('handles zero quantity', () => {
    expect(mulMoney(1000, 0)).toBe(0);
  });
});

describe('applyPercent', () => {
  it('applies 10% to 1000 fils', () => {
    expect(applyPercent(1000, 10)).toBe(100);
  });
  it('applies 15% to 2000 fils', () => {
    expect(applyPercent(2000, 15)).toBe(300);
  });
  it('rounds to nearest integer', () => {
    expect(applyPercent(333, 33)).toBe(110);
  });
  it('returns 0 for 0%', () => {
    expect(applyPercent(1000, 0)).toBe(0);
  });
  it('returns full amount for 100%', () => {
    expect(applyPercent(1000, 100)).toBe(1000);
  });
});

describe('formatMoney', () => {
  it('formats 100 fils as 1.00 د.أ', () => {
    expect(formatMoney(100)).toBe('1.00 د.أ');
  });
  it('formats 0 fils', () => {
    expect(formatMoney(0)).toBe('0.00 د.أ');
  });
  it('formats 150000 fils (1500.00 JD)', () => {
    expect(formatMoney(150000)).toBe('1,500.00 د.أ');
  });
  it('omits currency symbol when empty string passed', () => {
    expect(formatMoney(500, '')).toBe('5.00');
  });
  it('supports custom currency symbol', () => {
    expect(formatMoney(100, 'USD')).toBe('1.00 USD');
  });
});

describe('parseMoney', () => {
  it('parses decimal string to fils', () => {
    expect(parseMoney('1.00')).toBe(100);
  });
  it('parses integer string', () => {
    expect(parseMoney('5')).toBe(500);
  });
  it('returns 0 for empty string', () => {
    expect(parseMoney('')).toBe(0);
  });
  it('strips Arabic currency characters', () => {
    expect(parseMoney('10.50 د.أ')).toBe(1050);
  });
  it('handles non-numeric input gracefully', () => {
    expect(parseMoney('abc')).toBe(0);
  });
  it('truncates sub-fils instead of rounding', () => {
    expect(parseMoney('1.999')).toBe(199);
  });
  it('handles Arabic decimal separator', () => {
    expect(parseMoney('5٫50')).toBe(550);
  });
  it('handles Arabic-Indic digits with Arabic decimal separator', () => {
    expect(parseMoney('٥٫٥٠')).toBe(550);
  });
  it('handles multi-dot inputs by taking the first valid number', () => {
    expect(parseMoney('1.500.50')).toBe(150);
  });
});
