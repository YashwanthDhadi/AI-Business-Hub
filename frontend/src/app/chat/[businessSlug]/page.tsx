import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { CustomerChatApp } from "@/features/customer-chat/components/CustomerChatApp";
import { getPublicBusiness } from "@/lib/public-business";

interface ChatPageProps {
  params: Promise<{ businessSlug: string }>;
}

/**
 * Businesses are created at runtime, so this page cannot be pre-rendered.
 * (The mock version used generateStaticParams over a fixed list.)
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ChatPageProps): Promise<Metadata> {
  const { businessSlug } = await params;
  const business = await getPublicBusiness(businessSlug);
  if (!business) return { title: "Chat not found | AI Business Hub" };
  return {
    title: `Chat with ${business.profile.name}`,
    description: `Get answers from ${business.profile.name}, any time.`,
    // A customer support chat has no business being in search results.
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#030712",
};

/** Public, login-free customer chat for one business. */
export default async function PublicChatPage({ params }: ChatPageProps) {
  const { businessSlug } = await params;
  const business = await getPublicBusiness(businessSlug);
  if (!business) notFound();

  return (
    <CustomerChatApp
      slug={businessSlug}
      business={business.profile}
      assistant={business.assistant}
    />
  );
}
