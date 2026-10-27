import React from "react";
import Link from "next/link";
import { Briefcase, Shield, Bot, ArrowLeft, MessageSquare } from "lucide-react";
import { RoleSelectCard } from "@/features/auth/components/RoleSelectCard";

export default function SelectRolePage() {
  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top Bar */}
      <div className="max-w-5xl mx-auto w-full flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
            <Bot className="w-4 h-4" />
          </div>
          <span className="text-sm font-bold text-white tracking-tight">
            AI Business Hub
          </span>
        </div>
      </div>

      {/* Main Selection Area */}
      <div className="max-w-4xl mx-auto w-full py-12">
        <div className="text-center max-w-xl mx-auto mb-10">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Welcome Back
          </h1>
          <p className="mt-3 text-base text-gray-400 leading-relaxed">
            Select the portal you would like to sign in to. Each portal provides a dedicated workspace for your responsibilities.
          </p>
        </div>

        {/* The Two Roles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <RoleSelectCard
            title="Business Owner & Staff"
            subtitle="Business Operating System"
            description="Manage your business operations, bookings, payments, customer directory, inventory levels, and AI chat assistant."
            icon={Briefcase}
            href="/business/login"
            badgeText="Single Tenant"
            accentColor="indigo"
          />

          <RoleSelectCard
            title="Platform Administrator"
            subtitle="SaaS Control Center"
            description="Oversee all registered businesses, monitor system health, view multi-tenant telemetry, and inspect AI agent performance."
            icon={Shield}
            href="/admin/login"
            badgeText="Super Admin"
            accentColor="amber"
          />
        </div>

        {/* Customer Information Callout */}
        <div className="mt-10 rounded-xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 flex-shrink-0">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-200">
                Are you a customer trying to contact a business?
              </h4>
              <p className="text-xs text-gray-400 mt-0.5">
                Customers do not need a login account. Open your business&apos;s direct chat link instead.
              </p>
            </div>
          </div>

          <Link
            href="/chat/fitzone"
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300 underline underline-offset-4 flex-shrink-0"
          >
            Open FitZone Demo Chat →
          </Link>
        </div>
      </div>

      {/* Footer */}
      <div className="text-center text-xs text-gray-600 pb-2">
        © {new Date().getFullYear()} AI Business Hub. Secure multi-tenant architecture.
      </div>
    </div>
  );
}
