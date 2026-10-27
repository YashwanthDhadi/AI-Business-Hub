import type { PaymentMethod } from "@/types";

export type { PaymentMethod };

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  upi: "UPI",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank Transfer",
};
