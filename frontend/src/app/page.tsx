import React from "react";
import Link from "next/link";
import {
  Calendar,
  CreditCard,
  Package,
  MessageSquare,
  FileText,
  TrendingUp,
  ArrowRight,
  CheckCircle2,
  Sparkles,
  ExternalLink,
  Smartphone,
  LayoutDashboard,
} from "lucide-react";
import { Navbar } from "@/components/navigation/Navbar";
import { Footer } from "@/components/navigation/Footer";
import { Button, Card, CardHeader, CardTitle, CardDescription, Badge } from "@/components/ui";

export default function LandingPage() {
  const capabilities = [
    {
      icon: MessageSquare,
      title: "Customer Support Assistant",
      desc: "Answers customer questions instantly about services, prices, and hours 24/7 without staff intervention.",
      badge: "Support",
    },
    {
      icon: Calendar,
      title: "Autonomous Bookings",
      desc: "Checks real-time availability, reserves appointment slots, and sends confirmations directly in chat.",
      badge: "Bookings",
    },
    {
      icon: CreditCard,
      title: "Payments & Invoicing",
      desc: "Generates invoice summaries, tracks pending customer bills, and shares direct payment links.",
      badge: "Payments",
    },
    {
      icon: Package,
      title: "Inventory & Stock Alerts",
      desc: "Monitors stock levels in real time and automatically alerts owners before key supplies run out.",
      badge: "Inventory",
    },
    {
      icon: TrendingUp,
      title: "Intelligent Business Reports",
      desc: "Provides instant answers to queries like 'Show today's revenue' or 'Who has not paid this week?'.",
      badge: "Reporting",
    },
    {
      icon: FileText,
      title: "Document Knowledge Base",
      desc: "Upload price sheets, liability waivers, or company policies. AI reads and answers questions from them.",
      badge: "Knowledge",
    },
  ];

  const steps = [
    {
      step: "01",
      title: "Register & Configure",
      description:
        "Input your business details, working hours, services, and inventory items through our guided onboarding wizard.",
    },
    {
      step: "02",
      title: "Share Your Unique AI Chat Link",
      description:
        "Place your link (e.g. yourplatform.com/chat/fitzone) or printable QR code on your website, front desk, and Instagram bio.",
    },
    {
      step: "03",
      title: "Run Your Business on Autopilot",
      description:
        "Customers book and inquire through AI chat while you manage operations from your unified Owner Dashboard.",
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f19] text-gray-100 selection:bg-indigo-500/30 selection:text-indigo-200">
      {/* Navbar */}
      <Navbar />

      <main className="flex-1">
        {/* HERO SECTION */}
        <section className="relative pt-20 pb-24 md:pt-28 md:pb-32 overflow-hidden border-b border-gray-800/60">
          {/* Subtle ambient background glow */}
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-indigo-600/15 blur-[120px] rounded-full pointer-events-none" />

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
            {/* Top pill badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-950/40 text-indigo-300 text-xs font-medium mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Next-Generation AI Workforce for Small & Medium Businesses</span>
            </div>

            {/* Main Title */}
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-white max-w-4xl mx-auto leading-tight md:leading-[1.15]">
              Your AI Workforce for Business Operations
            </h1>

            {/* Subtitle */}
            <p className="mt-6 text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto leading-relaxed font-normal">
              AI Business Hub helps business owners automate customer support, booking appointments, 
              tracking payments, monitoring inventory, and generating executive reports—all from one clean dashboard.
            </p>

            {/* Hero CTAs */}
            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link href="/business/register" className="w-full sm:w-auto">
                <Button variant="primary" size="lg" className="w-full sm:w-auto shadow-lg shadow-indigo-600/20">
                  Get Started Free
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </Button>
              </Link>
              <Link href="/auth/select-role" className="w-full sm:w-auto">
                <Button variant="secondary" size="lg" className="w-full sm:w-auto">
                  Sign In to Portal
                </Button>
              </Link>
            </div>

            {/* Quick Demo Preview Link */}
            <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
              <span>Want to see how customers experience it?</span>
              <Link
                href="/chat/fitzone"
                className="text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1 underline underline-offset-4"
              >
                Try FitZone Demo Chat <ExternalLink className="w-3 h-3" />
              </Link>
            </div>

            {/* Hero Dashboard Preview Card */}
            <div className="mt-14 max-w-5xl mx-auto rounded-2xl border border-gray-800 bg-gray-900/60 p-3 sm:p-4 backdrop-blur-xl shadow-2xl">
              <div className="rounded-xl border border-gray-800/80 bg-gray-950 p-4 sm:p-6 text-left">
                {/* Mock Browser/Dashboard Bar */}
                <div className="flex items-center justify-between pb-4 border-b border-gray-800 mb-6">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full bg-rose-500/80" />
                    <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                    <span className="ml-2 text-xs text-gray-400 font-mono">
                      https://aibusinesshub.com/dashboard
                    </span>
                  </div>
                  <Badge variant="brand">FitZone Fitness Club</Badge>
                </div>

                {/* Dashboard Snapshot Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-6">
                  <div className="bg-gray-900/80 border border-gray-800 p-3.5 rounded-lg">
                    <span className="text-xs text-gray-400 block">Today&apos;s Bookings</span>
                    <span className="text-xl sm:text-2xl font-bold text-white mt-1 block">8</span>
                    <span className="text-[11px] text-emerald-400 mt-1 block">✓ All slots filled</span>
                  </div>
                  <div className="bg-gray-900/80 border border-gray-800 p-3.5 rounded-lg">
                    <span className="text-xs text-gray-400 block">Pending Payments</span>
                    <span className="text-xl sm:text-2xl font-bold text-amber-400 mt-1 block">₹205</span>
                    <span className="text-[11px] text-gray-400 mt-1 block">2 invoices due</span>
                  </div>
                  <div className="bg-gray-900/80 border border-gray-800 p-3.5 rounded-lg">
                    <span className="text-xs text-gray-400 block">Active Customers</span>
                    <span className="text-xl sm:text-2xl font-bold text-white mt-1 block">142</span>
                    <span className="text-[11px] text-indigo-400 mt-1 block">+6 this week</span>
                  </div>
                  <div className="bg-gray-900/80 border border-gray-800 p-3.5 rounded-lg">
                    <span className="text-xs text-gray-400 block">Inventory Alerts</span>
                    <span className="text-xl sm:text-2xl font-bold text-rose-400 mt-1 block">2</span>
                    <span className="text-[11px] text-rose-400/90 mt-1 block">Low stock warning</span>
                  </div>
                </div>

                {/* Simulated "Ask AI" Prompt Bar */}
                <div className="rounded-lg bg-gray-900 border border-indigo-500/30 p-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 text-sm text-gray-300">
                    <Sparkles className="w-4 h-4 text-indigo-400 flex-shrink-0" />
                    <span>&quot;Show today&apos;s bookings and prepare reminders for unpaid members&quot;</span>
                  </div>
                  <Badge variant="brand" className="hidden sm:inline-flex">AI Assistant Ready</Badge>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CAPABILITIES SECTION */}
        <section id="capabilities" className="py-20 md:py-28 border-b border-gray-800/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                Comprehensive Capabilities
              </h2>
              <h3 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Everything Your Business Needs to Operate Smoothly
              </h3>
              <p className="mt-4 text-gray-400 text-base leading-relaxed">
                Replace fragmented tools with an intelligent, cohesive AI system built specifically 
                for service businesses, gyms, clinics, salons, and consultancies.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {capabilities.map((cap) => {
                const IconComponent = cap.icon;
                return (
                  <Card key={cap.title} className="hover:border-gray-700 transition-all hover:-translate-y-0.5">
                    <CardHeader>
                      <div className="flex items-center justify-between mb-3">
                        <div className="w-10 h-10 rounded-lg bg-indigo-600/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                          <IconComponent className="w-5 h-5" />
                        </div>
                        <Badge variant="brand">{cap.badge}</Badge>
                      </div>
                      <CardTitle className="text-lg">{cap.title}</CardTitle>
                      <CardDescription className="text-sm leading-relaxed mt-2 text-gray-400">
                        {cap.desc}
                      </CardDescription>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
          </div>
        </section>

        {/* HOW IT WORKS SECTION */}
        <section id="how-it-works" className="py-20 md:py-28 border-b border-gray-800/60 bg-gray-950/40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                Simple 3-Step Setup
              </h2>
              <h3 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Up and Running in Under 10 Minutes
              </h3>
              <p className="mt-4 text-gray-400 text-base leading-relaxed">
                No complex coding or machine learning knowledge required. Set up your business profile 
                and let the platform handle the rest.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {steps.map((st) => (
                <div key={st.step} className="relative rounded-2xl border border-gray-800 bg-gray-900/50 p-6 sm:p-8">
                  <div className="text-3xl font-extrabold text-indigo-500/40 font-mono mb-4">
                    {st.step}
                  </div>
                  <h4 className="text-xl font-bold text-white mb-2">{st.title}</h4>
                  <p className="text-sm text-gray-400 leading-relaxed">{st.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TWO EXPERIENCES EXPLANATION SECTION */}
        <section id="for-businesses" className="py-20 md:py-28 border-b border-gray-800/60">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest mb-3">
                Tailored Experiences
              </h2>
              <h3 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                Two Purpose-Built Portals. Zero Confusion.
              </h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Business Owner Experience */}
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8 space-y-5">
                <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <LayoutDashboard className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white">For Business Owners & Staff</h4>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                    A streamlined, natural-language business operating system. Ask questions in plain English, 
                    view today&apos;s bookings, send customer reminders, and manage inventory with zero tech jargon.
                  </p>
                </div>
                <ul className="space-y-2.5 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Plain English query bar: &quot;Who hasn&apos;t paid?&quot;
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Automated low-stock and appointment alerts
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Real-time audit log of customer chat sessions
                  </li>
                </ul>
                <div className="pt-3">
                  <Link href="/business/register">
                    <Button variant="secondary" size="md" className="w-full">
                      Start as Business Owner
                    </Button>
                  </Link>
                </div>
              </div>

              {/* Customer Experience */}
              <div id="customer-experience" className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8 space-y-5">
                <div className="w-12 h-12 rounded-xl bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="text-xl font-bold text-white">For Your Customers</h4>
                  <p className="text-sm text-gray-400 mt-2 leading-relaxed">
                    Zero friction. Customers do NOT download apps or create accounts. They simply visit your unique 
                    business web chat link, ask questions, and book services instantly.
                  </p>
                </div>
                <ul className="space-y-2.5 text-sm text-gray-300">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Unique branded URL: yourplatform.com/chat/[businessSlug]
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    One-tap quick action chips (Book, Pricing, Hours)
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    Voice input and mobile-first responsive design
                  </li>
                </ul>
                <div className="pt-3">
                  <Link href="/chat/fitzone">
                    <Button variant="outline" size="md" className="w-full">
                      Open Sample Customer Chat
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CALL TO ACTION */}
        <section className="py-20 md:py-24 relative overflow-hidden">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
            <div className="rounded-3xl border border-indigo-500/30 bg-gradient-to-b from-indigo-950/50 to-gray-950 p-8 sm:p-14 shadow-2xl">
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Ready to Put Your Business Operations on Autopilot?
              </h2>
              <p className="mt-4 text-base sm:text-lg text-gray-300 max-w-xl mx-auto">
                Join forward-thinking businesses automating customer bookings, inquiries, and daily operations with AI.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/business/register" className="w-full sm:w-auto">
                  <Button variant="primary" size="lg" className="w-full sm:w-auto">
                    Create Business Account
                    <ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </Link>
                <Link href="/auth/select-role" className="w-full sm:w-auto">
                  <Button variant="outline" size="lg" className="w-full sm:w-auto">
                    Sign In
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <Footer />
    </div>
  );
}
