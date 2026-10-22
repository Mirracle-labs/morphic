/**
 * Pooling Phase 1E: Appendix B is the single source of truth for failure
 * classification. This file pins every row of the table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUpstreamError, type UpstreamErrorInput } from './router.js';

interface Row {
  input: UpstreamErrorInput;
  failover: boolean;
  countAsFailure: boolean;
  alert: boolean;
  httpStatus: number;
  code: string;
}

const rows: Row[] = [
  { input: 'client_abort', failover: false, countAsFailure: false, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 'timeout', failover: false, countAsFailure: false, alert: false, httpStatus: 504, code: 'provider_timeout' },
  { input: 'ttfb_timeout', failover: true, countAsFailure: true, alert: false, httpStatus: 504, code: 'provider_timeout' },
  { input: 'network', failover: true, countAsFailure: true, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 500, failover: true, countAsFailure: true, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 503, failover: true, countAsFailure: true, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 429, failover: true, countAsFailure: true, alert: false, httpStatus: 429, code: 'provider_rate_limited' },
  { input: 401, failover: true, countAsFailure: true, alert: true, httpStatus: 503, code: 'provider_auth_failed' },
  { input: 403, failover: true, countAsFailure: true, alert: true, httpStatus: 503, code: 'provider_auth_failed' },
  { input: 402, failover: true, countAsFailure: true, alert: true, httpStatus: 503, code: 'provider_auth_failed' },
  { input: 404, failover: true, countAsFailure: true, alert: true, httpStatus: 502, code: 'provider_error' },
  { input: 408, failover: true, countAsFailure: true, alert: false, httpStatus: 504, code: 'provider_timeout' },
  { input: 400, failover: false, countAsFailure: false, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 422, failover: false, countAsFailure: false, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 418, failover: false, countAsFailure: false, alert: false, httpStatus: 502, code: 'provider_error' },
  { input: 'invalid_body', failover: true, countAsFailure: true, alert: false, httpStatus: 502, code: 'provider_error' },
];

for (const row of rows) {
  test(`1E Appendix B: ${String(row.input)} => failover=${row.failover} count=${row.countAsFailure} alert=${row.alert}`, () => {
    const norm = normalizeUpstreamError(row.input);
    assert.equal(norm.failover, row.failover);
    assert.equal(norm.countAsFailure, row.countAsFailure);
    assert.equal(norm.alert, row.alert);
    assert.equal(norm.httpStatus, row.httpStatus);
    assert.equal(norm.code, row.code);
    assert.equal(norm.type, row.code === 'provider_rate_limited' ? 'rate_limit_error' : 'server_error');
  });
}
