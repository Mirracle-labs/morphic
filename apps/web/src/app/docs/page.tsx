export const dynamic = 'force-dynamic';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import DocsView from './docs-view';

export const metadata = {
  title: 'Dokumentasi | Morphic AI Gateway',
  description:
    'Panduan lengkap integrasi Morphic AI Gateway: setup Cursor, Cline, Windsurf, Claude Code, Python, Node.js SDK, dan referensi endpoint OpenAI-compatible.',
};

export default async function DocsPage() {
  let session = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (err) {
    console.warn('[DocsPage] Session check failed, rendering as guest:', err);
  }

  return (
    <main className="min-h-screen bg-white text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <DocsView session={session} />
      <Footer />
    </main>
  );
}

