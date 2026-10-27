"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ArrowLeft, CheckCircle2, Sparkles } from "lucide-react";
import { Button, Input } from "@/components/ui";

export default function BusinessRegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleQuickFill = () => {
    setFullName("Yashwanth");
    setEmail("yash@fitzone.com");
    setPassword("securepass123");
    setConfirmPassword("securepass123");
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!fullName || !email || !password) {
      setError("Please fill in all required fields.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsLoading(true);

    // Simulate mock registration network delay
    setTimeout(() => {
      setIsLoading(false);
      // Route immediately to business onboarding wizard
      router.push("/business/onboarding");
    }, 700);
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top navigation */}
      <div className="max-w-md mx-auto w-full flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Home
        </Link>
        <Link href="/auth/select-role" className="text-xs text-gray-400 hover:text-gray-200">
          Switch Role
        </Link>
      </div>

      {/* Main Form Card */}
      <div className="max-w-md mx-auto w-full my-8">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {/* Brand header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white mx-auto mb-3 shadow-lg shadow-indigo-600/30">
              <Bot className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Create Your Business Account
            </h1>
            <p className="text-xs text-gray-400 mt-1.5">
              Set up your AI Business Hub workspace in less than 2 minutes.
            </p>
          </div>

          {/* Quick Demo Fill Button */}
          <button
            type="button"
            onClick={handleQuickFill}
            className="w-full mb-5 py-2 px-3 rounded-lg border border-indigo-500/30 bg-indigo-950/40 text-xs text-indigo-300 hover:bg-indigo-900/40 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-fill with Demo Data (Yashwanth)
          </button>

          {/* Error notice */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Registration Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Full Name"
              type="text"
              placeholder="e.g. Yashwanth"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />

            <Input
              label="Business Email"
              type="email"
              placeholder="owner@yourbusiness.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Input
              label="Confirm Password"
              type="password"
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Create Business Account
            </Button>
          </form>

          {/* Benefits summary list */}
          <div className="mt-6 pt-5 border-t border-gray-800 space-y-2 text-[11px] text-gray-400">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span>Includes instant AI Customer Chat link & QR code</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              <span>No credit card required for frontend preview</span>
            </div>
          </div>
        </div>

        {/* Existing account link */}
        <p className="text-center text-xs text-gray-400 mt-5">
          Already have a business account?{" "}
          <Link href="/business/login" className="text-indigo-400 hover:text-indigo-300 font-medium">
            Sign In here
          </Link>
        </p>
      </div>

      <div className="text-center text-xs text-gray-600">
        AI Business Hub • Business Portal
      </div>
    </div>
  );
}
