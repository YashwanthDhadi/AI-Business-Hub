"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Sparkles, Shield, Briefcase } from "lucide-react";
import { Button, Input } from "@/components/ui";

export default function BusinessLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleQuickFill = () => {
    setEmail("yash@fitzone.com");
    setPassword("fitzone2026");
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Please provide both email and password.");
      return;
    }

    setIsLoading(true);

    // Simulate mock owner sign-in delay
    setTimeout(() => {
      setIsLoading(false);
      // Route directly to owner dashboard
      router.push("/dashboard");
    }, 600);
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
        <Link
          href="/auth/select-role"
          className="text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Role Selection
        </Link>
      </div>

      {/* Main Login Card */}
      <div className="max-w-md mx-auto w-full my-8">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {/* Brand header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white mx-auto mb-3 shadow-lg shadow-indigo-600/30">
              <Briefcase className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Business Owner Sign In
            </h1>
            <p className="text-xs text-gray-400 mt-1.5">
              Access your business dashboard, bookings, and AI customer logs.
            </p>
          </div>

          {/* Quick Demo Fill Button */}
          <button
            type="button"
            onClick={handleQuickFill}
            className="w-full mb-5 py-2 px-3 rounded-lg border border-indigo-500/30 bg-indigo-950/40 text-xs text-indigo-300 hover:bg-indigo-900/40 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-fill FitZone Demo Owner (yash@fitzone.com)
          </button>

          {/* Error display */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
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

            <div className="flex items-center justify-between text-xs pt-1">
              <label className="flex items-center gap-2 text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="rounded border-gray-700 bg-gray-800 text-indigo-600 focus:ring-0"
                />
                Remember me
              </label>
              <span className="text-indigo-400 hover:underline cursor-pointer">
                Forgot password?
              </span>
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2"
              isLoading={isLoading}
            >
              Sign In to Dashboard
            </Button>
          </form>
        </div>

        {/* Links to register & admin login */}
        <div className="text-center space-y-2 mt-5 text-xs text-gray-400">
          <p>
            Don&apos;t have a business account yet?{" "}
            <Link href="/business/register" className="text-indigo-400 hover:text-indigo-300 font-medium">
              Register your business
            </Link>
          </p>
          <p className="pt-2 border-t border-gray-800/80">
            Platform Operator?{" "}
            <Link href="/admin/login" className="text-amber-400 hover:text-amber-300 font-medium inline-flex items-center gap-1">
              <Shield className="w-3 h-3" />
              Platform Admin Login
            </Link>
          </p>
        </div>
      </div>

      <div className="text-center text-xs text-gray-600">
        AI Business Hub • Business Portal
      </div>
    </div>
  );
}
