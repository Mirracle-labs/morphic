export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import ModelsCatalogFull from '@/components/ModelsCatalogFull';
import Footer from '@/components/Footer';

export const metadata = {
  title: 'Models Catalog | Morphic AI Gateway',
  description: 'Jelajahi seluruh model AI DeepSeek, Qwen, Kimi, dan MiniMax dengan tarif hemat dan endpoint OpenAI-compatible.',
};

export default async function ModelsPage() {
  let session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.warn('[ModelsPage] Session check failed, rendering as guest:', err);
  }

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-hidden">
      <Navbar session={session} />
      <ModelsCatalogFull isLoggedIn={!!session} />
      <Footer />
    </main>
  );
}
