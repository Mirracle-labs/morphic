import { desc } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { createAnnouncement, deleteAnnouncement } from '@/lib/admin-actions';

export const dynamic = 'force-dynamic';

export default async function AdminAnnouncements() {
  await requireAdmin();
  const { locale } = await getServerTranslation();
  const en = locale === 'en';
  const rows = await db.select().from(s.announcements).orderBy(desc(s.announcements.publishedAt)).limit(100);

  const input = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 placeholder:text-neutral-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-heading font-extrabold text-neutral-950">Changelog</h1>
        <p className="mt-1 text-sm text-neutral-700">
          {en ? 'Posts here appear in every user’s notification drawer under Changelog.' : 'Postingan di sini muncul di notifikasi semua user, tab Changelog.'}
        </p>
      </div>

      <form action={createAnnouncement} className="rounded-2xl border border-neutral-200 bg-white p-5 space-y-3">
        <label className="block text-sm font-medium text-neutral-900">
          {en ? 'Title' : 'Judul'}
          <input name="title" required maxLength={200} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm font-medium text-neutral-900">
          {en ? 'Body' : 'Isi'}
          <textarea name="body" required maxLength={4000} rows={4} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-sm font-medium text-neutral-900">
          {en ? 'Link (optional, /path or https://…)' : 'Link (opsional, /path atau https://…)'}
          <input name="linkUrl" maxLength={500} placeholder="/models" className={`mt-1 ${input}`} />
        </label>
        <button type="submit" className="h-10 rounded-lg bg-neutral-950 px-5 text-sm font-semibold text-white hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 cursor-pointer">
          {en ? 'Publish' : 'Terbitkan'}
        </button>
      </form>

      <section className="rounded-2xl border border-neutral-200 bg-white divide-y divide-neutral-100">
        {rows.length === 0 ? (
          <p className="p-6 text-center text-sm text-neutral-600">{en ? 'No posts yet.' : 'Belum ada postingan.'}</p>
        ) : (
          rows.map((a) => (
            <article key={a.id} className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="text-xs text-neutral-600">{a.publishedAt.toLocaleString(en ? 'en-US' : 'id-ID', { timeZone: 'Asia/Jakarta' })}</div>
                <h2 className="font-semibold text-neutral-950">{a.title}</h2>
                <p className="mt-1 whitespace-pre-line text-sm text-neutral-800">{a.body}</p>
                {a.linkUrl && <p className="mt-1 font-mono text-xs text-neutral-700">{a.linkUrl}</p>}
              </div>
              <form action={deleteAnnouncement}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className="h-9 rounded-lg border border-neutral-300 px-3 text-sm text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer">
                  {en ? 'Delete' : 'Hapus'}
                </button>
              </form>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
