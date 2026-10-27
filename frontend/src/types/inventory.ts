export type StockStatus = "in_stock" | "low_stock" | "out_of_stock";

/** Why stock moved. The ledger records one of these for every change. */
export type StockReason = "sale" | "restock" | "adjustment" | "damage" | "return" | "stocktake";

export interface InventoryItem {
  id: string;
  businessId: string;
  sku: string;
  name: string;
  category: string;
  quantity: number;
  lowStockThreshold: number;
  unitPrice: number;
  costPrice: number;
  supplier?: string;
  /** Calculated by the database from quantity and the reorder level - never stored. */
  status: StockStatus;
  lastRestocked?: string | null;

  // ---- live data only (the mock items leave these out) ----
  description?: string;
  /** "piece", "kg", "box". Display only. */
  unit?: string;
  /** quantity x costPrice, worked out by the database. */
  stockValue?: number;
  isActive?: boolean;
  createdAt?: string;
}

/** One row of the append-only stock ledger. Nothing ever edits these. */
export interface StockMovement {
  id: string;
  itemId: string;
  itemName: string;
  /** Negative removed stock, positive added it. Never zero. */
  delta: number;
  /** What the quantity became, so the ledger reads on its own. */
  balance: number;
  reason: StockReason;
  note: string;
  actor: "owner" | "agent" | "system";
  createdAt: string;
}
