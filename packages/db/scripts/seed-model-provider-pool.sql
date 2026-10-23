-- ============================================================================
-- seed-model-provider-pool.sql — Pooling Phase 1B
--
-- Populates `model_provider_pool` from today's single-provider legacy wiring so
-- that enabling POOL_ENABLED keeps the same routing behaviour.
--
-- THIS FILE IS DELIVERED FOR A HUMAN TO RUN. It is never executed automatically
-- by tests, CI, migrations, or the API. Review the SELECT previews below
-- (sections 2b, 3 and 4), then run it yourself against the intended database.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f packages/db/scripts/seed-model-provider-pool.sql
--
-- The script is wrapped in one transaction. It is idempotent: rows that already
-- exist for (model_id, provider_id) are left untouched (ON CONFLICT DO NOTHING),
-- so re-running it after adding a fallback provider inserts only the new rows.
--
-- ----------------------------------------------------------------------------
-- ASSUMPTIONS
-- ----------------------------------------------------------------------------
-- 1. Migration 0017_smooth_mister_fear.sql (table `model_provider_pool`) has
--    already been applied to this database.
-- 2. Only models with status IN ('active', 'deprecated') are seeded. Models
--    with status 'inactive' are intentionally skipped (they are not routable;
--    plan D3 answers 404 for them). Deprecated models are seeded because they
--    may still serve traffic when no replacement is available.
-- 3. Priority 1 = `models.provider_id` with `models.provider_model_id`.
--    Priority 2 = `models.fallback_provider_id`, only when it is set and
--    different from `provider_id`, reusing the SAME `provider_model_id` string
--    (identical to today's `resolveFallback` behaviour; plan §7.1B).
-- 4. `weight` = 100, `is_enabled` = true, `ttfb_timeout_ms` = NULL,
--    `data_policy` = NULL. These are defaults, not discovered data.
-- 5. Cost overrides (`cost_input_per_1m`, `cost_output_per_1m`) are left NULL on
--    purpose. Today's `upstreamPricing` is model-level (`models.provider_cost_*`);
--    Pooling Phase 1D falls back to that model-level value when either override
--    is NULL, so NULL here preserves current billing exactly.
-- 6. The D9 parity invariant (every enabled entry serves the model at
--    >= models.context_length and supports ALL models.capabilities) cannot be
--    verified from this database alone. The fallback entry reuses the primary
--    provider_model_id string, so it inherits the primary's capability claims.
--    A human must confirm those claims for the fallback provider before relying
--    on it. Column `model_context_length` / `model_capabilities` are shown in
--    the preview for that review.
-- 7. PREFLIGHT P11 (brand-only providers) — exact list for the reviewed
--    deployment data: `qwen` and `kimi`.
--      Method: a provider is brand-only when it is catalog-visible (it backs an
--      active/deprecated model) but cannot resolve a credential, so no request
--      can ever be routed to it. Both rows have `encrypted_credentials IS NULL`
--      and reference an env var (`DASHSCOPE_API_KEY`, `MOONSHOT_API_KEY`) that is
--      absent from `.env` and `.env.production`. `deepseek` is NOT skipped: it
--      has a stored encrypted credential. Rows whose base URL is on
--      *.upstream.test are test fixtures, not brands, and are ignored.
--    These two are excluded in section 2 so the seed does not create pool rows
--    that would always be skipped at routing time (D9/candidate filtering).
--    Their models therefore keep using the legacy path (D2) until a human adds
--    real credentials and removes the names from section 2, then re-runs this
--    file. The preview in section 2b lists the excluded rows for that review.
-- 8. No credentials, API keys, base URLs, or other secrets are read or written.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------------------
--   DELETE FROM model_provider_pool WHERE created_at >= '<timestamp of run>';
-- or, if you have not enabled POOL_ENABLED yet, simply drop/ignore the table.
-- The API ignores the pool entirely while POOL_ENABLED=false.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 2. Brand-only provider names to exclude (PREFLIGHT P11).
--    Exact list for the reviewed data: qwen, kimi (see header assumption 7).
--    Remove a row here after that provider has real credentials, then re-run.
-- ----------------------------------------------------------------------------
CREATE TEMP TABLE seed_mpp_brand_only (name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO seed_mpp_brand_only (name) VALUES
  ('qwen'),
  ('kimi');

-- 2b. PREVIEW — the rows excluded by section 2, with why they qualified.
SELECT
  p.name                                   AS provider_name,
  p.status,
  p.credential_reference,
  (p.encrypted_credentials IS NOT NULL)    AS has_stored_credential,
  count(m.id)                              AS selected_models
FROM providers p
LEFT JOIN models m
  ON m.provider_id = p.id AND m.status IN ('active', 'deprecated')
WHERE p.name IN (SELECT name FROM seed_mpp_brand_only)
GROUP BY p.id, p.name, p.status, p.credential_reference, p.encrypted_credentials
ORDER BY p.name;

CREATE TEMP VIEW seed_mpp_candidates AS
WITH primary_candidates AS (
  SELECT
    m.id                AS model_id,
    m.provider_id       AS provider_id,
    m.provider_model_id AS provider_model_id,
    1                   AS priority,
    100                 AS weight,
    true                AS is_enabled,
    NULL::integer       AS cost_input_per_1m,
    NULL::integer       AS cost_output_per_1m,
    NULL::integer       AS ttfb_timeout_ms,
    NULL::text          AS data_policy,
    m.public_model_id   AS model_public_id,
    p.name              AS provider_name,
    m.context_length    AS model_context_length,
    m.capabilities      AS model_capabilities,
    'primary'::text     AS source
  FROM models m
  JOIN providers p ON p.id = m.provider_id
  WHERE m.status IN ('active', 'deprecated')
    AND p.name NOT IN (SELECT name FROM seed_mpp_brand_only)
),
fallback_candidates AS (
  SELECT
    m.id                  AS model_id,
    m.fallback_provider_id AS provider_id,
    m.provider_model_id   AS provider_model_id,
    2                     AS priority,
    100                   AS weight,
    true                  AS is_enabled,
    NULL::integer         AS cost_input_per_1m,
    NULL::integer         AS cost_output_per_1m,
    NULL::integer         AS ttfb_timeout_ms,
    NULL::text            AS data_policy,
    m.public_model_id     AS model_public_id,
    p.name                AS provider_name,
    m.context_length      AS model_context_length,
    m.capabilities        AS model_capabilities,
    'fallback'::text      AS source
  FROM models m
  JOIN providers p ON p.id = m.fallback_provider_id
  WHERE m.status IN ('active', 'deprecated')
    AND m.fallback_provider_id IS NOT NULL
    AND m.fallback_provider_id <> m.provider_id
    AND p.name NOT IN (SELECT name FROM seed_mpp_brand_only)
)
SELECT * FROM primary_candidates
UNION ALL
SELECT * FROM fallback_candidates;

-- ----------------------------------------------------------------------------
-- 3. PREVIEW — rows that WILL be inserted (review this before continuing).
-- ----------------------------------------------------------------------------
SELECT
  model_public_id,
  source,
  priority,
  provider_name,
  provider_model_id,
  model_context_length,
  model_capabilities
FROM seed_mpp_candidates c
WHERE NOT EXISTS (
  SELECT 1 FROM model_provider_pool p
  WHERE p.model_id = c.model_id AND p.provider_id = c.provider_id
)
ORDER BY model_public_id, priority, provider_name;

-- ----------------------------------------------------------------------------
-- 4. PREVIEW — candidates already present and therefore skipped.
-- ----------------------------------------------------------------------------
SELECT
  c.model_public_id,
  c.source,
  c.priority,
  c.provider_name,
  p.id AS existing_pool_id,
  p.is_enabled AS existing_is_enabled
FROM seed_mpp_candidates c
JOIN model_provider_pool p
  ON p.model_id = c.model_id AND p.provider_id = c.provider_id
ORDER BY c.model_public_id, c.priority, c.provider_name;

-- ----------------------------------------------------------------------------
-- 5. INSERT — idempotent; never updates existing rows.
-- ----------------------------------------------------------------------------
INSERT INTO model_provider_pool (
  model_id,
  provider_id,
  provider_model_id,
  priority,
  weight,
  is_enabled,
  cost_input_per_1m,
  cost_output_per_1m,
  ttfb_timeout_ms,
  data_policy
)
SELECT
  c.model_id,
  c.provider_id,
  c.provider_model_id,
  c.priority,
  c.weight,
  c.is_enabled,
  c.cost_input_per_1m,
  c.cost_output_per_1m,
  c.ttfb_timeout_ms,
  c.data_policy
FROM seed_mpp_candidates c
WHERE NOT EXISTS (
  SELECT 1 FROM model_provider_pool p
  WHERE p.model_id = c.model_id AND p.provider_id = c.provider_id
)
ON CONFLICT (model_id, provider_id) DO NOTHING;

DROP VIEW seed_mpp_candidates;

-- ----------------------------------------------------------------------------
-- 6. VERIFY — per-model pool coverage after the seed.
--    A model with 0 enabled rows will use the legacy fallback path (plan D2)
--    until someone adds pool rows for it. That is expected for models whose
--    providers were skipped as brand-only.
-- ----------------------------------------------------------------------------
SELECT
  m.public_model_id,
  m.status,
  count(p.id) FILTER (WHERE p.is_enabled) AS enabled_pool_entries
FROM models m
LEFT JOIN model_provider_pool p ON p.model_id = m.id
WHERE m.status IN ('active', 'deprecated')
GROUP BY m.id, m.public_model_id, m.status
ORDER BY enabled_pool_entries, m.public_model_id;

COMMIT;
