// ── PayPal REST API Client ─────────────────────────────

function getClientId(): string {
  const id = process.env.PAYPAL_CLIENT_ID;
  if (!id) throw new Error('PAYPAL_CLIENT_ID is not set');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!secret) throw new Error('PAYPAL_CLIENT_SECRET is not set');
  return secret;
}

function getBaseUrl(): string {
  const env = process.env.PAYPAL_ENVIRONMENT ?? 'sandbox';
  return env === 'live' || env === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

// ── OAuth Token Cache ─────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getAccessToken(): Promise<string> {
  const now = Date.now();
  // Buffer 60s before actual expiry
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(`${getBaseUrl()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${authHeader}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PayPal OAuth HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ── Interfaces ────────────────────────────────────────

export interface PayPalOrderResult {
  orderId: string;
  approveUrl: string;
}

export interface PayPalParsedOrder {
  orderId: string;
  orderStatus: string;      // CREATED, SAVED, APPROVED, VOIDED, COMPLETED, PAYER_ACTION_REQUIRED
  captureStatus?: string;   // COMPLETED, PENDING, DECLINED, FAILED, REFUNDED
  captureId?: string;
  amount?: string;
  currency?: string;
  effectiveStatus: 'paid' | 'pending_paypal' | 'failed' | 'expired' | 'pending';
}

export class PayPalApiError extends Error {
  public status: number;
  public details?: Array<{ issue: string; description: string }>;

  constructor(message: string, status: number, details?: Array<{ issue: string; description: string }>) {
    super(message);
    this.name = 'PayPalApiError';
    this.status = status;
    this.details = details;
  }
}

// ── Status Interpreter ───────────────────────────────

/**
 * Interpret raw PayPal Order / Capture API responses.
 * Evaluates underlying capture status (COMPLETED, PENDING, DECLINED, FAILED)
 * rather than relying solely on top-level order status.
 */
export function interpretOrder(raw: {
  id?: string;
  status: string;
  purchase_units?: Array<{
    amount?: { currency_code?: string; value?: string };
    payments?: {
      captures?: Array<{
        id?: string;
        status?: string;
        amount?: { currency_code?: string; value?: string };
      }>;
    };
  }>;
}): PayPalParsedOrder {
  const orderId = raw.id ?? '';
  const orderStatus = raw.status ?? '';
  const firstUnit = raw.purchase_units?.[0];
  const firstCapture = firstUnit?.payments?.captures?.[0];

  const captureStatus = firstCapture?.status;
  const captureId = firstCapture?.id;
  const amount = firstCapture?.amount?.value;
  const currency = firstCapture?.amount?.currency_code;

  let effectiveStatus: 'paid' | 'pending_paypal' | 'failed' | 'expired' | 'pending' = 'pending';

  // Evaluate capture status first if captures exist
  if (captureStatus) {
    if (captureStatus === 'COMPLETED') {
      effectiveStatus = 'paid';
    } else if (captureStatus === 'PENDING') {
      effectiveStatus = 'pending_paypal';
    } else if (['DECLINED', 'FAILED', 'REFUNDED'].includes(captureStatus)) {
      effectiveStatus = 'failed';
    }
  } else if (orderStatus === 'COMPLETED') {
    // Without capture details, do NOT consider paid
    effectiveStatus = 'pending';
  } else if (orderStatus === 'VOIDED') {
    effectiveStatus = 'expired';
  } else if (orderStatus === 'PENDING') {
    effectiveStatus = 'pending_paypal';
  } else {
    // CREATED, SAVED, APPROVED, PAYER_ACTION_REQUIRED
    effectiveStatus = 'pending';
  }

  return {
    orderId,
    orderStatus,
    captureStatus,
    captureId,
    amount,
    currency,
    effectiveStatus,
  };
}

/**
 * Verify that amount and currency from parsed PayPal order response match expected amountCents and currency.
 */
export function capturedAmountMatches(
  o: PayPalParsedOrder,
  expected: { amountCents: number; currency: string },
): boolean {
  if (!o.amount || !o.currency) return false;
  return Math.round(Number(o.amount) * 100) === expected.amountCents && o.currency === expected.currency;
}

// ── API Functions ─────────────────────────────────────

/**
 * Create a PayPal checkout order.
 * Uses `PayPal-Request-Id` for PayPal side idempotency.
 */
export async function createOrder(params: {
  amount: string;
  currency: string;
  paymentId: string;
  idempotencyKey: string;
}): Promise<PayPalOrderResult> {
  const token = await getAccessToken();

  const res = await fetch(`${getBaseUrl()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': params.idempotencyKey,
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          custom_id: params.paymentId,
          amount: {
            currency_code: params.currency,
            value: params.amount,
          },
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      name?: string;
      message?: string;
      details?: Array<{ issue: string; description: string }>;
    };
    throw new PayPalApiError(
      errorData.message ?? `PayPal createOrder HTTP ${res.status}`,
      res.status,
      errorData.details,
    );
  }

  const data = (await res.json()) as {
    id: string;
    links?: Array<{ href: string; rel: string }>;
  };

  const approveLink =
    data.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? '';

  return {
    orderId: data.id,
    approveUrl: approveLink,
  };
}

/**
 * Capture payment for an approved order.
 * Returns parsed order status details including underlying capture status.
 */
export async function captureOrder(orderId: string): Promise<PayPalParsedOrder> {
  const token = await getAccessToken();

  const res = await fetch(`${getBaseUrl()}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      name?: string;
      message?: string;
      details?: Array<{ issue: string; description: string }>;
    };
    throw new PayPalApiError(
      errorData.message ?? `PayPal captureOrder HTTP ${res.status}`,
      res.status,
      errorData.details,
    );
  }

  const data = await res.json();
  return interpretOrder({ id: orderId, ...data });
}

/**
 * Retrieve order details for verification or reconciliation.
 * Returns parsed order status details including underlying capture status.
 */
export async function getOrder(orderId: string): Promise<PayPalParsedOrder> {
  const token = await getAccessToken();

  const res = await fetch(`${getBaseUrl()}/v2/checkout/orders/${orderId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errorData = (await res.json().catch(() => ({}))) as {
      name?: string;
      message?: string;
      details?: Array<{ issue: string; description: string }>;
    };
    throw new PayPalApiError(
      errorData.message ?? `PayPal getOrder HTTP ${res.status}`,
      res.status,
      errorData.details,
    );
  }

  const data = await res.json();
  return interpretOrder({ id: orderId, ...data });
}

/**
 * Detect if an error from PayPal capture API indicates that the order was already captured.
 */
export function isAlreadyCapturedError(err: unknown): boolean {
  if (err instanceof PayPalApiError) {
    if (err.status === 422) {
      if (err.details?.some((d) => d.issue === 'ORDER_ALREADY_CAPTURED')) {
        return true;
      }
      if (err.message.includes('ORDER_ALREADY_CAPTURED')) {
        return true;
      }
    }
  }
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    if ((err as { message: string }).message.includes('ORDER_ALREADY_CAPTURED')) {
      return true;
    }
  }
  return false;
}
