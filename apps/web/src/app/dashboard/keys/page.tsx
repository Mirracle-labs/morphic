import { listApiKeys, getActiveModelsForTesting } from '@/lib/actions';
import { KeysView } from './keys-view';

export default async function KeysPage() {
  let keys: any[] = [];
  let availableModels: Array<{ id: string; name: string }> = [];

  try {
    const [rawKeys, models] = await Promise.all([
      listApiKeys(),
      getActiveModelsForTesting(),
    ]);

    keys = (rawKeys || []).map((k: any) => ({
      ...k,
      expiresAt: k.expiresAt ? new Date(k.expiresAt) : null,
      lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
      createdAt: k.createdAt ? new Date(k.createdAt) : new Date(),
    }));

    availableModels = models || [];
  } catch (err) {
    console.warn('[KeysPage] Error fetching api keys or models:', err);
    keys = [];
  }

  return <KeysView initialKeys={keys} availableModels={availableModels} />;
}
