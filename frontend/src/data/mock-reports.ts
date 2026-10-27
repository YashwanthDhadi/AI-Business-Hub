import { BusinessSummaryReport, DailyMetric, MonthlyMetric, RevenueSource } from "@/types";

export const mockReport: BusinessSummaryReport = {
  period: "month",
  totalRevenue: 14820,
  revenueGrowthPercent: 18.4,
  totalBookings: 184,
  bookingsGrowthPercent: 12.1,
  activeCustomers: 142,
  unpaidAmount: 205,
  lowStockItemsCount: 2,
  aiQueriesAnswered: 412,
  aiBookingConversionRate: 68.5,
  aiExecutiveSummary: "FitZone is pacing 18.4% ahead of last month's revenue, driven by a surge in 1-on-1 personal training packages. The public AI customer chat has successfully captured 68.5% of website visitors asking about trials directly into confirmed bookings. Immediate action recommended: restock Chocolate Whey Isolate and follow up on 2 pending invoices totalling ₹205.",
  dailyMetrics: [
    { date: "Sep 17", revenue: 520, bookingsCount: 6, newCustomersCount: 3, aiConversationsCount: 14 },
    { date: "Sep 18", revenue: 780, bookingsCount: 9, newCustomersCount: 4, aiConversationsCount: 18 },
    { date: "Sep 19", revenue: 640, bookingsCount: 7, newCustomersCount: 2, aiConversationsCount: 15 },
    { date: "Sep 20", revenue: 920, bookingsCount: 11, newCustomersCount: 5, aiConversationsCount: 22 },
    { date: "Sep 21", revenue: 840, bookingsCount: 10, newCustomersCount: 3, aiConversationsCount: 19 },
    { date: "Sep 22", revenue: 1150, bookingsCount: 14, newCustomersCount: 6, aiConversationsCount: 27 },
    { date: "Sep 23", revenue: 680, bookingsCount: 8, newCustomersCount: 2, aiConversationsCount: 16 },
  ],
};

/** Same seven days as `mockReport.dailyMetrics`, one week earlier (for comparison). */
export const mockPreviousWeekMetrics: DailyMetric[] = [
  { date: "Sep 10", revenue: 480, bookingsCount: 5, newCustomersCount: 2, aiConversationsCount: 11 },
  { date: "Sep 11", revenue: 650, bookingsCount: 8, newCustomersCount: 3, aiConversationsCount: 15 },
  { date: "Sep 12", revenue: 600, bookingsCount: 6, newCustomersCount: 2, aiConversationsCount: 13 },
  { date: "Sep 13", revenue: 780, bookingsCount: 9, newCustomersCount: 4, aiConversationsCount: 17 },
  { date: "Sep 14", revenue: 720, bookingsCount: 9, newCustomersCount: 2, aiConversationsCount: 16 },
  { date: "Sep 15", revenue: 940, bookingsCount: 11, newCustomersCount: 4, aiConversationsCount: 21 },
  { date: "Sep 16", revenue: 500, bookingsCount: 7, newCustomersCount: 1, aiConversationsCount: 12 },
];

/** Six-month trend. September matches `mockReport` totals. */
export const mockMonthlyMetrics: MonthlyMetric[] = [
  { month: "Apr", revenue: 9200, bookings: 121, newCustomers: 8, totalCustomers: 88 },
  { month: "May", revenue: 10450, bookings: 134, newCustomers: 9, totalCustomers: 97 },
  { month: "Jun", revenue: 11300, bookings: 148, newCustomers: 11, totalCustomers: 108 },
  { month: "Jul", revenue: 12100, bookings: 155, newCustomers: 10, totalCustomers: 118 },
  { month: "Aug", revenue: 12520, bookings: 164, newCustomers: 13, totalCustomers: 131 },
  { month: "Sep", revenue: 14820, bookings: 184, newCustomers: 11, totalCustomers: 142 },
];

/** September revenue by source (sums to `mockReport.totalRevenue`). */
export const mockRevenueBySource: RevenueSource[] = [
  { source: "Memberships", revenue: 4980 },
  { source: "Personal Training", revenue: 4650, bookings: 62 },
  { source: "HIIT Bootcamp", revenue: 1440, bookings: 48 },
  { source: "Yoga Classes", revenue: 1100, bookings: 44 },
  { source: "Product Sales", revenue: 1090 },
  { source: "Nutrition Consults", revenue: 1080, bookings: 18 },
  { source: "Assessments", revenue: 480, bookings: 12 },
];
