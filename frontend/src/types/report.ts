/** One day of the live report. Every number comes from SQL, not from a model. */
export interface ReportDay {
  /** The BUSINESS's local date (IST), not UTC. */
  day: string;
  conversations: number;
  bookings: number;
  completedBookings: number;
  cancelledBookings: number;
  invoicesIssued: number;
  /** Money marked paid on this day. */
  collected: number;
  newCustomers: number;
}

export interface ReportSummary {
  days: number;
  conversations: number;
  bookings: number;
  completedBookings: number;
  cancelledBookings: number;
  invoicesIssued: number;
  collected: number;
  /** Owed right now, whenever it was invoiced - not windowed. */
  outstanding: number;
  newCustomers: number;
  activeCustomers: number;
  lowStockItems: number;
}

export interface TopService {
  serviceName: string;
  bookings: number;
  /** Uses the price stored ON each booking, so old bookings keep old prices. */
  revenue: number;
}

export interface BusinessReport {
  summary: ReportSummary;
  daily: ReportDay[];
  topServices: TopService[];
  business: { name: string };
}

export interface DailyMetric {
  date: string;
  revenue: number;
  bookingsCount: number;
  newCustomersCount: number;
  aiConversationsCount: number;
}

export interface BusinessSummaryReport {
  period: "day" | "week" | "month" | "year";
  totalRevenue: number;
  revenueGrowthPercent: number;
  totalBookings: number;
  bookingsGrowthPercent: number;
  activeCustomers: number;
  unpaidAmount: number;
  lowStockItemsCount: number;
  aiQueriesAnswered: number;
  aiBookingConversionRate: number; // percentage e.g. 64%
  dailyMetrics: DailyMetric[];
  aiExecutiveSummary: string;
}

export interface MonthlyMetric {
  month: string;
  revenue: number;
  bookings: number;
  newCustomers: number;
  totalCustomers: number;
}

export interface RevenueSource {
  source: string;
  revenue: number;
  bookings?: number;
}
