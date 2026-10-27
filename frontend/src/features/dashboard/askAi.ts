/**
 * Mock "Ask AI" answers for the owner dashboard, computed from mock data.
 * Replaced later by a call to the business assistant API with the same return shape.
 */
import { mockBookings, mockInventory, mockPayments, mockReport, mockPreviousWeekMetrics, mockCustomers } from "@/data";
import { MOCK_TODAY } from "@/lib/constants";
import { formatCurrency, formatDate, timeToMinutes } from "@/lib/utils";

export interface AiResponse {
  query: string;
  answer: string;
  details?: {
    type: "bookings" | "payments" | "inventory" | "summary" | "customers";
    items: string[];
    actionLabel: string;
    actionHref: string;
  };
}

const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);

export function answerBusinessQuestion(text: string): AiResponse {
  const lower = text.toLowerCase();

  if (lower.includes("paid") || lower.includes("unpaid") || lower.includes("payment") || lower.includes("owe") || lower.includes("invoice")) {
    const open = mockPayments.filter((p) => p.status === "pending" || p.status === "overdue").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const total = sum(open.map((p) => p.amount));
    return {
      query: text,
      answer: `${open.length} customers have unpaid invoices totalling ${formatCurrency(total)}. ${open.filter((p) => p.status === "overdue").length} of them are overdue.`,
      details: {
        type: "payments",
        items: open.map(
          (p) =>
            `${p.customerName}: ${formatCurrency(p.amount)} (${p.status === "overdue" ? "overdue since" : "due"} ${formatDate(p.dueDate, { month: "short", day: "numeric" })}, ${p.invoiceNumber})`
        ),
        actionLabel: "Open Payments & Send Reminders",
        actionHref: "/dashboard/payments",
      },
    };
  }

  if (lower.includes("stock") || lower.includes("inventory") || lower.includes("product") || lower.includes("restock")) {
    const low = mockInventory.filter((i) => i.status !== "in_stock").sort((a, b) => a.quantity - b.quantity);
    return {
      query: text,
      answer: `You have ${low.length} products at or below their minimum stock level:`,
      details: {
        type: "inventory",
        items: low.map((i) => `${i.name}: ${i.quantity === 0 ? "out of stock" : `${i.quantity} left`} (minimum ${i.lowStockThreshold})`),
        actionLabel: "Manage Inventory Levels",
        actionHref: "/dashboard/inventory",
      },
    };
  }

  if (lower.includes("customer") || lower.includes("lead") || lower.includes("member")) {
    const leads = mockCustomers.filter((c) => c.status === "lead");
    const top = [...mockCustomers].sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 3);
    return {
      query: text,
      answer: `You have ${mockCustomers.filter((c) => c.status === "active").length} active customers and ${leads.length} new leads from your customer chat. Your top spenders are:`,
      details: {
        type: "customers",
        items: [...top.map((c) => `${c.name}: ${formatCurrency(c.totalSpend)} lifetime`), ...leads.map((c) => `New lead: ${c.name}`)],
        actionLabel: "Open Customers",
        actionHref: "/dashboard/customers",
      },
    };
  }

  if (lower.includes("booking") || lower.includes("today") || lower.includes("appointment") || lower.includes("schedule")) {
    const today = mockBookings
      .filter((b) => b.date === MOCK_TODAY && b.status !== "cancelled")
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    const pending = today.filter((b) => b.status === "pending").length;
    return {
      query: text,
      answer: `You have ${today.length} bookings today.${pending ? ` ${pending} still need your confirmation.` : " All are confirmed."}`,
      details: {
        type: "bookings",
        items: today.map(
          (b) => `${b.time} • ${b.customerName} (${b.serviceName}${b.staffAssigned ? ` w/ ${b.staffAssigned}` : ""})${b.status === "pending" ? " - Needs Confirmation" : ""}`
        ),
        actionLabel: "View All Bookings",
        actionHref: "/dashboard/bookings",
      },
    };
  }

  const revenue = sum(mockReport.dailyMetrics.map((d) => d.revenue));
  const revenuePrev = sum(mockPreviousWeekMetrics.map((d) => d.revenue));
  const bookings = sum(mockReport.dailyMetrics.map((d) => d.bookingsCount));
  const chats = sum(mockReport.dailyMetrics.map((d) => d.aiConversationsCount));
  const growth = Math.round(((revenue - revenuePrev) / revenuePrev) * 100);
  return {
    query: text,
    answer: `This week your business earned ${formatCurrency(revenue)}, up ${growth}% on last week, with ${bookings} bookings. Your customer chat handled ${chats} conversations for you.`,
    details: {
      type: "summary",
      items: [
        `Weekly revenue: ${formatCurrency(revenue)} (+${growth}%)`,
        `Bookings this week: ${bookings}`,
        `Chat conversations: ${chats}`,
      ],
      actionLabel: "View Full Report",
      actionHref: "/dashboard/reports",
    },
  };
}
