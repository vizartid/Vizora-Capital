export type BusinessRole = "administrator" | "approver" | "finance" | "viewer";
export type InvoiceStatus = "draft" | "approved" | "sent" | "paid" | "overdue" | "void";

export interface Business {
  id: string;
  name: string;
  industry: string | null;
  team_size: string | null;
  country: string;
  currency: string;
  logo_url: string | null;
  logo_key: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  invoice_prefix: string;
  payment_terms_days: number;
  default_tax_rate: number;
  invoice_language: "id" | "en";
  default_notes: string | null;
  notify_invoice_due: boolean;
  notify_payment_received: boolean;
  notify_ai_action: boolean;
  notify_weekly_summary: boolean;
}

export interface Membership {
  id: string;
  business_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: BusinessRole;
  status: "active" | "suspended";
}

export interface InvoiceOverview {
  id: string;
  business_id: string;
  customer_id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string | null;
  status: Exclude<InvoiceStatus, "overdue">;
  effective_status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  amount_paid: number;
  outstanding_amount: number;
  notes: string | null;
  reminder_enabled: boolean;
  created_at: string;
}

export interface CustomerOverview {
  id: string;
  business_id: string;
  name: string;
  contact_name: string | null;
  contact_email: string | null;
  phone: string | null;
  billing_address: string | null;
  invoice_count: number;
  total_billed: number;
  outstanding_amount: number;
}

export interface CatalogItem {
  id: string;
  business_id: string;
  name: string;
  description: string | null;
  unit: string;
  standard_price: number;
  default_tax_rate: number;
  default_discount_rate: number;
  is_active: boolean;
}

export interface Transaction {
  id: string;
  business_id: string;
  invoice_id: string | null;
  type: "income" | "expense";
  name: string;
  category: string;
  amount: number;
  transaction_date: string;
  notes: string | null;
  created_at: string;
}

export interface DashboardSummary {
  income: number;
  expense: number;
  receivables: number;
  unpaid_count: number;
  draft_count: number;
  overdue_count: number;
  overdue_amount: number;
}
