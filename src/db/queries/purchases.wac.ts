// src/db/queries/purchases.wac.ts
// =============================================================================
// AYA POS — Pure weighted-average-cost recompute function.
// Extracted into its own module so unit tests can import it WITHOUT
// triggering the Supabase client init chain (which would require env vars).
// =============================================================================

/**
 * Compute the new weighted-average cost (integer fils) after a purchase.
 *
 * Formula:
 *   new_cost_price = round(
 *     (old_stock_qty * old_cost_price + purchase_qty * purchase_unit_cost)
 *     /
 *     (old_stock_qty + purchase_qty)
 *   )
 *
 * Rounding: Math.round() in JS uses "round half toward +Infinity".
 * For non-negative numerators this matches PostgreSQL ROUND() on numeric.
 *
 * Edge cases:
 *   - First-ever purchase (old_stock_qty = 0): returns purchase_unit_cost.
 *   - Zero-cost purchase (free goods): pulls WAC down.
 *   - Buying at lower cost: pulls WAC down.
 *
 * All inputs MUST be non-negative integers. purchaseQty MUST be > 0.
 */
export function computeWeightedAverageCost(
  oldStockQty: number,
  oldCostPrice: number,   // fils
  purchaseQty: number,
  purchaseUnitCost: number // fils
): number {
  if (!Number.isInteger(oldStockQty) || !Number.isInteger(purchaseQty)) {
    throw new Error('computeWeightedAverageCost: quantities must be integers');
  }
  if (oldStockQty < 0 || purchaseQty <= 0) {
    throw new Error('computeWeightedAverageCost: invalid quantities');
  }
  if (oldCostPrice < 0 || purchaseUnitCost < 0) {
    throw new Error('computeWeightedAverageCost: costs must be non-negative');
  }
  const totalQty = oldStockQty + purchaseQty;
  if (totalQty === 0) {
    // Cannot happen because purchaseQty > 0, but guard for type-safety.
    return 0;
  }
  const totalValue = oldStockQty * oldCostPrice + purchaseQty * purchaseUnitCost;
  // Math.round on non-negative numbers matches PostgreSQL ROUND() on numeric.
  return Math.round(totalValue / totalQty);
}
