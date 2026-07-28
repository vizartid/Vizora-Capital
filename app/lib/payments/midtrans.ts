type JsonObject = Record<string, unknown>;

export interface MidtransStatus extends JsonObject {
  order_id: string;
  status_code: string;
  gross_amount: string;
  transaction_status: string;
  fraud_status?: string;
  transaction_id?: string;
  payment_type?: string;
  settlement_time?: string;
}

export interface MidtransNotification extends MidtransStatus {
  signature_key: string;
}

export type DurablePaymentStatus =
  | "creating"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "refunded";

function getMidtransConfig() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) throw new Error("Midtrans server key is not configured");

  return {
    serverKey,
    isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  };
}

function basicAuthorization(serverKey: string) {
  return `Basic ${btoa(`${serverKey}:`)}`;
}

async function midtransRequest(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: basicAuthorization(getMidtransConfig().serverKey),
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  const data = await response.json().catch(() => null) as JsonObject | null;

  if (!response.ok || !data) {
    const providerMessage = typeof data?.error_messages === "object"
      ? JSON.stringify(data.error_messages)
      : typeof data?.status_message === "string"
        ? data.status_message
        : `HTTP ${response.status}`;
    throw new Error(`Midtrans request failed: ${providerMessage}`);
  }

  return data;
}

export async function createSnapTransaction(payload: JsonObject) {
  const { isProduction } = getMidtransConfig();
  const hostname = isProduction ? "https://app.midtrans.com" : "https://app.sandbox.midtrans.com";
  const data = await midtransRequest(`${hostname}/snap/v1/transactions`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (typeof data.token !== "string" || typeof data.redirect_url !== "string") {
    throw new Error("Midtrans returned an incomplete Snap transaction");
  }

  return { token: data.token, redirectUrl: data.redirect_url };
}

export async function getMidtransTransactionStatus(orderId: string): Promise<MidtransStatus> {
  const { isProduction } = getMidtransConfig();
  const hostname = isProduction ? "https://api.midtrans.com" : "https://api.sandbox.midtrans.com";
  const data = await midtransRequest(`${hostname}/v2/${encodeURIComponent(orderId)}/status`, { method: "GET" });

  for (const field of ["order_id", "status_code", "gross_amount", "transaction_status"] as const) {
    if (typeof data[field] !== "string") throw new Error(`Midtrans status is missing ${field}`);
  }

  return data as MidtransStatus;
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyMidtransNotification(notification: MidtransNotification) {
  const { serverKey } = getMidtransConfig();
  const input = `${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`;
  const digest = await crypto.subtle.digest("SHA-512", new TextEncoder().encode(input));
  return constantTimeEqual(toHex(digest), notification.signature_key.toLowerCase());
}

export function parseMidtransNotification(value: unknown): MidtransNotification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const notification = value as Record<string, unknown>;
  const required = ["order_id", "status_code", "gross_amount", "transaction_status", "signature_key"];
  if (required.some((field) => typeof notification[field] !== "string")) return null;
  return notification as MidtransNotification;
}

export function mapMidtransStatus(status: MidtransStatus): DurablePaymentStatus {
  const transactionStatus = status.transaction_status.toLowerCase();
  const fraudStatus = status.fraud_status?.toLowerCase();
  const successfulStatusCode = status.status_code === "200";

  if (transactionStatus === "settlement" && successfulStatusCode) return "paid";
  if (transactionStatus === "capture") return successfulStatusCode && fraudStatus === "accept" ? "paid" : "pending";
  if (["refund", "chargeback"].includes(transactionStatus)) return "refunded";
  if (["partial_refund", "partial_chargeback"].includes(transactionStatus)) return "paid";
  if (transactionStatus === "cancel") return "cancelled";
  if (transactionStatus === "expire") return "expired";
  if (["deny", "failure"].includes(transactionStatus)) return "failed";
  return "pending";
}

export function preserveFinalPaymentState(current: DurablePaymentStatus, next: DurablePaymentStatus) {
  if (current === "refunded") return current;
  if (current === "paid" && next !== "refunded") return current;
  return next;
}
