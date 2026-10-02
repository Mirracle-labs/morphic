import { createHash, timingSafeEqual } from 'node:crypto';

// ── Config ────────────────────────────────────────────

function getMerchantCode(): string {
  const code = process.env.DUITKU_MERCHANT_CODE;
  if (!code) throw new Error('DUITKU_MERCHANT_CODE is not set');
  return code;
}

function getApiKey(): string {
  const key = process.env.DUITKU_API_KEY;
  if (!key) throw new Error('DUITKU_API_KEY is not set');
  return key;
}

export function assertDuitkuConfig() {
  const env = process.env.DUITKU_ENV ?? 'sandbox';
  const prod = process.env.NODE_ENV === 'production';
  if (prod && env !== 'production') {
    throw new Error('DUITKU_ENV must be set to "production" when NODE_ENV=production');
  }
  if (!prod && env === 'production') {
    throw new Error('DUITKU_ENV=production is not allowed outside production environment');
  }
  console.log(`[duitku] environment: ${env}`);
}

function baseUrl(): string {
  const env = process.env.DUITKU_ENV ?? 'sandbox';
  if (process.env.NODE_ENV === 'production' && env !== 'production') {
    throw new Error('DUITKU_ENV must be set to "production" when NODE_ENV=production');
  }

  return env === 'production'
    ? 'https://passport.duitku.com/webapi'
    : 'https://sandbox.duitku.com/webapi';
}

function md5(data: string): string {
  return createHash('md5').update(data).digest('hex');
}

// ── Create Transaction ────────────────────────────────

export interface CreateTransactionParams {
  merchantOrderId: string;   // unique ID from our side
  paymentAmount: number;     // integer IDR, no decimals
  productDetails: string;    // e.g. "Morphic Credits - Paket Hemat"
  email: string;             // customer email
  customerVaName: string;    // name shown on bank confirmation
  callbackUrl: string;       // webhook URL (must be public HTTPS)
  returnUrl: string;         // redirect after payment
  expiryPeriod?: number;     // minutes, default 60
  paymentMethod?: string;    // payment method code e.g. 'SP' (ShopeePay QRIS), default 'SP'
}

export interface CreateTransactionResult {
  paymentUrl: string;
  reference: string;
  statusCode: string;
  statusMessage: string;
  qrString?: string;
}

/**
 * Create a Duitku transaction.
 * Signature: MD5(merchantCode + merchantOrderId + paymentAmount + apiKey)
 * Docs: https://docs.duitku.com/api/id/#create-invoice
 */
export async function createTransaction(
  params: CreateTransactionParams,
): Promise<CreateTransactionResult> {
  const merchantCode = getMerchantCode();
  const apiKey = getApiKey();

  const stringToSign = `${merchantCode}${params.merchantOrderId}${params.paymentAmount}${apiKey}`;
  const signature = md5(stringToSign);

  const body: Record<string, unknown> = {
    merchantCode,
    paymentAmount: params.paymentAmount,
    merchantOrderId: params.merchantOrderId,
    productDetails: params.productDetails,
    email: params.email,
    customerVaName: params.customerVaName,
    callbackUrl: params.callbackUrl,
    returnUrl: params.returnUrl,
    signature,
    expiryPeriod: params.expiryPeriod ?? 60,
    paymentMethod: params.paymentMethod ?? 'SP',
  };

  const url = `${baseUrl()}/api/merchant/v2/inquiry`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Duitku createTransaction HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    paymentUrl?: string;
    reference?: string;
    statusCode?: string;
    statusMessage?: string;
    qrString?: string;
    Message?: string;
  };

  if (data.statusCode !== '00') {
    throw new Error(`Duitku createTransaction failed: ${data.statusMessage ?? data.Message ?? 'unknown error'}`);
  }

  return {
    paymentUrl: data.paymentUrl!,
    reference: data.reference!,
    statusCode: data.statusCode!,
    statusMessage: data.statusMessage!,
    qrString: data.qrString,
  };
}

// ── Check Transaction Status ──────────────────────────

export interface TransactionStatus {
  merchantOrderId: string;
  reference: string;
  amount: string;
  statusCode: string;   // '00' success, '01' pending, '02' cancelled
  statusMessage: string;
}

/**
 * Check Duitku transaction status.
 * Signature: MD5(merchantCode + merchantOrderId + apiKey)
 * Docs: https://docs.duitku.com/api/id/#check-transaction
 */
export async function checkTransactionStatus(
  merchantOrderId: string,
): Promise<TransactionStatus> {
  const merchantCode = getMerchantCode();
  const apiKey = getApiKey();

  const stringToSign = `${merchantCode}${merchantOrderId}${apiKey}`;
  const signature = md5(stringToSign);

  const params = { merchantCode, merchantOrderId, signature };

  const url = `${baseUrl()}/api/merchant/transactionStatus`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Duitku checkTransaction HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as TransactionStatus & { Message?: string };
  if (typeof data.statusCode !== 'string' || data.merchantOrderId !== merchantOrderId) {
    throw new Error(`Duitku checkTransaction unexpected response: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// ── Verify Inbound Callback Signature ────────────────

export interface DuitkuCallbackPayload {
  merchantCode: string;
  amount: string;
  merchantOrderId: string;
  productDetail: string;
  additionalParam?: string;
  paymentCode: string;
  resultCode: string;      // '00' success, '01' failed
  merchantUserId?: string;
  reference: string;
  publisherOrderId?: string;
  signature: string;
  spUserHash?: string;
  settlementDate?: string;
  issuerCode?: string;
  customerName?: string;
}


/**
 * Verify Duitku callback signature (inbound webhook).
 * Formula: MD5(merchantCode + amount + merchantOrderId + apiKey) — hex lowercase
 * Docs: https://docs.duitku.com/api/id/#callback
 */
export function verifyCallbackSignature(payload: DuitkuCallbackPayload): boolean {
  const apiKey = getApiKey();
  const stringToSign = `${payload.merchantCode}${payload.amount}${payload.merchantOrderId}${apiKey}`;
  const expected = md5(stringToSign);

  try {
    const a = Buffer.from(expected.toLowerCase());
    const b = Buffer.from((payload.signature ?? '').toLowerCase());
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
