"use client";

import { ArrowRight, Bot, Check, CircleCheck, Clock3, FileText, History, MoreHorizontal, Paperclip, PencilLine, Send, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../components/AppShell";
import { insforge } from "../../lib/insforge/client";
import { useVizora } from "../../providers/VizoraProvider";

type Session = { id: string; title: string; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string; message_kind: string; action_draft_id: string | null; created_at: string };
type ActionDraft = { id: string; action_type: string; status: "pending" | "approved" | "rejected" | "failed"; preview: Record<string, unknown>; executed_entity_id?: string | null };

const money = (value: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));

export default function ChatPage() {
  const router = useRouter();
  const { business } = useVizora();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({});
  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const composerInput = useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    if (!business) return;
    const result = await insforge.database.from("chat_sessions").select("id, title, updated_at").eq("business_id", business.id).order("updated_at", { ascending: false });
    if (result.data) setSessions(result.data as Session[]);
  }, [business]);

  const loadMessages = useCallback(async (sessionId: string) => {
    const result = await insforge.database.from("chat_messages").select("id, role, content, message_kind, action_draft_id, created_at").eq("session_id", sessionId).order("created_at");
    if (result.data) {
      const rows = result.data as Message[];
      setMessages(rows);
      const actionIds = rows.map(row => row.action_draft_id).filter(Boolean) as string[];
      if (actionIds.length) {
        const actionResult = await insforge.database.from("action_drafts").select("id, action_type, status, preview, executed_entity_id").in("id", actionIds);
        if (actionResult.data) setDrafts(Object.fromEntries((actionResult.data as ActionDraft[]).map(draft => [draft.id, draft])));
      } else setDrafts({});
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void loadSessions(); }, 0); return () => window.clearTimeout(timer); }, [loadSessions]);
  useEffect(() => { const timer = window.setTimeout(() => { if (activeSession) void loadMessages(activeSession); else setMessages([]); }, 0); return () => window.clearTimeout(timer); }, [activeSession, loadMessages]);

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || !business || sending) return;
    setSending(true); setError(""); setInput("");
    const optimistic: Message = { id: `local-${Date.now()}`, role: "user", content: text, message_kind: "text", action_draft_id: null, created_at: new Date().toISOString() };
    setMessages(current => [...current, optimistic]);
    const result = await insforge.functions.invoke("finance-api", { body: { action: "chat", businessId: business.id, sessionId: activeSession, message: text } });
    if (result.error) { setError(result.error.message); setMessages(current => current.filter(row => row.id !== optimistic.id)); setSending(false); return; }
    const data = result.data as { sessionId: string; actionDraft?: ActionDraft | null };
    setActiveSession(data.sessionId);
    await Promise.all([loadMessages(data.sessionId), loadSessions()]);
    setSending(false);
  }

  async function reviewAction(actionId: string, decision: "approve" | "reject") {
    setError("");
    const result = await insforge.database.rpc(decision === "approve" ? "approve_ai_action" : "reject_ai_action", { p_action_id: actionId });
    if (result.error) { setError(result.error.message); return; }
    if (activeSession) await loadMessages(activeSession);
  }

  function editAction(draft: ActionDraft) {
    const subject = draft.action_type === "create_transaction" ? "transaksi" : draft.action_type === "create_invoice" ? "invoice" : "pengingat invoice";
    const prompt = `Ubah draft ${subject} ini: `;
    setInput(prompt);
    window.requestAnimationFrame(() => {
      composerInput.current?.focus();
      composerInput.current?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function openSavedData(draft: ActionDraft) {
    if (draft.action_type === "create_transaction") {
      router.push("/transactions");
      return;
    }
    if (draft.action_type === "create_invoice" && draft.executed_entity_id) {
      router.push(`/invoices/detail?id=${draft.executed_entity_id}`);
      return;
    }
    router.push("/invoices");
  }

  const activeTitle = useMemo(() => sessions.find(session => session.id === activeSession)?.title ?? "Percakapan baru", [activeSession, sessions]);

  return <AppShell active="chat"><div className="chat-layout">
    <aside className={`chat-history ${historyOpen ? "open" : ""}`}>
      <div className="history-heading"><span><History size={16} /> Riwayat percakapan</span><button aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)}><X size={17} /></button></div>
      <button className="new-chat-button" onClick={() => { setActiveSession(null); setMessages([]); }}><Sparkles size={16} /> Percakapan baru</button>
      <div className="history-list"><span className="history-label">Terbaru</span>{sessions.map(session => <button className={`history-item ${session.id === activeSession ? "active" : ""}`} key={session.id} onClick={() => { setActiveSession(session.id); setHistoryOpen(false); }}><span><b>{session.title}</b><small>{new Date(session.updated_at).toLocaleDateString("id-ID")}</small></span>{session.id === activeSession && <MoreHorizontal size={15} />}</button>)}</div>
      <div className="history-note"><ShieldCheck size={16} /><p><b>Ruang kerja aman</b><br />AI hanya menggunakan data {business?.name}.</p></div>
    </aside>
    {historyOpen && <button className="history-scrim" aria-label="Tutup riwayat" onClick={() => setHistoryOpen(false)} />}

    <section className="chat-workspace">
      <header className="chat-header"><button className="history-toggle" onClick={() => setHistoryOpen(true)} aria-label="Buka riwayat"><History size={18} /></button><div className="ai-avatar"><Sparkles size={19} /></div><div><h1>Vizora AI</h1><p><i /> {activeTitle}</p></div><div className="safe-mode"><ShieldCheck size={15} /> Semua aksi butuh persetujuan</div></header>
      <div className="messages" aria-live="polite">
        {messages.length === 0 && <div className="message-row assistant-message"><div className="small-avatar ai"><Bot size={16} /></div><div className="message-bubble rich"><p>Saya siap menjawab pertanyaan berdasarkan data bisnis Anda atau menyiapkan tindakan untuk diperiksa. Tidak ada perubahan yang dilakukan tanpa persetujuan.</p></div></div>}
        {messages.map(message => {
          const draft = message.action_draft_id ? drafts[message.action_draft_id] : null;
          return <div className={`message-row ${message.role === "user" ? "user-message" : "assistant-message"}`} key={message.id}>
            {message.role === "assistant" && <div className="small-avatar ai"><Bot size={16} /></div>}
            <div className={`assistant-stack ${draft ? "wide" : ""}`}>
              <div className={`message-bubble ${message.role === "assistant" ? "rich" : ""}`}><p>{message.content}</p></div>
              {draft && <DraftCard draft={draft} onDecision={reviewAction} onEdit={editAction} onOpenSaved={openSavedData} />}
              {message.role === "assistant" && <span className="message-meta"><ShieldCheck size={12} /> Dijawab dari data bisnis Anda</span>}
            </div>
            {message.role === "user" && <div className="small-avatar"><UserRound size={15} /></div>}
          </div>;
        })}
        {sending && <div className="message-row assistant-message"><div className="small-avatar ai"><Bot size={16} /></div><div className="message-bubble">Menganalisis data bisnis…</div></div>}
        {error && <div className="rejected-card"><Trash2 size={18} /><div><h3>Permintaan belum selesai</h3><p>{error}</p></div></div>}
      </div>
      <footer className="composer-area"><div className="prompt-chips"><button onClick={() => setInput("Ringkas arus kas bulan ini")}>Ringkas arus kas</button><button onClick={() => setInput("Buat pengingat untuk invoice terlambat")}>Buat pengingat</button><button onClick={() => setInput("Catat pengeluaran baru")}>Catat pengeluaran</button></div><form className="composer" onSubmit={submitMessage}><button type="button" aria-label="Lampirkan file"><Paperclip size={18} /></button><input ref={composerInput} value={input} onChange={event => setInput(event.target.value)} placeholder="Tanya apa pun tentang keuangan bisnis Anda..." aria-label="Pesan untuk Vizora AI" /><span className="composer-hint">Enter untuk kirim</span><button className="send-button" type="submit" aria-label="Kirim pesan" disabled={sending}><Send size={17} /></button></form><p>Vizora dapat membuat kesalahan. Selalu periksa detail keuangan sebelum menyetujui.</p></footer>
    </section>
  </div></AppShell>;
}

function DraftCard({ draft, onDecision, onEdit, onOpenSaved }: { draft: ActionDraft; onDecision: (id: string, decision: "approve" | "reject") => Promise<void>; onEdit: (draft: ActionDraft) => void; onOpenSaved: (draft: ActionDraft) => void }) {
  if (draft.status === "approved") return <div className="success-card"><span className="success-icon"><CircleCheck size={23} /></span><div><h3>Tindakan berhasil dijalankan</h3><p>Persetujuan tercatat di audit log.</p></div>{draft.executed_entity_id && <button type="button" onClick={() => onOpenSaved(draft)}>Data tersimpan <ArrowRight size={14} /></button>}</div>;
  if (draft.status === "rejected") return <div className="rejected-card"><Trash2 size={20} /><div><h3>Draft ditolak</h3><p>Tidak ada data yang dibuat atau diubah.</p></div></div>;
  const preview = draft.preview ?? {};
  const invoiceItems = Array.isArray(preview.items) ? preview.items as Record<string, unknown>[] : [];
  return <article className="draft-card"><div className="draft-card-header"><div><span className="draft-icon"><FileText size={19} /></span><span><small>PRATINJAU TINDAKAN</small><h2>{draft.action_type === "create_invoice" ? "Invoice baru" : draft.action_type === "create_transaction" ? "Transaksi baru" : "Pengingat invoice"}</h2></span></div><span className="draft-badge">DRAFT · BELUM DISIMPAN</span></div>
    {draft.action_type === "create_invoice" && <><div className="draft-party-row"><div><small>PELANGGAN</small><b>{String(preview.customer_id ?? "")}</b></div><div><small>JATUH TEMPO</small><b>{String(preview.due_date ?? "")}</b><span><Clock3 size={13} /> Periksa tanggal</span></div></div>{invoiceItems.map((item, index) => <div className="draft-item-row" key={index}><span><b>{String(item.description)}</b></span><span>{String(item.quantity)}</span><span>{money(item.unit_price)}</span><strong>{money(Number(item.quantity) * Number(item.unit_price))}</strong></div>)}</>}
    {draft.action_type === "create_transaction" && <div className="draft-party-row"><div><small>TRANSAKSI</small><b>{String(preview.name ?? "")}</b><span>{String(preview.category ?? "")}</span></div><div><small>JUMLAH</small><b>{money(preview.amount)}</b></div></div>}
    <div className="draft-safety"><ShieldCheck size={15} /><span><b>Menunggu persetujuan Anda</b> — Vizora belum mengubah data.</span></div><div className="draft-actions"><button className="button primary" onClick={() => void onDecision(draft.id, "approve")}><Check size={16} /> Setujui &amp; jalankan</button><button className="button secondary" type="button" onClick={() => onEdit(draft)}><PencilLine size={15} /> Edit lewat chat</button><button className="button quiet-danger" onClick={() => void onDecision(draft.id, "reject")}><Trash2 size={15} /> Tolak</button></div>
  </article>;
}
