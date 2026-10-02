export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import PricingPlans from '@/components/PricingPlans';
import PricingCalculator from '@/components/PricingCalculator';
import PricingComparisonTable from '@/components/PricingComparisonTable';
import PricingFaq from '@/components/PricingFaq';
import LandingApiCta from '@/components/LandingApiCta';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Paket & Harga Kredit | Morphic AI Gateway',
  description:
    'Harga transparan paket kuota AI gateway Morphic mulai Rp 15.000 tanpa langganan. Hemat biaya token hingga 70% dengan QRIS lokal instan (BCA, Mandiri, GoPay).',
};

export default async function PricingPage() {
  let session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.warn('[PricingPage] Session check failed, rendering as guest:', err);
  }

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-hidden">
      {/* 1. Floating Navbar */}
      <Navbar session={session} />

      {/* 2. Core Pricing Tiers & Daily Passes */}
      <PricingPlans isLoggedIn={!!session} showPricingHubLink={false} />

      {/* 3. Interactive Token Savings Calculator */}
      <PricingCalculator />

      {/* 4. Comprehensive Feature Comparison Matrix */}
      <PricingComparisonTable isLoggedIn={!!session} />

      {/* 5. Dedicated Billing & Payment FAQ */}
      <PricingFaq />

      {/* 6. High-Impact Dark Contrast Conversion Banner */}
      <LandingApiCta isLoggedIn={!!session} />

      {/* 7. Horizon Deck Footer */}
      <Footer />
    </main>
  );
}
