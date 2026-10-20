export const dynamic = 'force-dynamic';

import { notFound } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionSafe } from '@/lib/auth';
import { cache } from 'react';
import { loadModelDetail } from '@/lib/model-detail';
import { memo } from '@/lib/memo';
import { AutoRefresh } from '@/components/AutoRefresh';
import { makerFromId } from '@/lib/model-maker';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { ModelDetailView } from './model-detail-view';

type Props = { params: Promise<{ id: string[] }> };

const idFrom = async (props: Props) => (await props.params).id.map(decodeURIComponent).join('/');

// cache(): metadata and page share one load per request; memo: visitors share it for 20s.
const getDetail = cache((id: string) => memo(`public:model:${id}`, 20_000, () => loadModelDetail(id)));

export async function generateMetadata(props: Props) {
  const detail = await getDetail(await idFrom(props)).catch(() => null);
  if (!detail) return { title: 'Model not found | Morphic AI Gateway' };
  return {
    title: `${detail.model.displayName} | Morphic AI Gateway`,
    description: detail.model.description ?? `${detail.model.displayName} on Morphic's OpenAI-compatible gateway.`,
  };
}

export default async function ModelPage(props: Props) {
  const id = await idFrom(props);
  const [session, detail] = await Promise.all([
    headers()
      .then((h) => getSessionSafe(h))
      .catch(() => null),
    getDetail(id),
  ]);
  if (!detail) notFound();

  const maker = makerFromId(detail.model.publicModelId);
  const related = detail.related.filter((r) => makerFromId(r.publicModelId) === maker).slice(0, 6);

  return (
    <main className="min-h-screen bg-[#fafafa] text-neutral-900 selection:bg-neutral-900 selection:text-white flex flex-col justify-between overflow-x-clip">
      <Navbar session={session} />
      <ModelDetailView detail={{ ...detail, related }} isLoggedIn={!!session} />
      <AutoRefresh intervalMs={60_000} />
      <Footer />
    </main>
  );
}
