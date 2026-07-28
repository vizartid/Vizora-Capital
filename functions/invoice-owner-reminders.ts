import { createAdminClient } from "npm:@insforge/sdk@1.4.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Worker-Token",
};

const baseUrl = Deno.env.get("INSFORGE_BASE_URL") ?? "";
const apiKey = Deno.env.get("API_KEY") ?? "";
const reminderTimeZone = "Asia/Jakarta";
const invoicePageSize = 500;

type InvoiceRow = {
  id: string;
  business_id: string;
  invoice_number: string;
  status: "approved" | "sent";
  due_date: string;
  total_amount: number | string;
  amount_paid: number | string;
  outstanding_amount: number | string;
  customer_name: string;
};

type BusinessRow = {
  id: string;
  name: string;
  currency: string;
  email: string | null;
  invoice_language: "id" | "en";
  created_by: string;
};

type BusinessMemberRow = {
  business_id: string;
  user_id: string;
  email: string;
  display_name: string;
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

function dateInTimeZone(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(isoDate: string, language: "id" | "en") {
  return new Intl.DateTimeFormat(language === "id" ? "id-ID" : "en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${isoDate}T00:00:00.000Z`));
}

function formatMoney(value: number, currency: string, language: "id" | "en") {
  try {
    return new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "IDR" ? 0 : 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(language === "id" ? "id-ID" : "en-US")}`;
  }
}

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, 1)}***@${domain}`;
}

function digestHtml(
  business: BusinessRow,
  owner: BusinessMemberRow,
  invoices: InvoiceRow[],
  today: string,
) {
  const language = business.invoice_language === "en" ? "en" : "id";
  const overdue = invoices.filter((invoice) => invoice.due_date < today);
  const dueSoon = invoices.length - overdue.length;
  const totalOutstanding = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.outstanding_amount),
    0,
  );
  const rows = invoices.map((invoice) => {
    const timing = invoice.due_date < today
      ? (language === "id" ? "Terlambat" : "Overdue")
      : invoice.due_date === today
      ? (language === "id" ? "Jatuh tempo hari ini" : "Due today")
      : (language === "id" ? "Segera jatuh tempo" : "Due soon");
    const workflowStatus = invoice.status === "approved"
      ? (language === "id" ? "Disetujui, belum dikirim" : "Approved, not sent")
      : (language === "id" ? "Terkirim" : "Sent");

    return `<tr>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">
        <strong>${escapeHtml(invoice.invoice_number)}</strong><br>
        <span style="color:#6b7280">${escapeHtml(invoice.customer_name)}</span>
      </td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(formatDate(invoice.due_date, language))}<br><span style="color:#6b7280">${escapeHtml(timing)}</span></td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb">${escapeHtml(workflowStatus)}</td>
      <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right"><strong>${escapeHtml(formatMoney(Number(invoice.outstanding_amount), business.currency, language))}</strong></td>
    </tr>`;
  }).join("");

  if (language === "en") {
    return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:760px;margin:0 auto;padding:32px">
      <h2 style="margin-bottom:8px">Invoices that need attention</h2>
      <p>Hi ${escapeHtml(owner.display_name)},</p>
      <p>${escapeHtml(business.name)} has <strong>${invoices.length}</strong> outstanding invoice${invoices.length === 1 ? "" : "s"}: ${overdue.length} overdue and ${dueSoon} due within three days.</p>
      <table style="width:100%;border-collapse:collapse;margin:24px 0">
        <thead><tr><th style="padding:10px;text-align:left">Invoice</th><th style="padding:10px;text-align:left">Due date</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:right">Outstanding</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:18px;text-align:right">Total outstanding: <strong>${escapeHtml(formatMoney(totalOutstanding, business.currency, language))}</strong></p>
      <p>Please follow up on overdue invoices and invoices approaching their due date.</p>
    </body></html>`;
  }

  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937;max-width:760px;margin:0 auto;padding:32px">
    <h2 style="margin-bottom:8px">Invoice yang perlu ditindaklanjuti</h2>
    <p>Halo ${escapeHtml(owner.display_name)},</p>
    <p>${escapeHtml(business.name)} memiliki <strong>${invoices.length}</strong> invoice dengan tagihan tersisa: ${overdue.length} sudah terlambat dan ${dueSoon} jatuh tempo dalam tiga hari.</p>
    <table style="width:100%;border-collapse:collapse;margin:24px 0">
      <thead><tr><th style="padding:10px;text-align:left">Invoice</th><th style="padding:10px;text-align:left">Jatuh tempo</th><th style="padding:10px;text-align:left">Status</th><th style="padding:10px;text-align:right">Sisa tagihan</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:18px;text-align:right">Total tagihan tersisa: <strong>${escapeHtml(formatMoney(totalOutstanding, business.currency, language))}</strong></p>
    <p>Mohon tindak lanjuti invoice yang terlambat dan yang mendekati jatuh tempo.</p>
  </body></html>`;
}

async function loadEligibleInvoices(
  admin: ReturnType<typeof createAdminClient>,
  cutoffDate: string,
) {
  const invoices: InvoiceRow[] = [];

  for (let offset = 0;; offset += invoicePageSize) {
    const result = await admin.database.from("invoice_overview")
      .select("id, business_id, invoice_number, status, due_date, total_amount, amount_paid, outstanding_amount, customer_name")
      .in("status", ["approved", "sent"])
      .lte("due_date", cutoffDate)
      .gt("outstanding_amount", 0)
      .order("due_date", { ascending: true })
      .range(offset, offset + invoicePageSize - 1);

    if (result.error) throw result.error;
    const page = (result.data ?? []) as InvoiceRow[];
    invoices.push(...page);
    if (page.length < invoicePageSize) break;
  }

  return invoices;
}

async function processReminders(request: Request) {
  const expectedToken = Deno.env.get("REMINDER_WORKER_TOKEN");
  if (!expectedToken || request.headers.get("X-Worker-Token") !== expectedToken) {
    return json({ error: "Unauthorized worker" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    // An empty request body is valid for scheduled invocations.
  }
  const dryRun = body.dryRun === true;
  const admin = createAdminClient({ baseUrl, apiKey });
  const today = dateInTimeZone(new Date(), reminderTimeZone);
  const cutoffDate = addDays(today, 3);
  const invoices = await loadEligibleInvoices(admin, cutoffDate);

  const invoicesByBusiness = new Map<string, InvoiceRow[]>();
  for (const invoice of invoices) {
    const current = invoicesByBusiness.get(invoice.business_id) ?? [];
    current.push(invoice);
    invoicesByBusiness.set(invoice.business_id, current);
  }

  const businessIds = [...invoicesByBusiness.keys()];
  if (businessIds.length === 0) {
    return json({ dryRun, reminderDate: today, cutoffDate, businesses: 0, invoices: 0, results: [] });
  }

  const businessesResult = await admin.database.from("businesses")
    .select("id, name, currency, email, invoice_language, created_by")
    .in("id", businessIds)
    .eq("notify_invoice_due", true);
  if (businessesResult.error) throw businessesResult.error;
  const businesses = (businessesResult.data ?? []) as BusinessRow[];

  if (businesses.length === 0) {
    return json({ dryRun, reminderDate: today, cutoffDate, businesses: 0, invoices: invoices.length, results: [] });
  }

  const membersResult = await admin.database.from("business_members")
    .select("business_id, user_id, email, display_name")
    .in("business_id", businesses.map((business) => business.id))
    .eq("status", "active");
  if (membersResult.error) throw membersResult.error;
  const members = (membersResult.data ?? []) as BusinessMemberRow[];

  const recentAuditResult = await admin.database.from("audit_logs")
    .select("business_id, action, metadata")
    .eq("entity_type", "invoice_owner_due_digest")
    .gte("created_at", `${addDays(today, -1)}T00:00:00.000Z`)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (recentAuditResult.error) throw recentAuditResult.error;
  const completedToday = new Set(
    (recentAuditResult.data ?? [])
      .filter((entry) => {
        const metadata = entry.metadata as Record<string, unknown> | null;
        return metadata?.reminder_date === today && ["sent", "skipped"].includes(String(entry.action));
      })
      .map((entry) => String(entry.business_id)),
  );

  const results: Record<string, unknown>[] = [];
  for (const business of businesses) {
    const businessInvoices = invoicesByBusiness.get(business.id) ?? [];
    const owner = members.find((member) =>
      member.business_id === business.id && member.user_id === business.created_by
    );

    if (completedToday.has(business.id)) {
      results.push({ businessId: business.id, businessName: business.name, status: "already_processed", invoices: businessInvoices.length });
      continue;
    }
    if (!owner?.email) {
      results.push({ businessId: business.id, businessName: business.name, status: "skipped", reason: "Business owner has no active notification email", invoices: businessInvoices.length });
      continue;
    }

    const overdueCount = businessInvoices.filter((invoice) => invoice.due_date < today).length;
    const totalOutstanding = businessInvoices.reduce(
      (sum, invoice) => sum + Number(invoice.outstanding_amount),
      0,
    );
    if (dryRun) {
      results.push({
        businessId: business.id,
        businessName: business.name,
        ownerEmail: maskEmail(owner.email),
        status: "would_send",
        invoices: businessInvoices.length,
        overdue: overdueCount,
        dueWithinThreeDays: businessInvoices.length - overdueCount,
        totalOutstanding,
        currency: business.currency,
      });
      continue;
    }

    const language = business.invoice_language === "en" ? "en" : "id";
    const sent = await admin.emails.send({
      to: owner.email,
      subject: language === "id"
        ? `${businessInvoices.length} invoice perlu ditindaklanjuti — ${business.name}`
        : `${businessInvoices.length} invoice${businessInvoices.length === 1 ? "" : "s"} need attention — ${business.name}`,
      html: digestHtml(business, owner, businessInvoices, today),
      from: business.name,
      replyTo: business.email ?? undefined,
    });
    if (sent.error) {
      results.push({ businessId: business.id, businessName: business.name, status: "failed", error: sent.error.message, invoices: businessInvoices.length });
      continue;
    }

    const skipped = sent.data?.skipped?.includes(owner.email) ?? false;
    const deliveryStatus = skipped ? "skipped" : "sent";
    const auditResult = await admin.database.from("audit_logs").insert([{
      business_id: business.id,
      actor_type: "system",
      actor_user_id: null,
      action: deliveryStatus,
      entity_type: "invoice_owner_due_digest",
      entity_id: null,
      summary: skipped
        ? "Daily invoice due digest skipped because the business owner unsubscribed"
        : "Daily invoice due digest sent to the business owner",
      metadata: {
        reminder_date: today,
        cutoff_date: cutoffDate,
        invoice_count: businessInvoices.length,
        overdue_count: overdueCount,
        due_within_three_days_count: businessInvoices.length - overdueCount,
        total_outstanding: totalOutstanding,
        currency: business.currency,
        provider_message_id: sent.data?.id ?? null,
      },
    }]);
    if (auditResult.error) throw auditResult.error;

    results.push({
      businessId: business.id,
      businessName: business.name,
      ownerEmail: maskEmail(owner.email),
      status: deliveryStatus,
      invoices: businessInvoices.length,
      emailId: sent.data?.id ?? null,
    });
  }

  const response = {
    dryRun,
    reminderDate: today,
    cutoffDate,
    businesses: results.length,
    invoices: invoices.length,
    results,
  };
  return json(response, results.some((result) => result.status === "failed") ? 502 : 200);
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!baseUrl || !apiKey) return json({ error: "Function environment is incomplete" }, 503);

  try {
    return await processReminders(request);
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Unexpected reminder error" }, 500);
  }
}
