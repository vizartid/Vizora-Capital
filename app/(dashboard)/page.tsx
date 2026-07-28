"use client";

import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  CircleAlert,
  Clock3,
  Download,
  MoreHorizontal,
  Plus,
  ReceiptText,
  Sparkles,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import type { DashboardSummary, InvoiceOverview } from "../lib/finance/types";
import { insforge } from "../lib/insforge/client";
import { useVizora } from "../providers/VizoraProvider";

const emptySummary: DashboardSummary = { income: 0, expense: 0, receivables: 0, unpaid_count: 0, draft_count: 0, overdue_count: 0, overdue_amount: 0 };
const money = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
const shortMoney = (value: number) => new Intl.NumberFormat("id-ID", { notation: "compact", style: "currency", currency: "IDR", maximumFractionDigits: 1 }).format(value);
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

const chartSets = {
  "Bulan ini": [34, 51, 43, 67, 55, 82, 70, 88, 63, 91, 74, 96],
  "3 bulan": [52, 44, 61, 48, 72, 58, 80, 69, 75, 86, 82, 92],
};

export default function DashboardPage() {
  const [period, setPeriod] = useState<keyof typeof chartSets>("Bulan ini");
  const [summary, setSummary] = useState(emptySummary);
  const [invoices, setInvoices] = useState<InvoiceOverview[]>([]);
  const [overdue, setOverdue] = useState<InvoiceOverview[]>([]);
  const { business, membership } = useVizora();

  useEffect(() => {
    if (!business) return;
    async function load() {
      const [summaryResult, dueResult, overdueResult] = await Promise.all([
        insforge.database.rpc("get_dashboard_summary", { p_business_id: business!.id, p_month: new Date().toISOString().slice(0, 10) }),
        insforge.database.from("invoice_overview").select("*").in("status", ["approved", "sent"]).gte("due_date", new Date().toISOString().slice(0, 10)).order("due_date").limit(3),
        insforge.database.from("invoice_overview").select("*").eq("effective_status", "overdue").order("due_date").limit(3),
      ]);
      if (summaryResult.data) setSummary(summaryResult.data as DashboardSummary);
      if (dueResult.data) setInvoices(dueResult.data as InvoiceOverview[]);
      if (overdueResult.data) setOverdue(overdueResult.data as InvoiceOverview[]);
    }
    void load();
  }, [business]);

  return (
    <AppShell active="dashboard">
      <div className="page-heading dashboard-heading">
        <div>
          <div className="eyebrow"><CalendarDays size={14} /> {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
          <h1>Selamat datang, {membership?.display_name.split(" ")[0]}.</h1>
          <p>Berikut kondisi keuangan {business?.name} hari ini.</p>
        </div>
        <div className="heading-actions">
          <button className="button secondary"><Download size={16} /> Unduh laporan</button>
          <button className="button primary"><Plus size={17} /> Buat invoice</button>
        </div>
      </div>

      <section className="metric-grid" aria-label="Ringkasan keuangan">
        <article className="balance-card">
          <div className="balance-topline">
            <span className="balance-label"><WalletCards size={16} /> Saldo kas saat ini</span>
            <div className="segmented-control" aria-label="Periode grafik">
              {(Object.keys(chartSets) as (keyof typeof chartSets)[]).map((item) => (
                <button key={item} className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{item}</button>
              ))}
            </div>
          </div>
          <div className="balance-body">
            <div>
              <p className="balance-amount">{shortMoney(summary.income - summary.expense)}</p>
              <div className="positive-change"><TrendingUp size={15} /> <span>saldo bersih bulan ini</span></div>
            </div>
            <div className="bar-chart" aria-label="Grafik saldo kas">
              {chartSets[period].map((height, index) => (
                <div key={index} className="bar-track"><span style={{ height: `${height}%` }} /></div>
              ))}
            </div>
          </div>
          <div className="balance-footer">
            <span><i className="legend-dot income" /> Arus masuk <b>{shortMoney(summary.income)}</b></span>
            <span><i className="legend-dot expense" /> Arus keluar <b>{shortMoney(summary.expense)}</b></span>
          </div>
        </article>

        <article className="kpi-card">
          <div className="kpi-icon green"><ArrowDownRight size={18} /></div>
          <div className="kpi-title">Uang masuk</div>
          <div className="kpi-value">{shortMoney(summary.income)}</div>
          <div className="kpi-detail positive"><ArrowUpRight size={14} /> <span>bulan ini</span></div>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon coral"><ArrowUpRight size={18} /></div>
          <div className="kpi-title">Uang keluar</div>
          <div className="kpi-value">{shortMoney(summary.expense)}</div>
          <div className="kpi-detail negative"><ArrowUpRight size={14} /> <span>bulan ini</span></div>
        </article>
        <article className="kpi-card">
          <div className="kpi-icon violet"><ReceiptText size={18} /></div>
          <div className="kpi-title">Total piutang</div>
          <div className="kpi-value">{shortMoney(summary.receivables)}</div>
          <div className="kpi-detail neutral"><Clock3 size={14} /> {summary.unpaid_count} invoice <span>belum dibayar</span></div>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="panel invoice-panel">
          <div className="panel-header">
            <div>
              <h2>Jatuh tempo terdekat</h2>
              <p>Invoice yang perlu dipantau minggu ini</p>
            </div>
            <button className="text-button">Lihat semua <ArrowRight size={15} /></button>
          </div>
          <div className="invoice-table" role="table" aria-label="Daftar invoice jatuh tempo">
            <div className="invoice-row invoice-table-head" role="row">
              <span>Pelanggan</span><span>Jumlah</span><span>Jatuh tempo</span><span>Status</span><span />
            </div>
            {invoices.length === 0 && <div className="invoice-row"><span className="muted-cell">Belum ada invoice jatuh tempo.</span></div>}
            {invoices.map((invoice, index) => (
              <div className="invoice-row" role="row" key={invoice.id}>
                <div className="customer-cell">
                  <span className={`customer-avatar ${["blue", "amber", "violet"][index % 3]}`}>{initials(invoice.customer_name)}</span>
                  <span><b>{invoice.customer_name}</b><small>{invoice.invoice_number}</small></span>
                </div>
                <strong>{money(invoice.outstanding_amount)}</strong>
                <span className="muted-cell">{new Date(invoice.due_date).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}</span>
                <span><i className="status-pill pending">Menunggu</i></span>
                <button className="icon-button small" aria-label={`Opsi ${invoice.invoice_number}`}><MoreHorizontal size={17} /></button>
              </div>
            ))}
          </div>
        </section>

        <aside className="panel overdue-panel">
          <div className="panel-header compact">
            <div>
              <div className="section-icon danger"><CircleAlert size={17} /></div>
              <h2>Piutang terlambat</h2>
            </div>
            <span className="count-badge">{summary.overdue_count}</span>
          </div>
          <p className="overdue-summary"><b>{shortMoney(summary.overdue_amount)}</b> menunggu pembayaran</p>
          <div className="overdue-list">
            {overdue.map((item, index) => (
              <div className="overdue-item" key={item.id}>
                <span className={`customer-avatar ${["coral", "blue", "amber"][index]}`}>{initials(item.customer_name)}</span>
                <span><b>{item.customer_name}</b><small>{item.invoice_number} · jatuh tempo {new Date(item.due_date).toLocaleDateString("id-ID", { day: "numeric", month: "short" })}</small></span>
                <strong>{money(item.outstanding_amount)}</strong>
              </div>
            ))}
          </div>
          <Link href="/chat" className="reminder-action"><Sparkles size={16} /> Minta AI buat pengingat <ArrowRight size={15} /></Link>
        </aside>
      </div>
    </AppShell>
  );
}
