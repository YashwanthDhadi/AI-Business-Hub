import type { Metadata, Viewport } from "next";
import { PayPage } from "@/features/payments/components/PayPage";

interface PayPageProps {
  params: Promise<{ token: string }>;
}

/** Every link is a different invoice, created at runtime. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay your invoice",
  // A payment link is private. It must never appear in search results.
  robots: { index: false, follow: false },
  // Do not leak the token to other sites through the Referer header.
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#030712",
};

/** Public, login-free: the random token in the URL is the only permission. */
export default async function PublicPayPage({ params }: PayPageProps) {
  const { token } = await params;
  return <PayPage token={token} />;
}
