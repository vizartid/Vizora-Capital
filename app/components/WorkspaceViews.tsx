"use client";

import {
  Activity,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BellRing,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  FileText,
  Filter,
  Mail,
  MoreHorizontal,
  PackageOpen,
  Plus,
  ReceiptText,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, ReactNode, useCallback, useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { insforge } from "../lib/insforge/client";
import type { CatalogItem, CustomerOverview, InvoiceOverview, Transaction } from "../lib/finance/types";
import { useVizora } from "../providers/VizoraProvider";

type ActivePage = Parameters<typeof AppShell>[0]["active"];

function WorkspaceHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <div className="workspace-heading">
      <div><span className="workspace-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </div>
  );
}

function Shell({ active, children }: { active: ActivePage; children: ReactNode }) {
  return <AppShell active={active}><div className="workspace-page">{children}</div></AppShell>;
}

const formatMoney = (value: number | string) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value));
const formatDate = (value: string) => new Date(value).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
const statusLabel = (status: string) => ({ draft: "Draft", approved: "Disetujui", sent: "Menunggu", paid: "Lunas", overdue: "Terlambat", void: "Dibatalkan" }[status] ?? status);
const statusTone = (status: string) => ({ draft: "draft", approved: "pending", sent: "pending", paid: "paid", overdue: "overdue", void: "draft" }[status] ?? "draft");

export function InvoicesView() {
  const [filter, setFilter] = useState("Semua");
  const [createOpen, setCreateOpen] = useState(false);
  const [rows, setRows] = useState<InvoiceOverview[]>([]);
  const [customers, setCustomers] = useState<CustomerOverview[]>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [error, setError] = useState("");
  const { business } = useVizora();
  const load = useCallback(async () => {
    if (!business) return;
    const [invoiceResult, customerResult, itemResult] = await Promise.all([
      insforge.database.from("invoice_overview").select("*").eq("business_id", business.id).order("created_at", { ascending: false }),
      insforge.database.from("customer_overview").select("*").eq("business_id", business.id).order("name"),
      insforge.database.from("items").select("*").eq("business_id", business.id).eq("is_active", true).order("name"),
    ]);
    if (invoiceResult.data) setRows(invoiceResult.data as InvoiceOverview[]);
    if (customerResult.data) setCustomers(customerResult.data as CustomerOverview[]);
    if (itemResult.data) setItems(itemResult.data as CatalogItem[]);
  }, [business]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const filtered = rows.filter((row) => filter === "Semua" || statusLabel(row.effective_status) === filter);
  const pending = rows.filter(row => ["approved", "sent"].includes(row.status));
  const late = rows.filter(row => row.effective_status === "overdue");
  const paid = rows.filter(row => row.status === "paid");
  async function createInvoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!business) return; setError("");
    const data = new FormData(event.currentTarget);
    const catalogItem = items.find(item => item.id === data.get("item_id"));
    const result = await insforge.database.rpc("create_invoice_draft", {
      p_business_id: business.id, p_customer_id: String(data.get("customer_id")), p_due_date: String(data.get("due_date")),
      p_items: [{ item_id: catalogItem?.id ?? null, description: catalogItem?.name ?? String(data.get("description")), quantity: Number(data.get("quantity") ?? 1), unit_price: Number(data.get("unit_price") ?? catalogItem?.standard_price ?? 0), discount_rate: catalogItem?.default_discount_rate ?? 0, tax_rate: catalogItem?.default_tax_rate ?? 0 }],
      p_notes: null, p_source: "manual", p_ai_action_id: null,
    });
    if (result.error) { setError(result.error.message); return; }
    setCreateOpen(false); await load();
  }

  return (
    <Shell active="invoices">
      <WorkspaceHeader eyebrow="Penagihan" title="Invoice" description="Buat, kirim, dan pantau setiap tagihan dari satu tempat." actions={<><button className="button secondary"><Download size={16} /> Ekspor</button><button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Invoice baru</button></>} />
      <section className="summary-strip">
        <div><span className="summary-icon amber"><Clock3 size={18} /></span><p>Menunggu pembayaran</p><strong>{formatMoney(pending.reduce((sum, row) => sum + Number(row.outstanding_amount), 0))}</strong><small>{pending.length} invoice aktif</small></div>
        <div><span className="summary-icon coral"><BellRing size={18} /></span><p>Terlambat</p><strong>{formatMoney(late.reduce((sum, row) => sum + Number(row.outstanding_amount), 0))}</strong><small>{late.length} perlu ditindaklanjuti</small></div>
        <div><span className="summary-icon green"><BadgeCheck size={18} /></span><p>Lunas</p><strong>{formatMoney(paid.reduce((sum, row) => sum + Number(row.total_amount), 0))}</strong><small>{paid.length} pembayaran masuk</small></div>
        <div><span className="summary-icon violet"><FileText size={18} /></span><p>Draft</p><strong>{rows.filter(row => row.status === "draft").length} invoice</strong><small>Menunggu persetujuan</small></div>
      </section>
      <section className="workspace-card data-card">
        <div className="data-toolbar">
          <div className="filter-tabs">{["Semua", "Draft", "Menunggu", "Terlambat", "Lunas"].map((item) => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div>
          <label className="compact-search"><Search size={15} /><input placeholder="Cari invoice..." /></label>
          <button className="compact-control"><Filter size={15} /> Filter</button>
        </div>
        <div className="workspace-table invoice-list-table">
          <div className="workspace-tr table-head"><span>Invoice</span><span>Pelanggan</span><span>Jatuh tempo</span><span>Jumlah</span><span>Status</span><span /></div>
          {filtered.map((invoice) => (
            <Link href={`/invoices/detail?id=${invoice.id}`} className="workspace-tr" key={invoice.id}>
              <span className="invoice-id"><i><ReceiptText size={15} /></i><b>{invoice.invoice_number}</b></span>
              <span><b>{invoice.customer_name}</b><small>{invoice.customer_email ?? "Email belum diisi"}</small></span>
              <span>{formatDate(invoice.due_date)}</span><strong>{formatMoney(invoice.total_amount)}</strong><span><i className={`record-status ${statusTone(invoice.effective_status)}`}>{statusLabel(invoice.effective_status)}</i></span><MoreHorizontal size={16} />
            </Link>
          ))}
        </div>
        <div className="table-footer"><span>Menampilkan {filtered.length} dari {rows.length} invoice</span><div><button disabled>‹</button><button className="active">1</button><button disabled>›</button></div></div>
      </section>
      {createOpen && <DemoModal title="Buat invoice baru" onClose={() => setCreateOpen(false)} icon={<FileText size={19} />}><form onSubmit={createInvoice}><div className="form-grid"><Field label="Pelanggan"><select name="customer_id" required>{customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></Field><Field label="Jatuh tempo"><input name="due_date" type="date" min={new Date().toISOString().slice(0, 10)} required /></Field><Field label="Item / jasa" wide><select name="item_id" required>{items.map(item => <option key={item.id} value={item.id}>{item.name} — {formatMoney(item.standard_price)}</option>)}</select></Field><Field label="Jumlah"><input name="quantity" type="number" min="0.001" step="0.001" defaultValue="1" /></Field></div>{error && <p className="danger-text" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setCreateOpen(false)}>Batal</button><button className="button primary" type="submit">Simpan draft</button></div></form></DemoModal>}
    </Shell>
  );
}

export function InvoiceDetailView() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams.get("id");
  const [invoice, setInvoice] = useState<InvoiceOverview | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const { business, membership } = useVizora();
  const load = useCallback(async () => {
    if (!invoiceId) return;
    const [invoiceResult, itemsResult] = await Promise.all([
      insforge.database.from("invoice_overview").select("*").eq("id", invoiceId).single(),
      insforge.database.from("invoice_items").select("*").eq("invoice_id", invoiceId).order("sort_order"),
    ]);
    if (invoiceResult.error) setError(invoiceResult.error.message); else setInvoice(invoiceResult.data as InvoiceOverview);
    if (itemsResult.data) setInvoiceItems(itemsResult.data as Record<string, unknown>[]);
  }, [invoiceId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function approve() {
    if (!invoice) return; setWorking(true); setError("");
    const result = await insforge.database.rpc("approve_invoice", { p_invoice_id: invoice.id });
    if (result.error) setError(result.error.message); else await load(); setWorking(false);
  }
  async function sendInvoice() {
    if (!invoice) return; setWorking(true); setError("");
    const result = await insforge.functions.invoke("finance-api", { body: { action: "send_invoice", invoiceId: invoice.id } });
    if (result.error) setError(result.error.message); else await load(); setWorking(false);
  }
  if (!invoice) return <Shell active="invoices"><div className="workspace-card settings-card"><h2>{error || "Memuat invoice…"}</h2><Link href="/invoices" className="text-link">Kembali ke invoice</Link></div></Shell>;
  const canApprove = ["administrator", "approver"].includes(membership?.role ?? "");
  return (
    <Shell active="invoices">
      <div className="detail-breadcrumb"><Link href="/invoices"><ArrowLeft size={15} /> Kembali ke invoice</Link><span>/</span><b>{invoice.invoice_number}</b></div>
      <WorkspaceHeader eyebrow="Detail invoice" title={invoice.invoice_number} description={`Dibuat ${formatDate(invoice.created_at)} oleh ${membership?.display_name ?? "anggota tim"}`} actions={<>{invoice.status === "draft" && canApprove && <button className="button secondary" onClick={approve} disabled={working}><BadgeCheck size={16} /> Setujui</button>}<button className="button primary" onClick={sendInvoice} disabled={working || invoice.status !== "approved"}><Send size={16} />{invoice.status === "sent" ? "Terkirim" : working ? "Memproses…" : "Kirim invoice"}</button></>} />
      {error && <div className="success-banner"><CircleDollarSign size={18} /><span>{error}</span><button onClick={() => setError("")}><X size={15} /></button></div>}
      <div className="detail-layout">
        <article className="invoice-document">
          <div className="invoice-doc-head"><div className="doc-brand"><span><ReceiptText size={20} /></span><b>{business?.name}</b></div><div><span className={`record-status ${statusTone(invoice.effective_status)}`}>{statusLabel(invoice.effective_status).toUpperCase()}</span><h2>INVOICE</h2><p>#{invoice.invoice_number}</p></div></div>
          <div className="invoice-addresses"><div><small>DARI</small><b>{business?.name}</b><p>{business?.address}<br />{business?.email}</p></div><div><small>DITAGIHKAN KEPADA</small><b>{invoice.customer_name}</b><p>{invoice.customer_email ?? "Email belum diisi"}</p></div><div><small>TANGGAL TERBIT</small><b>{formatDate(invoice.issue_date)}</b><small>JATUH TEMPO</small><b>{formatDate(invoice.due_date)}</b></div></div>
          <div className="invoice-items"><div className="invoice-item header"><span>DESKRIPSI</span><span>QTY</span><span>HARGA</span><span>JUMLAH</span></div>{invoiceItems.map(item => <div className="invoice-item" key={String(item.id)}><span><b>{String(item.description)}</b></span><span>{String(item.quantity)}</span><span>{formatMoney(Number(item.unit_price))}</span><strong>{formatMoney(Number(item.line_total))}</strong></div>)}</div>
          <div className="invoice-totals"><span>Subtotal <b>{formatMoney(invoice.subtotal)}</b></span><span>Pajak <b>{formatMoney(invoice.tax_amount)}</b></span><span className="grand-total">Total <b>{formatMoney(invoice.total_amount)}</b></span></div>
          <div className="invoice-note"><b>Catatan</b><p>{invoice.notes ?? business?.default_notes ?? "Terima kasih atas kepercayaan Anda."}</p></div>
        </article>
        <aside className="detail-side">
          <section className="workspace-card side-card"><h3>Status invoice</h3><p><i className={`record-status ${statusTone(invoice.effective_status)}`}>{statusLabel(invoice.effective_status)}</i></p><small>Diperbarui dari riwayat status yang tidak dapat diubah.</small></section>
          <section className="workspace-card side-card"><div className="side-card-title"><h3>Pengingat otomatis</h3><span className={`switch ${invoice.reminder_enabled ? "on" : ""}`}><i /></span></div><p>Pengingat dijadwalkan 1 hari sebelum dan 3 hari setelah jatuh tempo.</p></section>
          <section className="workspace-card side-card"><h3>Aktivitas terbaru</h3><Link href="/audit" className="text-link">Lihat audit log <ArrowRight size={13} /></Link></section>
        </aside>
      </div>
    </Shell>
  );
}

export function TransactionsView() {
  const [addOpen, setAddOpen] = useState(false);
  const [kind, setKind] = useState("Semua");
  const [rows, setRows] = useState<Transaction[]>([]);
  const [error, setError] = useState("");
  const { business } = useVizora();
  const load = useCallback(async () => { if (!business) return; const result = await insforge.database.from("transactions").select("*").eq("business_id", business.id).order("transaction_date", { ascending: false }); if (result.data) setRows(result.data as Transaction[]); }, [business]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const income = rows.filter(row => row.type === "income").reduce((sum, row) => sum + Number(row.amount), 0);
  const expense = rows.filter(row => row.type === "expense").reduce((sum, row) => sum + Number(row.amount), 0);
  async function createTransaction(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!business) return; const data = new FormData(event.currentTarget); const result = await insforge.database.rpc("record_transaction", { p_business_id: business.id, p_type: String(data.get("type")), p_name: String(data.get("name")), p_category: String(data.get("category")), p_amount: Number(data.get("amount")), p_transaction_date: String(data.get("date")), p_invoice_id: null, p_notes: null }); if (result.error) { setError(result.error.message); return; } setAddOpen(false); await load(); }
  return <Shell active="transactions"><WorkspaceHeader eyebrow="Arus kas" title="Transaksi" description="Catat pemasukan dan pengeluaran tanpa membuka spreadsheet." actions={<><button className="button secondary"><Download size={16} /> Ekspor CSV</button><button className="button primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Catat transaksi</button></>} />
    <section className="cash-overview"><div><p>Saldo bersih</p><strong>{formatMoney(income - expense)}</strong><span className="positive"><ArrowUpRight size={14} /> Data tercatat</span></div><div className="cash-flow-mini"><span><i className="income" />Pemasukan<b>{formatMoney(income)}</b></span><span><i className="expense" />Pengeluaran<b>{formatMoney(expense)}</b></span><div><i style={{ width: `${income + expense ? income / (income + expense) * 100 : 0}%` }} /><i style={{ width: `${income + expense ? expense / (income + expense) * 100 : 0}%` }} /></div></div></section>
    <section className="workspace-card data-card"><div className="data-toolbar"><div className="filter-tabs">{["Semua", "Pemasukan", "Pengeluaran"].map(item => <button key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}>{item}</button>)}</div><label className="compact-search"><Search size={15} /><input placeholder="Cari transaksi..." /></label><button className="compact-control"><CalendarDays size={15} /> Juli 2026 <ChevronDown size={13} /></button></div>
    <div className="workspace-table transactions-table"><div className="workspace-tr table-head"><span>Tanggal</span><span>Transaksi</span><span>Kategori</span><span>Tipe</span><span>Jumlah</span><span /></div>{rows.filter(row => kind === "Semua" || (kind === "Pemasukan" ? row.type === "income" : row.type === "expense")).map(row => <div className="workspace-tr" key={row.id}><span>{formatDate(row.transaction_date)}</span><span className="transaction-name"><i className={row.type}>{row.type === "income" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</i><b>{row.name}</b></span><span>{row.category}</span><span><i className={`record-status ${row.type}`}>{row.type === "income" ? "Pemasukan" : "Pengeluaran"}</i></span><strong className={row.type}>{row.type === "income" ? "+" : "−"}{formatMoney(row.amount)}</strong><MoreHorizontal size={16} /></div>)}</div></section>
    {addOpen && <DemoModal title="Catat transaksi" onClose={() => setAddOpen(false)} icon={<CircleDollarSign size={19} />}><form onSubmit={createTransaction}><div className="form-grid"><Field label="Tipe"><select name="type"><option value="income">Pemasukan</option><option value="expense">Pengeluaran</option></select></Field><Field label="Nama transaksi" wide><input name="name" placeholder="Contoh: Pembayaran klien" required /></Field><Field label="Jumlah"><input name="amount" type="number" min="1" placeholder="0" required /></Field><Field label="Tanggal"><input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></Field><Field label="Kategori" wide><select name="category"><option>Pendapatan jasa</option><option>Operasional</option><option>Pemasaran</option></select></Field></div>{error && <p className="danger-text">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Batal</button><button className="button primary">Simpan transaksi</button></div></form></DemoModal>}
  </Shell>;
}

export function CustomersView() {
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [customersData, setCustomersData] = useState<CustomerOverview[]>([]);
  const [error, setError] = useState("");
  const { business } = useVizora();
  const load = useCallback(async () => { if (!business) return; const result = await insforge.database.from("customer_overview").select("*").eq("business_id", business.id).order("name"); if (result.data) setCustomersData(result.data as CustomerOverview[]); }, [business]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  const rows = customersData.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) || item.contact_email?.toLowerCase().includes(query.toLowerCase()));
  async function createCustomer(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!business) return; const data = new FormData(event.currentTarget); const result = await insforge.database.from("customers").insert([{ business_id: business.id, name: String(data.get("name")), contact_email: String(data.get("email")), contact_name: String(data.get("contact")) || null, phone: String(data.get("phone")) || null, billing_address: String(data.get("address")) || null }]).select(); if (result.error) { setError(result.error.message); return; } setAddOpen(false); await load(); }
  return <Shell active="customers"><WorkspaceHeader eyebrow="Relasi bisnis" title="Pelanggan" description="Simpan informasi pelanggan dan pantau nilai hubungan bisnis." actions={<button className="button primary" onClick={() => setAddOpen(true)}><UserPlus size={16} /> Tambah pelanggan</button>} />
    <section className="workspace-card data-card"><div className="data-toolbar"><label className="compact-search grow"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Cari nama atau email pelanggan..." /></label><button className="compact-control"><Filter size={15} /> Semua pelanggan</button></div>
    <div className="customer-grid">{rows.map((customer, index) => <article className="customer-card" key={customer.id}><div className="customer-card-head"><span className={`large-initial ${["blue", "amber", "violet", "coral", "green"][index % 5]}`}>{customer.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("")}</span><button><MoreHorizontal size={17} /></button></div><h3>{customer.name}</h3><p><Mail size={13} /> {customer.contact_email ?? "Email belum diisi"}</p><div className="customer-metrics"><span><small>Total invoice</small><b>{customer.invoice_count}</b></span><span><small>Total ditagih</small><b>{formatMoney(customer.total_billed)}</b></span><span><small>Belum dibayar</small><b className="danger-text">{formatMoney(customer.outstanding_amount)}</b></span></div></article>)}</div></section>
    {addOpen && <DemoModal title="Tambah pelanggan" onClose={() => setAddOpen(false)} icon={<Users size={19} />}><form onSubmit={createCustomer}><div className="form-grid"><Field label="Nama perusahaan" wide><input name="name" placeholder="PT Nama Perusahaan" required /></Field><Field label="Email penagihan" wide><input name="email" type="email" placeholder="finance@perusahaan.co.id" required /></Field><Field label="Nama kontak"><input name="contact" placeholder="Nama lengkap" /></Field><Field label="Nomor telepon"><input name="phone" placeholder="+62" /></Field><Field label="Alamat" wide><textarea name="address" placeholder="Alamat penagihan lengkap" /></Field></div>{error && <p className="danger-text">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Batal</button><button className="button primary">Simpan pelanggan</button></div></form></DemoModal>}
  </Shell>;
}

export function ItemsView() {
  const [addOpen, setAddOpen] = useState(false);
  const [catalogData, setCatalogData] = useState<CatalogItem[]>([]);
  const [error, setError] = useState("");
  const { business } = useVizora();
  const load = useCallback(async () => { if (!business) return; const result = await insforge.database.from("items").select("*").eq("business_id", business.id).eq("is_active", true).order("name"); if (result.data) setCatalogData(result.data as CatalogItem[]); }, [business]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function createItem(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!business) return; const data = new FormData(event.currentTarget); const result = await insforge.database.from("items").insert([{ business_id: business.id, name: String(data.get("name")), description: String(data.get("description")) || null, standard_price: Number(data.get("price")), default_tax_rate: Number(data.get("tax")), default_discount_rate: 0 }]).select(); if (result.error) { setError(result.error.message); return; } setAddOpen(false); await load(); }
  return <Shell active="items"><WorkspaceHeader eyebrow="Katalog" title="Item & jasa" description="Gunakan harga standar agar invoice dapat dibuat lebih cepat." actions={<button className="button primary" onClick={() => setAddOpen(true)}><Plus size={16} /> Tambah item</button>} />
    <section className="catalog-toolbar"><label className="compact-search grow"><Search size={15} /><input placeholder="Cari item atau jasa..." /></label><div className="view-count"><PackageOpen size={15} /> {catalogData.length} item aktif</div></section>
    <div className="catalog-grid">{catalogData.map((item, index) => <article className="catalog-card" key={item.id}><div className="catalog-card-top"><span className={`catalog-icon ${["green", "blue", "violet", "coral", "amber", "pink"][index % 6]}`}>{item.name.slice(0, 2).toUpperCase()}</span><button><MoreHorizontal size={17} /></button></div><h3>{item.name}</h3><p>{item.description}</p><div className="catalog-price"><small>Harga standar</small><strong>{formatMoney(item.standard_price)}</strong><span>{Number(item.default_tax_rate) ? `Pajak ${item.default_tax_rate}%` : "Tanpa pajak"}</span></div></article>)}</div>
    {addOpen && <DemoModal title="Tambah item atau jasa" onClose={() => setAddOpen(false)} icon={<PackageOpen size={19} />}><form onSubmit={createItem}><div className="form-grid"><Field label="Nama item" wide><input name="name" placeholder="Contoh: Jasa konsultasi" required /></Field><Field label="Deskripsi" wide><textarea name="description" placeholder="Deskripsi singkat untuk invoice" /></Field><Field label="Harga standar"><input name="price" type="number" min="0" placeholder="0" required /></Field><Field label="Pajak default"><select name="tax"><option value="11">PPN 11%</option><option value="0">Tanpa pajak</option></select></Field></div>{error && <p className="danger-text">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setAddOpen(false)}>Batal</button><button className="button primary">Simpan item</button></div></form></DemoModal>}
  </Shell>;
}

export function TeamView() {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [members, setMembers] = useState<Record<string, unknown>[]>([]);
  const [invitations, setInvitations] = useState<Record<string, unknown>[]>([]);
  const [error, setError] = useState("");
  const { business } = useVizora();
  const load = useCallback(async () => { if (!business) return; const [memberResult, inviteResult] = await Promise.all([insforge.database.from("business_members").select("*").eq("business_id", business.id).order("joined_at"), insforge.database.from("business_invitations").select("*").eq("business_id", business.id).eq("status", "pending")]); if (memberResult.data) setMembers(memberResult.data as Record<string, unknown>[]); if (inviteResult.data) setInvitations(inviteResult.data as Record<string, unknown>[]); }, [business]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function invite(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!business) return; const data = new FormData(event.currentTarget); const result = await insforge.database.rpc("invite_business_member", { p_business_id: business.id, p_email: String(data.get("email")), p_role: String(data.get("role")) }); if (result.error) { setError(result.error.message); return; } setInviteOpen(false); await load(); }
  return <Shell active="team"><WorkspaceHeader eyebrow="Organisasi" title="Tim & akses" description="Atur siapa yang dapat melihat, membuat, dan menyetujui tindakan keuangan." actions={<button className="button primary" onClick={() => setInviteOpen(true)}><UserPlus size={16} /> Undang anggota</button>} />
    <div className="team-layout"><section className="workspace-card data-card"><div className="data-toolbar"><div><h3>Anggota tim</h3><p>{members.length} anggota · {invitations.length} undangan</p></div><label className="compact-search"><Search size={15} /><input placeholder="Cari anggota..." /></label></div><div className="workspace-table team-table"><div className="workspace-tr table-head"><span>Anggota</span><span>Peran</span><span>Status</span><span>Terakhir aktif</span><span /></div>{members.map((member, index) => <div className="workspace-tr" key={String(member.id)}><span className="member-cell"><i className={["tan", "violet", "blue", "amber"][index % 4]}>{String(member.display_name).split(/\s+/).slice(0,2).map(part => part[0]).join("")}</i><span><b>{String(member.display_name)}</b><small>{String(member.email)}</small></span></span><span><button className="role-select">{String(member.role)} <ChevronDown size={12} /></button></span><span><i className="record-status paid">Aktif</i></span><span>{member.last_active_at ? formatDate(String(member.last_active_at)) : "Belum tercatat"}</span><MoreHorizontal size={16} /></div>)}</div></section>
    <aside className="workspace-card permissions-card"><span className="permissions-icon"><ShieldCheck size={21} /></span><h3>Kontrol berbasis peran</h3><p>Setiap peran memiliki batasan yang jelas untuk menjaga data bisnis.</p><div><span><Check size={14} /><p><b>Administrator</b><small>Akses penuh dan kelola tim</small></p></span><span><Check size={14} /><p><b>Approver</b><small>Menyetujui invoice dan aksi AI</small></p></span><span><Check size={14} /><p><b>Finance</b><small>Buat dan kelola data keuangan</small></p></span><span><Eye size={14} /><p><b>Viewer</b><small>Hanya melihat laporan</small></p></span></div></aside></div>
    {inviteOpen && <DemoModal title="Undang anggota tim" onClose={() => setInviteOpen(false)} icon={<UserPlus size={19} />}><form onSubmit={invite}><div className="form-grid"><Field label="Alamat email" wide><input name="email" type="email" placeholder="nama@perusahaan.id" required /></Field><Field label="Peran" wide><select name="role"><option value="finance">Finance</option><option value="approver">Approver</option><option value="viewer">Viewer</option></select></Field></div><div className="form-note"><ShieldCheck size={15} /> Undangan tersimpan 7 hari. Pengiriman email tim memerlukan aktivasi layanan email berbayar.</div>{error && <p className="danger-text">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={() => setInviteOpen(false)}>Batal</button><button className="button primary">Simpan undangan</button></div></form></DemoModal>}
  </Shell>;
}

export function AuditView() {
  const [filter, setFilter] = useState("Semua aktivitas");
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const { business } = useVizora();
  useEffect(() => { if (!business) return; void insforge.database.from("audit_logs").select("*").eq("business_id", business.id).order("created_at", { ascending: false }).limit(100).then(result => { if (result.data) setEvents(result.data as Record<string, unknown>[]); }); }, [business]);
  const filteredEvents = events.filter(event => filter === "Semua aktivitas" || (filter === "Vizora AI" ? event.actor_type === "ai" : event.actor_type === "user"));
  return <Shell active="audit"><WorkspaceHeader eyebrow="Keamanan" title="Audit log" description="Jejak lengkap setiap perubahan yang dibuat pengguna dan Vizora AI." actions={<button className="button secondary"><Download size={16} /> Ekspor log</button>} />
    <section className="audit-stats"><span><ShieldCheck size={18} /><p><b>Semua aktivitas tercatat</b><small>Log tidak dapat diubah atau dihapus</small></p></span><span><Activity size={18} /><p><b>{events.length} aksi terbaru</b><small>{events.filter(event => event.actor_type === "ai").length} dibuat oleh AI</small></p></span><span><BadgeCheck size={18} /><p><b>RLS aktif</b><small>Data terisolasi per bisnis</small></p></span></section>
    <section className="workspace-card audit-card"><div className="data-toolbar"><div className="filter-tabs">{["Semua aktivitas", "Pengguna", "Vizora AI"].map(item => <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>{item}</button>)}</div><button className="compact-control"><CalendarDays size={15} /> 100 aktivitas terakhir</button></div><div className="audit-list">{filteredEvents.map(event => <div className="audit-row" key={String(event.id)}><span className={`audit-avatar ${String(event.actor_type)}`}>{event.actor_type === "ai" ? <Sparkles size={15} /> : event.actor_type === "system" ? <ShieldCheck size={15} /> : "U"}</span><span><b>{event.actor_type === "ai" ? "Vizora AI" : event.actor_type === "system" ? "Sistem" : "Anggota tim"}</b><small>{new Date(String(event.created_at)).toLocaleString("id-ID")}</small></span><p>{String(event.summary)}<b>{String(event.entity_type)}</b></p><button><Eye size={15} /> Detail</button></div>)}</div></section>
  </Shell>;
}

export function SettingsView() {
  const [tab, setTab] = useState("Profil bisnis");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const { business, refresh } = useVizora();
  const tabs = ["Profil bisnis", "Invoice", "Notifikasi", "Keamanan"];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!business) return; setError(""); const data = new FormData(event.currentTarget);
    if (tab === "Keamanan") { setSaved(true); setTimeout(() => setSaved(false), 2200); return; }
    const payload = tab === "Profil bisnis" ? { name: String(data.get("name")), email: String(data.get("email")) || null, phone: String(data.get("phone")) || null, address: String(data.get("address")) || null, currency: String(data.get("currency")), timezone: String(data.get("timezone")) } : tab === "Invoice" ? { invoice_prefix: String(data.get("prefix")), payment_terms_days: Number(data.get("terms")), default_tax_rate: Number(data.get("tax")), invoice_language: String(data.get("language")), default_notes: String(data.get("notes")) || null } : { notify_invoice_due: data.get("notify_invoice_due") === "true", notify_payment_received: data.get("notify_payment_received") === "true", notify_ai_action: data.get("notify_ai_action") === "true", notify_weekly_summary: data.get("notify_weekly_summary") === "true" };
    const result = await insforge.database.from("businesses").update(payload).eq("id", business.id).select();
    if (result.error) { setError(result.error.message); return; } await refresh(); setSaved(true); setTimeout(() => setSaved(false), 2200);
  }
  return <Shell active="settings"><WorkspaceHeader eyebrow="Akun" title="Pengaturan" description="Sesuaikan profil, penagihan, notifikasi, dan keamanan bisnis." />
    {saved && <div className="floating-toast"><CheckCircle2 size={17} /> Perubahan berhasil disimpan</div>}
    <div className="settings-layout"><nav className="settings-nav">{tabs.map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav><form className="workspace-card settings-card" onSubmit={save}>
      {tab === "Profil bisnis" && <><div className="settings-section-head"><span><Building2 size={19} /></span><div><h2>Profil bisnis</h2><p>Informasi ini tampil pada invoice dan email pelanggan.</p></div></div><div className="logo-upload"><span>{business?.name.split(/\s+/).slice(0,2).map(part => part[0]).join("")}</span><div><b>Logo {business?.name}</b><p>{business?.logo_key ? "Logo tersimpan privat" : "PNG, JPG, atau WebP · maks. 2 MB"}</p><label className="button secondary">Ganti logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async event => { const file = event.target.files?.[0]; if (!file || !business) return; setError(""); if (file.size > 2_000_000) { setError("Ukuran logo maksimal 2 MB"); return; } const key = `${business.id}/logo/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "-")}`; const upload = await insforge.storage.from("business-assets").upload(key, file); if (upload.error) { setError(upload.error.message); return; } const update = await insforge.database.from("businesses").update({ logo_key: key, logo_url: null }).eq("id", business.id).select(); if (update.error) { setError(update.error.message); return; } await refresh(); setSaved(true); setTimeout(() => setSaved(false), 2200); }} /></label></div></div><div className="form-grid"><Field label="Nama bisnis" wide><input name="name" defaultValue={business?.name} required /></Field><Field label="Email bisnis"><input name="email" type="email" defaultValue={business?.email ?? ""} /></Field><Field label="Nomor telepon"><input name="phone" defaultValue={business?.phone ?? ""} /></Field><Field label="Alamat bisnis" wide><textarea name="address" defaultValue={business?.address ?? ""} /></Field><Field label="Mata uang"><select name="currency" defaultValue={business?.currency}><option value="IDR">IDR — Rupiah Indonesia</option><option value="USD">USD — US Dollar</option></select></Field><Field label="Zona waktu"><select name="timezone" defaultValue={business?.timezone}><option value="Asia/Jakarta">Asia/Jakarta (GMT+7)</option></select></Field></div></>}
      {tab === "Invoice" && <><div className="settings-section-head"><span><FileText size={19} /></span><div><h2>Pengaturan invoice</h2><p>Atur nomor, pajak, dan ketentuan pembayaran default.</p></div></div><div className="form-grid"><Field label="Awalan nomor"><input name="prefix" defaultValue={business?.invoice_prefix} required /></Field><Field label="Jangka waktu pembayaran"><select name="terms" defaultValue={business?.payment_terms_days}><option value="14">14 hari</option><option value="30">30 hari</option></select></Field><Field label="Pajak default"><select name="tax" defaultValue={business?.default_tax_rate}><option value="11">PPN 11%</option><option value="0">Tanpa pajak</option></select></Field><Field label="Bahasa invoice"><select name="language" defaultValue={business?.invoice_language}><option value="id">Bahasa Indonesia</option><option value="en">English</option></select></Field><Field label="Catatan default" wide><textarea name="notes" defaultValue={business?.default_notes ?? ""} /></Field></div></>}
      {tab === "Notifikasi" && <><div className="settings-section-head"><span><BellRing size={19} /></span><div><h2>Notifikasi</h2><p>Pilih pembaruan yang ingin diterima oleh tim.</p></div></div><div className="setting-toggles"><SettingToggle name="notify_invoice_due" title="Invoice jatuh tempo" detail="Kirim notifikasi 3 hari sebelum jatuh tempo" defaultOn={business?.notify_invoice_due} /><SettingToggle name="notify_payment_received" title="Pembayaran diterima" detail="Beritahu tim saat invoice ditandai lunas" defaultOn={business?.notify_payment_received} /><SettingToggle name="notify_ai_action" title="Aksi baru dari Vizora AI" detail="Beritahu approver saat ada draft yang perlu diperiksa" defaultOn={business?.notify_ai_action} /><SettingToggle name="notify_weekly_summary" title="Ringkasan mingguan" detail="Kirim ringkasan arus kas setiap Senin" defaultOn={business?.notify_weekly_summary} /></div></>}
      {tab === "Keamanan" && <><div className="settings-section-head"><span><ShieldCheck size={19} /></span><div><h2>Keamanan akun</h2><p>Kelola kata sandi dan perlindungan akun bisnis.</p></div></div><div className="security-block"><span><b>Kata sandi</b><small>Terakhir diubah 2 bulan lalu</small></span><button type="button" className="button secondary">Ubah kata sandi</button></div><div className="security-block"><span><b>Autentikasi dua langkah</b><small>Tambahkan lapisan keamanan saat masuk</small></span><button type="button" className="button secondary">Aktifkan</button></div><div className="security-block"><span><b>Sesi aktif</b><small>2 perangkat sedang masuk</small></span><button type="button" className="button secondary">Kelola sesi</button></div></>}
      {error && <p className="danger-text">{error}</p>}<div className="settings-footer"><button type="button" className="button secondary">Batalkan</button><button className="button primary" type="submit">Simpan perubahan</button></div>
    </form></div>
  </Shell>;
}

function SettingToggle({ name, title, detail, defaultOn = true }: { name: string; title: string; detail: string; defaultOn?: boolean }) { const [on, setOn] = useState(defaultOn); return <div><span><b>{title}</b><small>{detail}</small></span><input type="hidden" name={name} value={String(on)} /><button type="button" className={`switch ${on ? "on" : ""}`} onClick={() => setOn(!on)} aria-label={`Ubah ${title}`} aria-pressed={on}><i /></button></div>; }

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) { return <label className={`form-field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>; }

function DemoModal({ title, icon, children, onClose }: { title: string; icon: ReactNode; children: ReactNode; onClose: () => void }) { return <div className="modal-layer" role="dialog" aria-modal="true"><button className="modal-scrim" onClick={onClose} aria-label="Tutup" /><div className="demo-modal"><div className="modal-head"><span>{icon}</span><h2>{title}</h2><button onClick={onClose}><X size={18} /></button></div><div className="modal-body">{children}</div></div></div>; }
