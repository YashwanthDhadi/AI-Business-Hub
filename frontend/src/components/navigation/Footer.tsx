import React from "react";
import Link from "next/link";
import { Bot, Shield } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-gray-800/80 bg-gray-950 text-gray-400 text-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand info */}
          <div className="md:col-span-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
                <Bot className="w-4 h-4" />
              </div>
              <span className="text-base font-bold text-white tracking-tight">
                AI Business Hub
              </span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">
              General-purpose AI business automation for small and medium businesses. 
              Automate support, bookings, payments, and inventory seamlessly.
            </p>
          </div>

          {/* Product links */}
          <div>
            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3">
              Capabilities
            </h4>
            <ul className="space-y-2 text-xs">
              <li><a href="#capabilities" className="hover:text-white transition-colors">Customer Support</a></li>
              <li><a href="#capabilities" className="hover:text-white transition-colors">Booking Automation</a></li>
              <li><a href="#capabilities" className="hover:text-white transition-colors">Payment Invoicing</a></li>
              <li><a href="#capabilities" className="hover:text-white transition-colors">Stock & Inventory</a></li>
              <li><a href="#capabilities" className="hover:text-white transition-colors">Executive Reports</a></li>
            </ul>
          </div>

          {/* Portals */}
          <div>
            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3">
              Portals & Roles
            </h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/business/register" className="hover:text-white transition-colors">
                  Business Owner Sign Up
                </Link>
              </li>
              <li>
                <Link href="/business/login" className="hover:text-white transition-colors">
                  Business Owner Login
                </Link>
              </li>
              <li>
                <Link href="/auth/select-role" className="hover:text-white transition-colors">
                  Role Selector
                </Link>
              </li>
              <li>
                <Link href="/admin/login" className="text-gray-500 hover:text-indigo-400 transition-colors flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Platform Admin Access
                </Link>
              </li>
            </ul>
          </div>

          {/* Live Mock Business Preview */}
          <div>
            <h4 className="text-xs font-semibold text-gray-200 uppercase tracking-wider mb-3">
              Demo Customer Link
            </h4>
            <p className="text-xs text-gray-400 mb-3">
              Preview how a customer interacts with an AI-automated business assistant:
            </p>
            <Link
              href="/chat/fitzone"
              className="inline-flex items-center text-xs font-mono bg-indigo-950/60 border border-indigo-800/60 text-indigo-300 px-3 py-1.5 rounded-md hover:bg-indigo-900/50 hover:text-white transition-colors"
            >
              /chat/fitzone →
            </Link>
          </div>
        </div>

        <div className="pt-8 border-t border-gray-900 flex flex-col sm:flex-row items-center justify-between text-xs text-gray-500 gap-4">
          <p>© {new Date().getFullYear()} AI Business Hub. All rights reserved.</p>
          <div className="flex gap-6">
            <span className="hover:text-gray-400 cursor-pointer">Privacy Policy</span>
            <span className="hover:text-gray-400 cursor-pointer">Terms of Service</span>
            <span className="hover:text-gray-400 cursor-pointer">Security</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
