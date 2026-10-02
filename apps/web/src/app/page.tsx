import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import Navbar from '@/components/Navbar';
import HeroOpening from '@/components/HeroOpening';
import ModelCatalog from '@/components/ModelCatalog';
import HowItWorksSteps from '@/components/HowItWorksSteps';
import MarketingProblemSolution from '@/components/MarketingProblemSolution';
import QuickstartSnippet from '@/components/QuickstartSnippet';
import MarketingFaq from '@/components/MarketingFaq';
import Footer from '@/components/Footer';

export default async function Home() {
  const session = await auth.api.getSession({ headers: await headers() });

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white relative flex flex-col justify-between overflow-x-hidden">
      {/* Floating Capsule Navbar */}
      <Navbar session={session} />

      {/* 1. Opening Section: Hero */}
      <HeroOpening isLoggedIn={!!session} />

      {/* 2. Model Catalog & AI Capabilities (Without public pricing card layout) */}
      <ModelCatalog isLoggedIn={!!session} />

      {/* 3. Step-by-Step Guide */}
      <HowItWorksSteps isLoggedIn={!!session} />

      {/* 4. Marketing Comparison: Old Problems vs Morphic Solution */}
      <MarketingProblemSolution />

      {/* 5. Developer Integration: Quickstart Code Snippets */}
      <QuickstartSnippet />

      {/* 6. Marketing FAQ */}
      <MarketingFaq />

      {/* 7. Bottom Minimal Footer */}
      <Footer />
    </main>
  );
}
