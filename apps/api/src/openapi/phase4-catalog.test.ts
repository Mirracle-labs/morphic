import { test } from 'node:test';
import assert from 'node:assert/strict';
import { db, schema as s } from '@morphic/db';
import { app } from '../app';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function mkCatalogUser() {
  const tag = uid();
  const [user] = await db
    .insert(s.users)
    .values({ name: 'Catalog Tester', email: `cat-${tag}@catalog.test` })
    .returning();
  const token = `cat_${tag}`;
  await db.insert(s.sessions).values({
    userId: user!.id,
    token,
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { user: user!, token };
}

test('1. OpenAPI Spec Document: Verify all Catalog endpoints are registered', async () => {
  const res = await app.request('/openapi.json');
  assert.equal(res.status, 200);

  const spec = (await res.json()) as {
    paths: Record<
      string,
      Record<
        string,
        {
          tags: string[];
          summary: string;
          responses: Record<string, { headers?: Record<string, unknown> }>;
        }
      >
    >;
    components: {
      schemas: Record<string, unknown>;
    };
  };

  // GET /v1/catalog/models
  const modelsRoute = spec.paths['/v1/catalog/models']?.get;
  assert.ok(modelsRoute, 'GET /v1/catalog/models must be in OpenAPI spec');
  assert.equal(modelsRoute.summary, 'Get Catalog Models');
  assert.deepEqual(modelsRoute.tags, ['Catalog']);
  assert.ok(modelsRoute.responses['200']);
  assert.ok(modelsRoute.responses['401']);
  assert.ok(modelsRoute.responses['429']);
  assert.ok(modelsRoute.responses['500']);

  // GET /v1/catalog/packages
  const packagesRoute = spec.paths['/v1/catalog/packages']?.get;
  assert.ok(packagesRoute, 'GET /v1/catalog/packages must be in OpenAPI spec');
  assert.equal(packagesRoute.summary, 'Get Catalog Packages');
  assert.deepEqual(packagesRoute.tags, ['Catalog']);
  assert.ok(packagesRoute.responses['200']);
  assert.ok(packagesRoute.responses['401']);
  assert.ok(packagesRoute.responses['429']);
  assert.ok(packagesRoute.responses['500']);

  // Verify registered schema components
  assert.ok(spec.components.schemas['CircuitBreakerState']);
  assert.ok(spec.components.schemas['CatalogModelItem']);
  assert.ok(spec.components.schemas['CatalogModelsResponse']);
  assert.ok(spec.components.schemas['CatalogPackageItem']);
  assert.ok(spec.components.schemas['CatalogPackagesResponse']);
});

test('2. Unauthenticated requests to /v1/catalog/* must return 401', async () => {
  const endpoints = ['/v1/catalog/models', '/v1/catalog/packages'];

  for (const path of endpoints) {
    const res = await app.request(path);
    assert.equal(res.status, 401, `${path} should require authentication`);
  }
});

test('3. GET /v1/catalog/models returns active model catalog', async () => {
  const { token } = await mkCatalogUser();
  const res = await app.request('/v1/catalog/models', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: {
      publicModelId: string;
      displayName: string;
      contextLength: number;
      capabilities: string[];
      inputCreditsPer1m: number;
      outputCreditsPer1m: number;
      providerName: string;
      circuitBreakerState: unknown;
    }[];
  };

  assert.ok(Array.isArray(body.data));
  if (body.data.length > 0) {
    const first = body.data[0]!;
    assert.ok(typeof first.publicModelId === 'string');
    assert.ok(typeof first.displayName === 'string');
    assert.ok(typeof first.contextLength === 'number');
    assert.ok(typeof first.providerName === 'string');
  }
});

test('4. GET /v1/catalog/packages returns active commercial packages', async () => {
  const { token } = await mkCatalogUser();
  const res = await app.request('/v1/catalog/packages', {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as {
    data: {
      id: string;
      name: string;
      creditAllowance: number;
      priceCents: number | null;
      currency: string;
      recurring: boolean;
      status: string;
    }[];
  };

  assert.ok(Array.isArray(body.data));
  if (body.data.length > 0) {
    const first = body.data[0]!;
    assert.ok(typeof first.id === 'string');
    assert.ok(typeof first.name === 'string');
    assert.ok(typeof first.creditAllowance === 'number');
    assert.ok(typeof first.currency === 'string');
    assert.equal(first.status, 'active');
  }
});
