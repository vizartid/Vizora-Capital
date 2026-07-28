export const billingCycles = ["monthly", "yearly"] as const;
export type BillingCycle = (typeof billingCycles)[number];

export const planIds = ["starter", "growth", "scale"] as const;
export type PlanId = (typeof planIds)[number];

export interface PaymentPlan {
  id: PlanId;
  name: string;
  note: string;
  prices: Record<BillingCycle, number>;
  displayMonthly: Record<BillingCycle, number>;
  users: string;
  invoices: string;
  ai: string;
  features: string[];
  cta: string;
  popular?: boolean;
}

export const paymentPlans: PaymentPlan[] = [
  {
    id: "starter",
    name: "Starter",
    note: "Untuk freelancer dan bisnis baru",
    prices: { monthly: 149_000, yearly: 1_428_000 },
    displayMonthly: { monthly: 149, yearly: 119 },
    users: "1 pengguna",
    invoices: "30 invoice / bulan",
    ai: "50 aksi AI / bulan",
    features: ["Dashboard arus kas", "Pelanggan & katalog item", "Pengingat invoice", "Ekspor laporan"],
    cta: "Mulai dengan Starter",
  },
  {
    id: "growth",
    name: "Growth",
    note: "Untuk tim yang sedang berkembang",
    prices: { monthly: 349_000, yearly: 3_348_000 },
    displayMonthly: { monthly: 349, yearly: 279 },
    users: "5 pengguna",
    invoices: "Invoice tanpa batas",
    ai: "500 aksi AI / bulan",
    features: ["Semua fitur Starter", "Persetujuan dan peran tim", "Audit log lengkap", "Template invoice khusus", "Dukungan prioritas"],
    cta: "Coba Growth gratis",
    popular: true,
  },
  {
    id: "scale",
    name: "Scale",
    note: "Untuk operasi keuangan kompleks",
    prices: { monthly: 799_000, yearly: 7_668_000 },
    displayMonthly: { monthly: 799, yearly: 639 },
    users: "15 pengguna",
    invoices: "Invoice tanpa batas",
    ai: "Aksi AI tanpa batas",
    features: ["Semua fitur Growth", "Multi-unit bisnis", "Kontrol akses lanjutan", "Onboarding khusus", "SLA dukungan"],
    cta: "Pilih Scale",
  },
];

export function isBillingCycle(value: unknown): value is BillingCycle {
  return typeof value === "string" && billingCycles.includes(value as BillingCycle);
}

export function getPaymentPlan(value: unknown) {
  return typeof value === "string" ? paymentPlans.find((plan) => plan.id === value) ?? null : null;
}
