import { createAdminClient, createClient } from "npm:@insforge/sdk@1.4.5";
import OpenAI from "npm:openai@6.48.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Worker-Token",
};

const baseUrl = Deno.env.get("INSFORGE_BASE_URL") ?? "";
const apiKey = Deno.env.get("API_KEY") ?? "";
const defaultChatModel = "google/gemini-3.1-flash-lite";
const chatHistoryLimit = 20;

type VizoraResponse = {
  kind: "answer" | "invoice_draft" | "transaction_draft" | "reminder_draft";
  message: string;
  draft: Record<string, unknown> | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function rupiah(value: unknown) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));
}

function invoiceHtml(invoice: Record<string, unknown>, items: Record<string, unknown>[], business: Record<string, unknown>) {
  const rows = items.map((item) => `
    <tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(item.description)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${escapeHtml(item.quantity)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${rupiah(item.unit_price)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right">${rupiah(item.line_total)}</td>
    </tr>`).join("");

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:720px;margin:0 auto;padding:32px">
    <h1 style="margin-bottom:4px">${escapeHtml(business.name)}</h1>
    <p style="color:#6b7280;margin-top:0">Invoice ${escapeHtml(invoice.invoice_number)}</p>
    <p>Yth. ${escapeHtml(invoice.customer_name)},</p>
    <p>Berikut invoice Anda dengan jatuh tempo <strong>${escapeHtml(invoice.due_date)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0">
      <thead><tr><th style="text-align:left;padding:10px">Deskripsi</th><th style="text-align:right;padding:10px">Qty</th><th style="text-align:right;padding:10px">Harga</th><th style="text-align:right;padding:10px">Jumlah</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:20px;text-align:right"><strong>Total: ${rupiah(invoice.total_amount)}</strong></p>
    ${invoice.notes ? `<p>${escapeHtml(invoice.notes)}</p>` : ""}
    <p>Terima kasih.</p>
  </body></html>`;
}

function reminderHtml(invoice: Record<string, unknown>, business: Record<string, unknown>) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;padding:32px">
    <h2>Pengingat invoice ${escapeHtml(invoice.invoice_number)}</h2>
    <p>Yth. ${escapeHtml(invoice.customer_name)},</p>
    <p>Ini adalah pengingat untuk invoice dari ${escapeHtml(business.name)} dengan sisa tagihan <strong>${rupiah(invoice.outstanding_amount)}</strong> dan jatuh tempo ${escapeHtml(invoice.due_date)}.</p>
    <p>Jika pembayaran sudah dilakukan, abaikan pesan ini.</p>
  </body></html>`;
}

function largeExpenseHtml(
  transaction: Record<string, unknown>,
  business: Record<string, unknown>,
  owner: Record<string, unknown>,
) {
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;margin:0 auto;padding:32px">
    <p style="color:#b45309;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Peringatan pengeluaran besar</p>
    <h2 style="margin-bottom:8px">Pengeluaran ${rupiah(transaction.amount)} baru saja dicatat</h2>
    <p>Yth. ${escapeHtml(owner.display_name || "Pemilik bisnis")},</p>
    <p>Transaksi pengeluaran di atas Rp10.000.000 telah dibuat untuk <strong>${escapeHtml(business.name)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0;background:#fffbeb;border:1px solid #fde68a">
      <tbody>
        <tr><td style="padding:10px;color:#6b7280">Transaksi</td><td style="padding:10px;text-align:right;font-weight:700">${escapeHtml(transaction.name)}</td></tr>
        <tr><td style="padding:10px;color:#6b7280">Kategori</td><td style="padding:10px;text-align:right">${escapeHtml(transaction.category)}</td></tr>
        <tr><td style="padding:10px;color:#6b7280">Tanggal</td><td style="padding:10px;text-align:right">${escapeHtml(transaction.transaction_date)}</td></tr>
        <tr><td style="padding:10px;color:#6b7280">Jumlah</td><td style="padding:10px;text-align:right;font-size:18px;font-weight:700">${rupiah(transaction.amount)}</td></tr>
      </tbody>
    </table>
    ${transaction.notes ? `<p><strong>Catatan:</strong> ${escapeHtml(transaction.notes)}</p>` : ""}
    <p>Silakan periksa transaksi ini di ruang kerja Vizora Anda.</p>
  </body></html>`;
}

function accessToken(request: Request) {
  const header = request.headers.get("Authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function parseVizoraResponse(raw: string): VizoraResponse {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("AI gateway returned invalid JSON");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AI gateway returned an invalid response");
  }

  const response = value as Record<string, unknown>;
  const validKinds = ["answer", "invoice_draft", "transaction_draft", "reminder_draft"];
  if (!validKinds.includes(String(response.kind)) || typeof response.message !== "string" || !response.message.trim()) {
    throw new Error("AI gateway response is missing required fields");
  }

  const isAnswer = response.kind === "answer";
  const hasDraft = Boolean(response.draft && typeof response.draft === "object" && !Array.isArray(response.draft));
  if ((isAnswer && response.draft !== null) || (!isAnswer && !hasDraft)) {
    throw new Error("AI gateway response has an inconsistent action draft");
  }

  return {
    kind: response.kind as VizoraResponse["kind"],
    message: response.message.trim(),
    draft: hasDraft ? response.draft as Record<string, unknown> : null,
  };
}

async function authenticatedClients(request: Request) {
  const token = accessToken(request);
  if (!token) throw new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 });
  const userClient = createClient({ baseUrl, accessToken: token });
  const { data, error } = await userClient.auth.getCurrentUser();
  if (error || !data?.user?.id) throw new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 });
  return { userClient, user: data.user, admin: createAdminClient({ baseUrl, apiKey }) };
}

async function handleChat(request: Request, body: Record<string, unknown>) {
  const { userClient, user, admin } = await authenticatedClients(request);
  const businessId = String(body.businessId ?? "");
  const message = String(body.message ?? "").trim();
  if (!businessId || !message || message.length > 4000) return json({ error: "Invalid message" }, 400);

  const membership = await userClient.database.from("business_members")
    .select("business_id, role, status")
    .eq("business_id", businessId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membership.error || !membership.data || membership.data.status !== "active") return json({ error: "Business access denied" }, 403);

  let sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  if (sessionId) {
    const session = await userClient.database.from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("business_id", businessId)
      .maybeSingle();
    if (session.error || !session.data) return json({ error: "Chat session not found" }, 404);
  } else {
    const created = await admin.database.from("chat_sessions").insert([{
      business_id: businessId,
      user_id: user.id,
      title: message.slice(0, 80),
    }]).select("id").single();
    if (created.error || !created.data) return json({ error: created.error?.message ?? "Could not create chat session" }, 500);
    sessionId = created.data.id;
  }

  const historyResult = await userClient.database.from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .in("role", ["user", "assistant"])
    .order("created_at", { ascending: false })
    .limit(chatHistoryLimit);
  if (historyResult.error) return json({ error: historyResult.error.message }, 500);

  const historyMessages = [...(historyResult.data ?? [])].reverse().map((entry) => ({
    role: entry.role === "assistant" ? "assistant" as const : "user" as const,
    content: String(entry.content ?? ""),
  }));

  const userMessage = await admin.database.from("chat_messages").insert([{
    session_id: sessionId,
    business_id: businessId,
    user_id: user.id,
    role: "user",
    message_kind: "text",
    content: message,
  }]).select("id, created_at").single();
  if (userMessage.error) return json({ error: userMessage.error.message }, 500);

  const contextResult = await userClient.database.rpc("get_ai_finance_context", { p_business_id: businessId });
  if (contextResult.error) return json({ error: contextResult.error.message }, 500);
  const context = contextResult.data;

  const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!openRouterKey) return json({ error: "AI gateway is not configured" }, 503);
  const openai = new OpenAI({ baseURL: "https://openrouter.ai/api/v1", apiKey: openRouterKey });
  const completion = await openai.chat.completions.create({
    model: Deno.env.get("OPENROUTER_CHAT_MODEL") ?? defaultChatModel,
    temperature: 0.1,
    max_tokens: 900,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "Vizora_response",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "message", "draft"],
          properties: {
            kind: { type: "string", enum: ["answer", "invoice_draft", "transaction_draft", "reminder_draft"] },
            message: { type: "string" },
            draft: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  required: ["customer_id", "due_date", "notes", "items"],
                  properties: {
                    customer_id: { type: "string" }, due_date: { type: "string" }, notes: { type: ["string", "null"] },
                    items: {
                      type: "array",
                      minItems: 1,
                      items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["item_id", "description", "quantity", "unit_price", "discount_rate", "tax_rate"],
                        properties: {
                          item_id: { type: ["string", "null"] },
                          description: { type: "string" },
                          quantity: { type: "number" },
                          unit_price: { type: "number" },
                          discount_rate: { type: "number" },
                          tax_rate: { type: "number" },
                        },
                      },
                    },
                  },
                },
                {
                  type: "object", additionalProperties: false,
                  required: ["type", "name", "category", "amount", "transaction_date", "invoice_id", "notes"],
                  properties: { type: { type: "string", enum: ["income", "expense"] }, name: { type: "string" }, category: { type: "string" }, amount: { type: "number" }, transaction_date: { type: "string" }, invoice_id: { type: ["string", "null"] }, notes: { type: ["string", "null"] } },
                },
                {
                  type: "object", additionalProperties: false, required: ["invoice_ids"],
                  properties: { invoice_ids: { type: "array", items: { type: "string" } } },
                },
              ],
            },
          },
        },
      },
    },
    messages: [
      {
        role: "system",
        content: `Anda adalah Vizora, asisten keuangan berbahasa Indonesia. Gunakan HANYA data JSON bisnis yang diberikan. Jangan mengarang pelanggan, item, invoice, jumlah, atau status. Pertanyaan baca-saja menghasilkan kind=answer dan draft=null. Permintaan yang mengubah data harus menghasilkan draft untuk ditinjau manusia; jangan pernah mengklaim data sudah diubah. Gunakan customer_id/item_id persis dari konteks. Untuk nilai rupiah, gunakan angka tanpa pemisah. Hari ini ${new Date().toISOString().slice(0, 10)}.`,
      },
      { role: "system", content: `DATA BISNIS:\n${JSON.stringify(context)}` },
      ...historyMessages,
      { role: "user", content: message },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = parseVizoraResponse(raw);
  let actionDraft: Record<string, unknown> | null = null;
  const actionType = parsed.kind === "invoice_draft" ? "create_invoice" : parsed.kind === "transaction_draft" ? "create_transaction" : parsed.kind === "reminder_draft" ? "send_reminders" : null;

  if (actionType && parsed.draft) {
    const inserted = await admin.database.from("action_drafts").insert([{
      business_id: businessId,
      session_id: sessionId,
      requested_by: user.id,
      action_type: actionType,
      payload: parsed.draft,
      preview: parsed.draft,
    }]).select("id, action_type, status, preview, expires_at").single();
    if (inserted.error) return json({ error: inserted.error.message }, 500);
    actionDraft = inserted.data;
  }

  const assistantMessage = await admin.database.from("chat_messages").insert([{
    session_id: sessionId,
    business_id: businessId,
    user_id: user.id,
    role: "assistant",
    message_kind: actionDraft ? "action_draft" : "data_answer",
    content: parsed.message,
    action_draft_id: actionDraft?.id ?? null,
    model: completion.model,
    prompt_tokens: completion.usage?.prompt_tokens ?? null,
    completion_tokens: completion.usage?.completion_tokens ?? null,
  }]).select("id, role, message_kind, content, action_draft_id, created_at").single();
  if (assistantMessage.error) return json({ error: assistantMessage.error.message }, 500);

  if (actionDraft) {
    await admin.database.from("audit_logs").insert([{
      business_id: businessId, actor_type: "ai", actor_user_id: null, action: "create",
      entity_type: "action_drafts", entity_id: actionDraft.id,
      summary: "Vizora AI prepared an action for human approval",
      metadata: { action_type: actionType },
    }]);
  }

  return json({ sessionId, userMessage: userMessage.data, assistantMessage: assistantMessage.data, actionDraft });
}

async function loadInvoice(client: ReturnType<typeof createClient> | ReturnType<typeof createAdminClient>, invoiceId: string) {
  const invoice = await client.database.from("invoice_overview").select("*").eq("id", invoiceId).single();
  if (invoice.error || !invoice.data) throw new Error(invoice.error?.message ?? "Invoice not found");
  const items = await client.database.from("invoice_items").select("description, quantity, unit_price, line_total").eq("invoice_id", invoiceId).order("sort_order");
  const business = await client.database.from("businesses").select("id, name, email").eq("id", invoice.data.business_id).single();
  if (items.error || business.error || !business.data) throw new Error(items.error?.message ?? business.error?.message ?? "Invoice data unavailable");
  return { invoice: invoice.data, items: items.data ?? [], business: business.data };
}

async function handleSendInvoice(request: Request, body: Record<string, unknown>) {
  const { userClient } = await authenticatedClients(request);
  const invoiceId = String(body.invoiceId ?? "");
  const { invoice, items, business } = await loadInvoice(userClient, invoiceId);
  if (invoice.status !== "approved") return json({ error: "Invoice must be approved before sending" }, 409);
  if (!invoice.customer_email) return json({ error: "Customer has no billing email" }, 422);

  const sent = await userClient.emails.send({
    to: invoice.customer_email,
    subject: `${invoice.invoice_number} dari ${business.name}`,
    html: invoiceHtml(invoice, items, business),
    from: business.name,
    replyTo: business.email ?? undefined,
  });
  if (sent.error) {
    const planLimited = sent.error.message.includes("only available for paid plans");
    return json({ error: sent.error.message, code: planLimited ? "PAID_PLAN_REQUIRED" : "EMAIL_FAILED" }, planLimited ? 402 : 502);
  }

  const marked = await userClient.database.rpc("mark_invoice_sent", {
    p_invoice_id: invoiceId,
    p_provider_message_id: sent.data?.id ?? null,
  });
  if (marked.error) return json({ error: marked.error.message }, 500);
  return json({ invoice: marked.data, emailId: sent.data?.id ?? null, skipped: sent.data?.skipped ?? [] });
}

async function handleReminders(request: Request) {
  const expected = Deno.env.get("REMINDER_WORKER_TOKEN");
  if (!expected || request.headers.get("X-Worker-Token") !== expected) return json({ error: "Unauthorized worker" }, 401);
  const admin = createAdminClient({ baseUrl, apiKey });
  const reminders = await admin.database.from("invoice_reminders").select("*").eq("status", "pending").lte("scheduled_for", new Date().toISOString()).limit(25);
  if (reminders.error) return json({ error: reminders.error.message }, 500);

  const results: Record<string, unknown>[] = [];
  for (const reminder of reminders.data ?? []) {
    try {
      const { invoice, business } = await loadInvoice(admin, reminder.invoice_id);
      if (invoice.status !== "sent" || Number(invoice.outstanding_amount) <= 0 || !invoice.customer_email) {
        await admin.database.from("invoice_reminders").update({ status: "skipped", error_message: "Invoice is not eligible" }).eq("id", reminder.id);
        results.push({ id: reminder.id, status: "skipped" });
        continue;
      }
      const sent = await admin.emails.send({
        to: invoice.customer_email,
        subject: `Pengingat ${invoice.invoice_number}`,
        html: reminderHtml(invoice, business),
        from: business.name,
        replyTo: business.email ?? undefined,
      });
      if (sent.error) {
        if (sent.error.message.includes("only available for paid plans")) return json({ error: sent.error.message, code: "PAID_PLAN_REQUIRED" }, 402);
        await admin.database.from("invoice_reminders").update({ status: "failed", error_message: sent.error.message }).eq("id", reminder.id);
        results.push({ id: reminder.id, status: "failed" });
        continue;
      }
      await admin.database.from("invoice_reminders").update({ status: "sent", sent_at: new Date().toISOString(), provider_message_id: sent.data?.id ?? null }).eq("id", reminder.id);
      results.push({ id: reminder.id, status: "sent" });
    } catch (error) {
      await admin.database.from("invoice_reminders").update({ status: "failed", error_message: error instanceof Error ? error.message : "Unknown error" }).eq("id", reminder.id);
      results.push({ id: reminder.id, status: "failed" });
    }
  }
  return json({ processed: results.length, results });
}

async function handleLargeExpenseNotifications(request: Request) {
  const expected = Deno.env.get("REMINDER_WORKER_TOKEN");
  if (!expected || request.headers.get("X-Worker-Token") !== expected) return json({ error: "Unauthorized worker" }, 401);

  const admin = createAdminClient({ baseUrl, apiKey });
  const claimed = await admin.database.rpc("claim_large_expense_notifications", { p_limit: 25 });
  if (claimed.error) return json({ error: claimed.error.message }, 500);

  const notifications = Array.isArray(claimed.data) ? claimed.data as Record<string, unknown>[] : [];
  const results: Record<string, unknown>[] = [];

  for (const notification of notifications) {
    const notificationId = String(notification.id ?? "");
    const transactionId = String(notification.transaction_id ?? "");
    const attempts = Number(notification.attempts ?? 1);

    try {
      const transactionResult = await admin.database.from("transactions")
        .select("id, business_id, type, name, category, amount, transaction_date, notes, created_at")
        .eq("id", transactionId)
        .single();
      if (transactionResult.error || !transactionResult.data) throw new Error(transactionResult.error?.message ?? "Transaction not found");

      const transaction = transactionResult.data as Record<string, unknown>;
      if (transaction.type !== "expense" || Number(transaction.amount) <= 10_000_000) {
        await admin.database.from("large_expense_notifications").update({
          status: "failed",
          last_error: "Transaction is not an expense above Rp10,000,000",
          processing_started_at: null,
        }).eq("id", notificationId);
        results.push({ id: notificationId, status: "failed" });
        continue;
      }

      const businessResult = await admin.database.from("businesses")
        .select("id, name, email, created_by")
        .eq("id", transaction.business_id)
        .single();
      if (businessResult.error || !businessResult.data) throw new Error(businessResult.error?.message ?? "Business not found");

      const business = businessResult.data as Record<string, unknown>;
      const ownerResult = await admin.database.from("business_members")
        .select("email, display_name")
        .eq("business_id", business.id)
        .eq("user_id", business.created_by)
        .maybeSingle();
      if (ownerResult.error || !ownerResult.data?.email) {
        await admin.database.from("large_expense_notifications").update({
          status: "failed",
          last_error: ownerResult.error?.message ?? "Business owner has no notification email",
          processing_started_at: null,
        }).eq("id", notificationId);
        results.push({ id: notificationId, status: "failed" });
        continue;
      }

      const owner = ownerResult.data as Record<string, unknown>;
      const sent = await admin.emails.send({
        to: String(owner.email),
        subject: `Peringatan pengeluaran besar: ${rupiah(transaction.amount)}`,
        html: largeExpenseHtml(transaction, business, owner),
        from: String(business.name),
        replyTo: business.email ? String(business.email) : undefined,
      });
      if (sent.error) throw sent.error;

      const skipped = sent.data?.skipped?.includes(String(owner.email)) ?? false;
      const status = skipped ? "skipped" : "sent";
      const completed = await admin.database.from("large_expense_notifications").update({
        status,
        sent_at: skipped ? null : new Date().toISOString(),
        provider_message_id: sent.data?.id ?? null,
        last_error: skipped ? "Business owner unsubscribed from email notifications" : null,
        processing_started_at: null,
      }).eq("id", notificationId);
      if (completed.error) throw completed.error;

      await admin.database.from("audit_logs").insert([{
        business_id: transaction.business_id,
        actor_type: "system",
        actor_user_id: null,
        action: status,
        entity_type: "large_expense_notification",
        entity_id: transaction.id,
        summary: skipped ? "Large expense notification skipped for unsubscribed owner" : "Large expense notification sent to business owner",
        metadata: { notification_id: notificationId, amount: transaction.amount, provider_message_id: sent.data?.id ?? null },
      }]);
      results.push({ id: notificationId, status });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown notification error";
      const terminal = attempts >= 5 || message.includes("only available for paid plans");
      const retryMinutes = Math.min(60, 2 ** Math.max(1, attempts));
      await admin.database.from("large_expense_notifications").update({
        status: terminal ? "failed" : "pending",
        last_error: message,
        processing_started_at: null,
        next_attempt_at: terminal ? new Date().toISOString() : new Date(Date.now() + retryMinutes * 60_000).toISOString(),
      }).eq("id", notificationId);
      results.push({ id: notificationId, status: terminal ? "failed" : "retrying" });
    }
  }

  return json({ processed: results.length, results });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!baseUrl || !apiKey) return json({ error: "Function environment is incomplete" }, 503);

  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "chat") return await handleChat(request, body);
    if (body.action === "send_invoice") return await handleSendInvoice(request, body);
    if (body.action === "process_reminders") return await handleReminders(request);
    if (body.action === "process_large_expense_notifications") return await handleLargeExpenseNotifications(request);
    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    if (error instanceof Response) {
      return new Response(error.body, { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected function error" }, 500);
  }
}
