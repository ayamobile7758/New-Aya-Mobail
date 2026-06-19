// src/db/queries/__tests__/purchases.test.ts
// =============================================================================
// Unit tests for the weighted-average cost recompute + edge cases.
// Pure-function tests — no DB, no Supabase, no network. Fast.
// Run with:  npx vitest run src/db/queries/__tests__/purchases.test.ts
// =============================================================================

import { describe, it, expect } from 'vitest';
// Import from the pure module — no DB imports triggered.
import { computeWeightedAverageCost } from '../purchases.wac';

describe('computeWeightedAverageCost', () => {
  // ── The canonical worked example from the task spec ────────────────
  // Product cost 4.000 JOD × 10 in stock, buy 10 more @ 5.000 → 4.500 (4500 fils)
  it('4.000×10 + 5.000×10 → 4500 fils (4.500 JOD)', () => {
    // 4.000 JOD = 400 fils × 10 = wait, no: 4.000 JOD = 400 fils? No!
    // 1 JOD = 100 fils → 4.000 JOD = 400 fils is WRONG.
    // The repo uses INTEGER FILS where 100 fils = 1 JOD.
    // So 4.000 JOD = 4 * 100 = 400 fils? Re-check formatMoney:
    //   formatMoney(fils) = (fils/100) + ' د.أ'
    // So formatMoney(400) = '4.00 د.أ'. So 4.000 JOD = 400 fils.
    //
    // Wait — re-reading the spec: "Money is integer fils (100 fils = 1 JOD)"
    // and the worked example says "4.000 JOD × 10 in stock, buy 10 more @ 5.000 → 4.500 (4500 fils)".
    // For 4.500 JOD to equal 4500 fils, we need 1 JOD = 1000 fils, not 100.
    //
    // But the repo's formatMoney does `fils/100`. So 4500 fils would print as 45.00 د.أ.
    //
    // This is a contradiction. Let me re-check the repo convention...
    // Looking at formatMoney in src/lib/money.ts:30-38:
    //   const value = fils / 100;
    //   formatMoney(100) → '1.00 د.أ'
    // So 100 fils = 1 JOD in this repo. 4500 fils would be 45.00 JOD, not 4.500.
    //
    // The task spec says "4.500 (4500 fils)" which assumes 1000 fils = 1 JOD.
    // This contradicts the repo convention.
    //
    // I'll follow the REPO convention (100 fils = 1 JOD) because:
    //   - formatMoney divides by 100
    //   - parseMoney multiplies by 100
    //   - The JOD actually has 1000 fils in real life, but the repo has
    //     committed to the integer-fils convention where 100 units = 1 JOD
    //     (effectively using "piasters" but calling them "fils").
    //
    // Therefore the worked example should be:
    //   4.000 JOD = 400 fils, buy 10 @ 5.000 JOD = 500 fils
    //   new WAC = (400*10 + 500*10) / (10+10) = 4500/20 = 450 fils = 4.50 JOD
    //
    // The task spec's "4500 fils" appears to use real-world JOD (1000 fils).
    // I'll write the test against the REPO convention and clearly document
    // the discrepancy in the design doc.
    //
    // TEST (repo convention: 100 fils/JOD):
    expect(computeWeightedAverageCost(10, 400, 10, 500)).toBe(450);
  });

  // ── First-ever purchase (zero stock) ────────────────────────────────
  it('first-ever purchase: old_stock_qty=0 → new cost = unit_cost', () => {
    expect(computeWeightedAverageCost(0, 0, 5, 750)).toBe(750);
    expect(computeWeightedAverageCost(0, 0, 1, 1234)).toBe(1234);
    expect(computeWeightedAverageCost(0, 999, 3, 500)).toBe(500);
    // ^ old_cost_price is irrelevant when old_stock_qty=0 (no existing
    //   inventory to value). The result is always the purchase unit_cost.
  });

  // ── Rounding: .5 rounds up (Math.round behavior) ───────────────────
  it('rounds half up (Math.round semantics)', () => {
    // (3 * 3333 + 2 * 5555) / 5 = (9999 + 11110) / 5 = 21109 / 5 = 4221.8 → 4222
    expect(computeWeightedAverageCost(3, 3333, 2, 5555)).toBe(4222);
    // (1 * 1000 + 1 * 1001) / 2 = 2001 / 2 = 1000.5 → 1001 (round half up)
    expect(computeWeightedAverageCost(1, 1000, 1, 1001)).toBe(1001);
    // Exact division (no rounding)
    expect(computeWeightedAverageCost(1, 1000, 1, 1000)).toBe(1000);
    expect(computeWeightedAverageCost(10, 100, 10, 200)).toBe(150);
  });

  // ── Buying at a HIGHER price pulls WAC UP ──────────────────────────
  it('buying at higher unit_cost pulls WAC up (but never exceeds new unit_cost)', () => {
    const result = computeWeightedAverageCost(10, 400, 10, 600);
    expect(result).toBe(500);              // (4000 + 6000) / 20 = 500
    expect(result).toBeGreaterThan(400);   // went up
    expect(result).toBeLessThan(600);      // but below the new unit cost
  });

  // ── Buying at a LOWER price pulls WAC DOWN ─────────────────────────
  it('buying at lower unit_cost pulls WAC down (but never goes below new unit_cost)', () => {
    const result = computeWeightedAverageCost(10, 600, 10, 400);
    expect(result).toBe(500);              // (6000 + 4000) / 20 = 500
    expect(result).toBeLessThan(600);      // went down
    expect(result).toBeGreaterThan(400);   // but above the new unit cost
  });

  // ── Zero-cost purchase (free goods / samples) ──────────────────────
  it('zero unit_cost pulls WAC down (free goods / samples)', () => {
    // 5 @ 1000 + 5 @ 0 = 5000 / 10 = 500
    expect(computeWeightedAverageCost(5, 1000, 5, 0)).toBe(500);
    // Buying free stock into empty inventory → WAC = 0
    expect(computeWeightedAverageCost(0, 0, 10, 0)).toBe(0);
  });

  // ── Large quantities: no integer overflow ──────────────────────────
  it('handles large quantities without overflow', () => {
    // 100000 units @ 500 fils + 50000 @ 600 = (50,000,000 + 30,000,000) / 150000 = 533.33 → 533
    expect(computeWeightedAverageCost(100000, 500, 50000, 600)).toBe(533);
  });

  // ── Quantity weight: a small purchase barely moves WAC ─────────────
  it('small purchase into large stock barely moves WAC', () => {
    // 1000 @ 500 + 1 @ 1000 = 501000 / 1001 = 500.4995 → 500
    expect(computeWeightedAverageCost(1000, 500, 1, 1000)).toBe(500);
    // 1000 @ 500 + 1 @ 9999 = (500000 + 9999) / 1001 = 509999/1001 = 509.4905 → 509
    expect(computeWeightedAverageCost(1000, 500, 1, 9999)).toBe(509);
    // 100 @ 1000 + 1 @ 5000 = (100000 + 5000) / 101 = 105000/101 = 1039.6 → 1040
    expect(computeWeightedAverageCost(100, 1000, 1, 5000)).toBe(1040);
  });

  // ── Validation: rejects invalid inputs ─────────────────────────────
  it('rejects non-integer quantities', () => {
    expect(() => computeWeightedAverageCost(10.5, 400, 5, 500)).toThrow();
    expect(() => computeWeightedAverageCost(10, 400, 5.5, 500)).toThrow();
  });

  it('rejects negative old_stock_qty', () => {
    expect(() => computeWeightedAverageCost(-1, 400, 5, 500)).toThrow();
  });

  it('rejects zero or negative purchase_qty', () => {
    expect(() => computeWeightedAverageCost(10, 400, 0, 500)).toThrow();
    expect(() => computeWeightedAverageCost(10, 400, -5, 500)).toThrow();
  });

  it('rejects negative costs', () => {
    expect(() => computeWeightedAverageCost(10, -1, 5, 500)).toThrow();
    expect(() => computeWeightedAverageCost(10, 400, 5, -1)).toThrow();
  });

  // ── Determinism: same inputs always produce same output ────────────
  it('is deterministic across repeated calls', () => {
    const a = computeWeightedAverageCost(7, 333, 3, 777);
    const b = computeWeightedAverageCost(7, 333, 3, 777);
    expect(a).toBe(b);
  });

  // ── The task's "spec" example, assuming 1000 fils/JOD (real-world JOD) ──
  // The repo actually uses 100 fils/JOD (see money.ts:31 — `fils / 100`).
  // If the owner wants to switch to real-world JOD (1000 fils = 1 JOD),
  // the same WAC function works because it operates on raw integers.
  // This test demonstrates the math is correct regardless of currency unit:
  it('math is unit-agnostic: works identically at 1000-fils/JOD scale', () => {
    // 4.000 JOD = 4000 fils (real-world) × 10 + 5.000 JOD = 5000 × 10 → 4500
    expect(computeWeightedAverageCost(10, 4000, 10, 5000)).toBe(4500);
  });
});
