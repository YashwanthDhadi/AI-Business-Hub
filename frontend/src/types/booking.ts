export type BookingStatus = "confirmed" | "pending" | "cancelled" | "completed";

export type BookingPaymentStatus = "paid" | "unpaid" | "refunded";

export interface Booking {
  id: string;
  businessId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  date: string;       // YYYY-MM-DD
  time: string;       // HH:MM (e.g. "10:00 AM")
  durationMinutes: number;
  price: number;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  staffAssigned?: string;
  notes?: string;
  bookedVia: "customer_chat" | "dashboard" | "manual";
  createdAt: string;
  /**
   * Short code the customer is given in chat ("7F3A9C2E"). Only live bookings
   * from the API carry one, so it stays optional — the mock screens do not.
   */
  reference?: string;
}
