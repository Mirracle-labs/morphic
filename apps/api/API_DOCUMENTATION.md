# Morphic AI Gateway - API Reference

Welcome to the Morphic AI Gateway API documentation. Our API is designed to be fully compatible with the OpenAI specification for inference, while providing robust endpoints for account and key management.

## Base URL
All API requests should be prefixed with the following base URL:
```text
http://localhost:8787
```
*(In production, replace with your actual API domain, e.g., `https://api.yourdomain.com`)*

---

## Authentication

Morphic AI Gateway uses two distinct authentication mechanisms depending on the endpoint you are accessing.

### 1. API Key Authentication (Inference)
Used for all AI model interaction endpoints (e.g., `/v1/chat/completions`). API keys start with the `mp-` prefix.
Pass the API key in the `Authorization` header as a Bearer token.

```http
Authorization: Bearer mp-your-api-key
```

### 2. Session Authentication (Management)
Used for account, usage, and API key management endpoints. Session tokens are typically provided via your frontend's authentication system (Better Auth).
Pass the session token via the `Authorization` header OR via Cookies.

```http
Authorization: Bearer your-session-token
# OR
Cookie: better-auth.session_token=your-session-token
```

---

## Error Handling

All API errors follow a consistent JSON structure.

```json
{
  "error": {
    "message": "Human readable error description",
    "type": "invalid_request_error | auth_error | rate_limit_error | server_error | insufficient_credits",
    "code": "specific_error_code",
    "details": [] // Optional field for validation errors
  }
}
```

### HTTP Status Codes
* **200/201**: Success
* **400**: Bad Request (e.g., Invalid JSON, missing parameters)
* **401**: Unauthorized (Missing, expired, or invalid credentials)
* **402**: Payment Required (Insufficient credits)
* **429**: Too Many Requests (Rate limit or concurrency limit exceeded)
* **502/503/504**: Gateway Errors (Upstream provider issues)

---

## 1. Inference API (OpenAI Compatible)

These endpoints require **API Key Authentication**.

### Create Chat Completion
Creates a model response for the given chat conversation.

* **URL**: `/v1/chat/completions`
* **Method**: `POST`
* **Auth**: API Key

**Request Body**
```json
{
  "model": "MiniMaxAI/MiniMax-M2.7",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": false,
  "max_tokens": 1000,
  "temperature": 0.7
}
```

**Response (Non-Streaming)**
Returns a standard OpenAI chat completion response object.

**Special Headers**
If the model requested is deprecated and redirected to a newer model, the API will include an `X-Morphic-Warning` header in the response.

---

### List Models
Lists the currently available models, and provides basic information about each one.

* **URL**: `/v1/models`
* **Method**: `GET`
* **Auth**: API Key

**Response**
```json
{
  "object": "list",
  "data": [
    {
      "id": "MiniMaxAI/MiniMax-M2.7",
      "object": "model",
      "created": 0,
      "owned_by": "morphic",
      "display_name": "MiniMax M2.7",
      "context_length": 32768,
      "capabilities": [],
      "status": "active",
      "replacement_model_alias": null
    }
  ]
}
```

### Retrieve Model
Retrieves a model instance, providing basic information about the model.

* **URL**: `/v1/models/:id`
* **Method**: `GET`
* **Auth**: API Key

---

## 2. API Key Management

These endpoints require **Session Authentication**.

### Create API Key
Generate a new API key for inference.

* **URL**: `/v1/keys`
* **Method**: `POST`
* **Auth**: Session Token

**Request Body**
| Field | Type | Description |
|---|---|---|
| `name` | `string` | **Required.** A descriptive name for the key. |
| `expiresIn` | `string` | **Optional.** Expiration format: `"30d"`, `"90d"`, `"none"`, or ISO-8601 Date String. Default is `"none"`. |

**Response (201 Created)**
*⚠️ Note: This is the ONLY time the full raw `key` is returned.*
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Production Key",
  "prefix": "mp-a1b2c3d4",
  "key": "mp-a1b2c3d4e5f6...",
  "status": "active",
  "expires_at": "2026-10-10T00:00:00.000Z",
  "created_at": "2026-09-10T00:00:00.000Z"
}
```

### List API Keys
Retrieve a list of all API keys owned by the user.

* **URL**: `/v1/keys`
* **Method**: `GET`
* **Auth**: Session Token

**Response**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Production Key",
      "prefix": "mp-a1b2c3d4",
      "status": "active",
      "expires_at": null,
      "last_used_at": "2026-09-09T12:00:00.000Z",
      "created_at": "2026-09-01T00:00:00.000Z",
      "revoked_at": null
    }
  ]
}
```

### Revoke API Key
Instantly revokes an API key.

* **URL**: `/v1/keys/:id`
* **Method**: `DELETE`
* **Auth**: Session Token

**Response**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "revoked",
  "revoked_at": "2026-09-10T00:00:00.000Z"
}
```

---

## 3. Account & Billing

These endpoints require **Session Authentication**.

### Get Balance
Retrieve the current credit balance of the user.

* **URL**: `/v1/account/balance`
* **Method**: `GET`
* **Auth**: Session Token

**Response**
```json
{
  "credits": 150000,
  "updated_at": "2026-09-10T05:00:00.000Z"
}
```

### Get Usage History
Retrieve paginated inference usage records (requests, latency, tokens consumed).

* **URL**: `/v1/account/usage`
* **Method**: `GET`
* **Auth**: Session Token

**Query Parameters**
| Parameter | Type | Description |
|---|---|---|
| `page` | `number` | Page number (default: 1) |
| `limit` | `number` | Items per page (default: 20, max: 100) |
| `from` | `string` | ISO Date string to filter records from |
| `to` | `string` | ISO Date string to filter records until |

**Response**
```json
{
  "data": [
    {
      "id": "req-12345",
      "request_id": "c8a4...",
      "model": "MiniMaxAI/MiniMax-M2.7",
      "prompt_tokens": 12,
      "completion_tokens": 105,
      "total_tokens": 117,
      "credits_consumed": 2220,
      "latency_ms": 1400,
      "status": "success",
      "streamed": true,
      "created_at": "2026-09-10T06:00:00.000Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 20
}
```

### Get Transaction Ledger
Retrieve paginated ledger history (purchases, top-ups, settlements).

* **URL**: `/v1/account/transactions`
* **Method**: `GET`
* **Auth**: Session Token

**Query Parameters**
| Parameter | Type | Description |
|---|---|---|
| `page` | `number` | Page number (default: 1) |
| `limit` | `number` | Items per page (default: 20, max: 100) |

**Response**
```json
{
  "data": [
    {
      "id": "txn-999",
      "entry_type": "settlement",
      "amount": -2220,
      "source_type": "balance",
      "reference": "req-12345",
      "created_at": "2026-09-10T06:00:05.000Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 20
}
```

---

## 4. System / Health

### Health Check
Check if the API gateway is running.

* **URL**: `/health`
* **Method**: `GET`
* **Auth**: None

**Response**
```json
{
  "ok": true
}
```
