"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shield, ArrowLeft, Sparkles, Key, AlertTriangle } from "lucide-react";
import { Button, Input, Badge } from "@/components/ui";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleQuickFill = () => {
    setEmail("admin@aibusinesshub.com");
    setPassword("supersecretadmin2026");
    setPasscode("ADM-9942");
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!email || !password || !passcode) {
      setError("Please fill in email, password, and security passcode.");
      return;
    }

    setIsLoading(true);

    // Simulate mock admin security handshake
    setTimeout(() => {
      setIsLoading(false);
      // Route to platform admin dashboard
      router.push("/admin");
    }, 600);
  };

  return (
    <div className="min-h-screen bg-[#070a12] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top navigation */}
      <div className="max-w-md mx-auto w-full flex items-center justify-between">
        <Link
          href="/auth/select-role"
          className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Role Selection
        </Link>
        <Badge variant="warning">Super Admin Portal</Badge>
      </div>

      {/* Main Admin Card */}
      <div className="max-w-md mx-auto w-full my-8">
        <div className="rounded-2xl border border-amber-500/20 bg-gray-900/80 p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto mb-3 shadow-lg shadow-amber-500/10">
              <Shield className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Platform Admin Console
            </h1>
            <p className="text-xs text-gray-400 mt-1.5">
              Multi-tenant telemetry, agent status, and platform administration.
            </p>
          </div>

          {/* Quick Demo Fill Button */}
          <button
            type="button"
            onClick={handleQuickFill}
            className="w-full mb-5 py-2 px-3 rounded-lg border border-amber-500/30 bg-amber-950/30 text-xs text-amber-300 hover:bg-amber-900/40 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Auto-fill Admin Credentials (admin@aibusinesshub.com)
          </button>

          {/* Security warning notice */}
          <div className="mb-5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-300/90">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <span>
              Restricted platform operator environment. All login attempts and agent overrides are audited.
            </span>
          </div>

          {/* Error display */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
              {error}
            </div>
          )}

          {/* Admin Login Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              label="Admin Email"
              type="email"
              placeholder="admin@aibusinesshub.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            <Input
              label="Master Password"
              type="password"
              placeholder="••••••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

            <Input
              label="Operator Passcode"
              type="text"
              placeholder="ADM-XXXX"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              helperText="Demo passcode: ADM-9942"
              required
            />

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full mt-2 bg-amber-600 hover:bg-amber-500 text-white shadow-amber-600/20 focus:ring-amber-500"
              isLoading={isLoading}
            >
              <Key className="w-4 h-4 mr-1.5" />
              Authenticate & Access Console
            </Button>
          </form>
        </div>

        {/* Back link */}
        <p className="text-center text-xs text-gray-500 mt-5">
          Not a platform administrator?{" "}
          <Link href="/business/login" className="text-indigo-400 hover:text-indigo-300">
            Go to Business Owner Sign In
          </Link>
        </p>
      </div>

      <div className="text-center text-xs text-gray-600">
        AI Business Hub • Super Admin Tier
      </div>
    </div>
  );
}
