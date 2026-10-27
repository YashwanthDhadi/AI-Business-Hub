"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot, Menu, X, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

export function Navbar() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-gray-800/80 bg-gray-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-white flex items-center gap-1.5">
                AI Business Hub
              </span>
              <span className="block text-[10px] text-gray-400 font-medium tracking-wider uppercase">
                AI Workforce for SMBs
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-300">
            <a href="#capabilities" className="hover:text-white transition-colors">
              Capabilities
            </a>
            <a href="#how-it-works" className="hover:text-white transition-colors">
              How It Works
            </a>
            <a href="#for-businesses" className="hover:text-white transition-colors">
              For Businesses
            </a>
            <a href="#customer-experience" className="hover:text-white transition-colors">
              Customer Experience
            </a>
          </nav>

          {/* Action Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <Link href="/auth/select-role">
              <Button variant="ghost" size="sm">
                Sign In
              </Button>
            </Link>
            <Link href="/business/register">
              <Button variant="primary" size="sm">
                Get Started
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
          </div>

          {/* Mobile Menu Toggle Button */}
          <div className="flex md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-b border-gray-800 bg-gray-900/95 px-4 pt-3 pb-6 space-y-4">
          <nav className="flex flex-col space-y-3 text-base font-medium text-gray-300">
            <a
              href="#capabilities"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white py-1"
            >
              Capabilities
            </a>
            <a
              href="#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white py-1"
            >
              How It Works
            </a>
            <a
              href="#for-businesses"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white py-1"
            >
              For Businesses
            </a>
            <a
              href="#customer-experience"
              onClick={() => setMobileMenuOpen(false)}
              className="hover:text-white py-1"
            >
              Customer Experience
            </a>
          </nav>
          <div className="pt-3 border-t border-gray-800 flex flex-col gap-2.5">
            <Link href="/auth/select-role" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="outline" size="md" className="w-full">
                Sign In
              </Button>
            </Link>
            <Link href="/business/register" onClick={() => setMobileMenuOpen(false)}>
              <Button variant="primary" size="md" className="w-full">
                Get Started
              </Button>
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
