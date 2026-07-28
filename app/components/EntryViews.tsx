"use client";

import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  Globe2,
  LockKeyhole,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
  WalletCards,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { insforge } from "../lib/insforge/client";
import { paymentPlans, type BillingCycle, type PaymentPlan } from "../lib/payments/plans";
import { useVizora } from "../providers/VizoraProvider";

function EntryBrand() { return <Link className="entry-brand" href="/"><span><WalletCards size={19} /></span>Vizora</Link>; }

async function postAuth<T>(url: string, payload: Record<string, string>): Promise<{ response: Response; result: T }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({ error: "Respons server tidak valid" })) as T;
    return { response, result };
  } finally {
    window.clearTimeout(timeout);
  }
}

function authErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "Permintaan terlalu lama. Periksa koneksi lalu coba lagi.";
  return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
}

export function LoginView() {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const { user, loading: sessionLoading } = useVizora();

  useEffect(() => {
    if (!sessionLoading && user) window.location.replace("/");
  }, [sessionLoading, user]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const { response, result } = await postAuth<{ error?: string }>("/api/auth/sign-in", { email, password });
      if (!response.ok) { setError(result.error ?? "Tidak dapat masuk"); return; }
      window.location.assign("/");
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  return <main className="entry-page"><section className="entry-form-side"><EntryBrand /><div className="entry-form-wrap"><span className="entry-kicker">Selamat datang kembali</span><h1>Masuk ke ruang kerja Anda</h1><p>Pantau arus kas dan selesaikan penagihan lebih cepat.</p><form onSubmit={submit} className="entry-form"><label><span>Email</span><div><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></div></label><label><span>Kata sandi <Link href="/forgot-password">Lupa kata sandi?</Link></span><div><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" minLength={6} required /></div></label>{error && <p role="alert" className="danger-text">{error}</p>}<button className="entry-primary" disabled={loading || sessionLoading}>{loading ? "Membuka ruang kerja..." : sessionLoading ? "Memeriksa sesi..." : <>Masuk <ArrowRight size={16} /></>}</button></form><div className="entry-separator"><span>atau</span></div><Link href="/api/auth/oauth?provider=google" className="google-button"><Globe2 size={17} /> Lanjutkan dengan Google</Link><p className="entry-switch">Belum punya akun? <Link href="/signup">Mulai gratis</Link></p></div><span className="entry-legal">Dengan masuk, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi Vizora.</span></section><EntryStory /></main>;
}

export function ForgotPasswordView() {
  const [step, setStep] = useState<"request" | "reset" | "done">("request");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function requestCode(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const { response, result } = await postAuth<{ error?: string }>("/api/auth/password-reset/request", { email });
      if (!response.ok) { setError(result.error ?? "Tidak dapat mengirim kode pemulihan"); return; }
      setStep("reset");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  async function resetPassword(event: FormEvent) {
    event.preventDefault(); setError("");
    if (password !== confirmation) { setError("Konfirmasi kata sandi tidak cocok"); return; }
    setLoading(true);
    try {
      const { response, result } = await postAuth<{ error?: string }>("/api/auth/password-reset/confirm", { email, code, password });
      if (!response.ok) { setError(result.error ?? "Tidak dapat mengubah kata sandi"); return; }
      setPassword(""); setConfirmation(""); setCode(""); setStep("done");
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return <main className="entry-page"><section className="entry-form-side"><EntryBrand /><div className="entry-form-wrap signup"><span className="entry-kicker">Pemulihan akun</span><h1>{step === "done" ? "Kata sandi diperbarui" : step === "reset" ? "Masukkan kode pemulihan" : "Atur ulang kata sandi"}</h1><p>{step === "done" ? "Anda sekarang dapat masuk menggunakan kata sandi baru." : step === "reset" ? `Masukkan kode 6 digit yang dikirim ke ${email}, lalu pilih kata sandi baru.` : "Kami akan mengirim kode 6 digit ke email akun Vizora Anda."}</p>{step === "request" && <form className="entry-form" onSubmit={requestCode}><label><span>Email</span><div><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required autoFocus /></div></label>{error && <p role="alert" className="danger-text">{error}</p>}<button className="entry-primary" disabled={loading}>{loading ? "Mengirim kode..." : <>Kirim kode pemulihan <ArrowRight size={16} /></>}</button></form>}{step === "reset" && <form className="entry-form" onSubmit={resetPassword}><label><span>Kode 6 digit</span><div><BadgeCheck size={16} /><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} autoComplete="one-time-code" required autoFocus /></div></label><label><span>Kata sandi baru</span><div><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div><small>Minimal 8 karakter</small></label><label><span>Konfirmasi kata sandi</span><div><LockKeyhole size={16} /><input type="password" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></div></label>{error && <p role="alert" className="danger-text">{error}</p>}<button className="entry-primary" disabled={loading || code.length !== 6}>{loading ? "Memperbarui..." : <>Simpan kata sandi baru <ArrowRight size={16} /></>}</button><button type="button" className="google-button" onClick={() => { setStep("request"); setCode(""); setError(""); }} disabled={loading}>Kirim ulang kode</button></form>}{step === "done" && <Link href="/login" className="entry-primary">Kembali ke halaman masuk <ArrowRight size={16} /></Link>}<p className="entry-switch">Ingat kata sandi Anda? <Link href="/login">Kembali untuk masuk</Link></p></div><span className="entry-legal">Kode pemulihan hanya berlaku sementara dan tidak pernah disimpan oleh Vizora.</span></section><EntryStory /></main>;
}

export function SignupView() {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const { response, result } = await postAuth<{ error?: string; requireEmailVerification?: boolean }>("/api/auth/sign-up", { name, email, password });
      if (!response.ok) { setError(result.error ?? "Pendaftaran gagal"); return; }
      if (result.requireEmailVerification) { setVerify(true); return; }
      window.location.assign("/onboarding");
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  async function verifyCode(event: FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const { response, result } = await postAuth<{ error?: string }>("/api/auth/verify", { email, otp });
      if (!response.ok) { setError(result.error ?? "Kode tidak valid"); return; }
      window.location.assign("/onboarding");
    } catch (error) {
      setError(authErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }
  return <main className="entry-page"><section className="entry-form-side"><EntryBrand /><div className="entry-form-wrap signup"><span className="entry-kicker">14 hari gratis · Tanpa kartu kredit</span><h1>{verify ? "Verifikasi email Anda" : "Bangun arus kas yang lebih rapi"}</h1><p>{verify ? `Masukkan kode 6 digit yang dikirim ke ${email}.` : "Buat akun untuk mulai menyiapkan profil bisnis Anda."}</p>{verify ? <form onSubmit={verifyCode} className="entry-form"><label><span>Kode verifikasi</span><div><BadgeCheck size={16} /><input inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={otp} onChange={event => setOtp(event.target.value.replace(/\D/g, ""))} autoFocus required /></div></label>{error && <p role="alert" className="danger-text">{error}</p>}<button className="entry-primary" disabled={loading || otp.length !== 6}>{loading ? "Memverifikasi..." : <>Verifikasi &amp; lanjutkan <ArrowRight size={16} /></>}</button></form> : <form onSubmit={submit} className="entry-form"><label><span>Nama lengkap</span><div><UserRound size={16} /><input value={name} onChange={event => setName(event.target.value)} autoComplete="name" required /></div></label><label><span>Email kerja</span><div><Mail size={16} /><input type="email" value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" required /></div></label><label><span>Kata sandi</span><div><LockKeyhole size={16} /><input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div><small>Minimal 8 karakter</small></label>{error && <p role="alert" className="danger-text">{error}</p>}<button className="entry-primary" disabled={loading}>{loading ? "Menyiapkan akun..." : <>Buat akun gratis <ArrowRight size={16} /></>}</button></form>}<p className="entry-switch">Sudah punya akun? <Link href="/login">Masuk</Link></p></div><span className="entry-legal">Dengan membuat akun, Anda menyetujui Ketentuan Layanan dan Kebijakan Privasi Vizora.</span></section><EntryStory /></main>;
}

function EntryStory() { return <aside className="entry-story"><div className="entry-story-copy"><span><Sparkles size={15} /> Asisten keuangan untuk bisnis modern</span><h2>Lebih sedikit administrasi.<br />Lebih banyak kendali.</h2><p>Vizora menyatukan invoice, arus kas, dan AI dalam satu ruang kerja yang tetap berada di bawah persetujuan Anda.</p></div><div className="entry-preview"><div className="entry-preview-top"><span><BarChart3 size={16} /> Arus kas Juli</span><b>+12,4%</b></div><strong>Rp128,4 jt</strong><div className="entry-bars">{[32,48,42,62,54,78,67,88,72,94].map((n,i)=><i key={i} style={{height:`${n}%`}} />)}</div><div className="entry-ai-card"><span><Sparkles size={16} /></span><p><b>Draft invoice siap diperiksa</b><small>Klien Busa · Rp5.000.000</small></p><button><Check size={14} /> Setujui</button></div></div><div className="entry-proof"><span><ShieldCheck size={17} /> Setiap aksi AI memerlukan persetujuan</span><span><BadgeCheck size={17} /> Data bisnis terisolasi dan aman</span></div></aside>; }

export function OnboardingView() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [currency, setCurrency] = useState("IDR");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("Agensi kreatif");
  const [teamSize, setTeamSize] = useState("2–10 orang");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { user, membership, refresh } = useVizora();
  async function next() {
    if (step === 1) { if (!name.trim()) { setError("Nama bisnis wajib diisi"); return; } setError(""); setStep(2); return; }
    if (step === 2) {
      if (!user) { router.push("/login"); return; }
      if (membership) { setStep(3); return; }
      setSaving(true); setError("");
      const result = await insforge.database.rpc("create_business", { p_name: name.trim(), p_industry: industry, p_team_size: teamSize, p_country: "Indonesia", p_currency: currency, p_display_name: String(user.profile?.name ?? "") || undefined });
      if (result.error) { setError(result.error.message); setSaving(false); return; }
      await refresh(); setSaving(false); setStep(3); return;
    }
    router.push("/"); router.refresh();
  }
  return <main className="onboarding-page"><header><EntryBrand /><span>Sudah punya akun? <Link href="/login">Masuk</Link></span></header><div className="onboarding-shell"><div className="onboarding-progress">{[1,2,3].map(n => <div key={n} className={step >= n ? "active" : ""}><span>{step > n ? <Check size={14} /> : n}</span><p><b>{["Profil bisnis","Preferensi","Selesai"][n-1]}</b><small>{["Identitas perusahaan","Mata uang & invoice","Ruang kerja siap"][n-1]}</small></p>{n<3 && <i />}</div>)}</div><section className="onboarding-card">{step === 1 && <><span className="onboarding-icon"><WalletCards size={22} /></span><h1>Ceritakan tentang bisnis Anda</h1><p>Informasi ini akan digunakan pada invoice dan laporan.</p><div className="onboarding-form"><label><span>Nama bisnis</span><input value={name} onChange={event => setName(event.target.value)} /></label><label><span>Bidang usaha</span><select value={industry} onChange={event => setIndustry(event.target.value)}><option>Agensi kreatif</option><option>Konsultan</option><option>Freelancer</option></select></label><label><span>Ukuran tim</span><select value={teamSize} onChange={event => setTeamSize(event.target.value)}><option>2–10 orang</option><option>Hanya saya</option><option>11–50 orang</option></select></label><label><span>Negara</span><select><option>Indonesia</option></select></label></div></>}
        {step === 2 && <><span className="onboarding-icon"><Globe2 size={22} /></span><h1>Atur preferensi keuangan</h1><p>Anda dapat mengubah pengaturan ini kapan saja.</p><div className="currency-options">{[{id:"IDR",name:"Rupiah Indonesia",symbol:"Rp"},{id:"USD",name:"US Dollar",symbol:"$"},{id:"SGD",name:"Singapore Dollar",symbol:"S$"}].map(item=><button key={item.id} className={currency===item.id?"active":""} onClick={()=>setCurrency(item.id)}><span>{item.symbol}</span><p><b>{item.id}</b><small>{item.name}</small></p>{currency===item.id&&<CheckCircle2 size={18}/>}</button>)}</div><div className="onboarding-form"><label><span>Jangka waktu pembayaran default</span><select><option>14 hari</option><option>30 hari</option></select></label><label><span>Pajak default</span><select><option>PPN 10%</option><option>Tanpa pajak</option></select></label></div></>}
        {step === 3 && <div className="onboarding-done"><span><CheckCircle2 size={34} /></span><h1>Ruang kerja Anda siap</h1><p>{name} kini siap membuat invoice dan memantau arus kas bersama Vizora.</p><div><span><Check size={15} /> Profil bisnis tersimpan</span><span><Check size={15} /> Mata uang {currency} dipilih</span><span><Check size={15} /> Persetujuan AI diaktifkan</span></div></div>}
        {error && <p role="alert" className="danger-text">{error}</p>}<footer><button className="onboarding-back" onClick={()=>setStep(Math.max(1,step-1))} disabled={step===1 || saving}>Kembali</button><button className="entry-primary" onClick={next} disabled={saving}>{saving ? "Menyiapkan ruang kerja..." : step===3?"Buka dashboard":"Lanjutkan"}<ArrowRight size={16}/></button></footer></section><p className="demo-note"><ShieldCheck size={14}/> Data bisnis dilindungi dengan akses berbasis peran.</p></div></main>;
}

type SubscriptionSummary = {
  plan_id: string;
  billing_cycle: BillingCycle;
  status: string;
  current_period_end: string;
};

const terminalPaymentStatuses = new Set(["paid", "failed", "cancelled", "expired", "refunded"]);

export function PricingView() {
  const [yearly, setYearly] = useState(true);
  const [openFaq, setOpenFaq] = useState(0);
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [paymentNotice, setPaymentNotice] = useState("");
  const [subscription, setSubscription] = useState<SubscriptionSummary | null>(null);
  const { user, business, membership } = useVizora();
  const searchParams = useSearchParams();
  const billingCycle: BillingCycle = yearly ? "yearly" : "monthly";
  const accessNotice = searchParams.get("payment") === "required"
    ? "Paket aktif diperlukan untuk mengakses dashboard. Pilih paket untuk melanjutkan."
    : "";

  const loadSubscription = useCallback(async () => {
    if (!business) { setSubscription(null); return; }
    const result = await insforge.database.from("business_subscriptions")
      .select("plan_id, billing_cycle, status, current_period_end")
      .eq("business_id", business.id)
      .maybeSingle();
    if (!result.error) setSubscription(result.data as SubscriptionSummary | null);
  }, [business]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSubscription(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSubscription]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("order_id");
    if (!orderId || !/^Vizora-[0-9a-f]{32}$/i.test(orderId)) return;

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    async function checkPayment() {
      attempts += 1;
      const response = await fetch(`/api/payments/midtrans/status?orderId=${encodeURIComponent(orderId!)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({})) as { payment?: { status?: string }; error?: string };
      if (cancelled) return;
      const status = result.payment?.status;
      if (status === "paid") {
        setPaymentNotice("Pembayaran berhasil dikonfirmasi. Paket Vizora Anda sudah aktif.");
        await loadSubscription();
        return;
      }
      if (status && terminalPaymentStatuses.has(status)) {
        setPaymentNotice("Pembayaran belum berhasil. Anda dapat memilih paket dan mencoba kembali.");
        return;
      }
      setPaymentNotice("Pembayaran sedang menunggu konfirmasi Midtrans.");
      if (attempts < 6) timer = window.setTimeout(() => { void checkPayment(); }, 2_500);
    }
    void checkPayment();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [loadSubscription, user]);

  async function startCheckout(plan: PaymentPlan) {
    setCheckoutError("");
    if (!user) {
      window.location.assign(`/signup?plan=${plan.id}&billing=${billingCycle}`);
      return;
    }
    if (!business || !membership) {
      window.location.assign(`/onboarding?plan=${plan.id}&billing=${billingCycle}`);
      return;
    }
    if (membership.role !== "administrator") {
      setCheckoutError("Hanya administrator ruang kerja yang dapat membeli atau mengganti paket.");
      return;
    }

    setCheckoutPlan(plan.id);
    try {
      const response = await fetch("/api/payments/midtrans/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({
          businessId: business.id,
          planId: plan.id,
          billingCycle,
          checkoutAttemptId: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({})) as { redirectUrl?: string; error?: string };
      if (!response.ok || !result.redirectUrl) throw new Error(result.error ?? "Checkout Midtrans tidak tersedia");
      window.location.assign(result.redirectUrl);
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? cause.message : "Tidak dapat membuka checkout Midtrans");
      setCheckoutPlan(null);
    }
  }

  return <main className="pricing-page">
    <nav className="marketing-nav"><EntryBrand /><div><a href="#fitur">Fitur</a><a href="#harga">Harga</a><a href="#faq">FAQ</a></div><span>{user ? <Link href="/">Dashboard</Link> : <Link href="/login">Masuk</Link>}<Link href={user ? "/" : "/signup"} className="marketing-cta">{user ? "Ruang kerja" : "Mulai gratis"} <ArrowRight size={14}/></Link></span></nav>
    <header className="pricing-hero"><span><Sparkles size={15}/> Harga sederhana, tanpa biaya tersembunyi</span><h1>Pilih ruang tumbuh<br/>untuk bisnis Anda</h1><p>Mulai gratis selama 14 hari. Tingkatkan paket ketika operasional Anda membutuhkannya.</p><div className="billing-toggle"><button className={!yearly?"active":""} onClick={()=>setYearly(false)}>Bulanan</button><button className={yearly?"active":""} onClick={()=>setYearly(true)}>Tahunan <i>Hemat 20%</i></button></div></header>
    {(accessNotice || paymentNotice || checkoutError) && <div className={`payment-notice ${checkoutError ? "error" : ""}`} role="status" aria-live="polite">{checkoutError || paymentNotice || accessNotice}</div>}
    {subscription?.status === "active" && <div className="active-plan-note"><BadgeCheck size={16}/> Paket <b>{paymentPlans.find(plan => plan.id === subscription.plan_id)?.name ?? subscription.plan_id}</b> aktif sampai {new Intl.DateTimeFormat("id-ID", { dateStyle: "long" }).format(new Date(subscription.current_period_end))}.</div>}
    <section id="harga" className="pricing-grid">{paymentPlans.map(plan => {
      const active = subscription?.status === "active" && subscription.plan_id === plan.id && subscription.billing_cycle === billingCycle;
      return <article className={`price-card ${plan.popular?"popular":""}`} key={plan.id}>{plan.popular&&<span className="popular-label"><Sparkles size={13}/> Paling populer</span>}<h2>{plan.name}</h2><p>{plan.note}</p><div className="price"><span>Rp</span><strong>{plan.displayMonthly[billingCycle]}</strong><div><b>rb</b><small>/bulan</small></div></div>{yearly&&<p className="billed-note">Ditagih Rp{new Intl.NumberFormat("id-ID").format(plan.prices.yearly)} per tahun</p>}<button type="button" className="plan-cta" disabled={checkoutPlan !== null || active} onClick={()=>void startCheckout(plan)}>{checkoutPlan===plan.id ? "Membuka Midtrans..." : active ? "Paket aktif" : plan.cta}<ArrowRight size={15}/></button><div className="plan-limits"><span><Users size={15}/>{plan.users}</span><span><FileCheck2 size={15}/>{plan.invoices}</span><span><MessageSquareText size={15}/>{plan.ai}</span></div><ul>{plan.features.map(item=><li key={item}><Check size={14}/>{item}</li>)}</ul></article>;
    })}</section>
    <section id="fitur" className="pricing-assurance"><div><span><ShieldCheck size={21}/></span><h3>Kontrol manusia tetap utama</h3><p>Vizora tidak pernah mengirim atau mengubah data tanpa persetujuan eksplisit.</p></div><div><span><Zap size={21}/></span><h3>Siap dalam hitungan menit</h3><p>Masukkan profil bisnis, pilih mata uang, lalu mulai membuat invoice.</p></div><div><span><BadgeCheck size={21}/></span><h3>Pembayaran terverifikasi</h3><p>Status paket hanya diaktifkan setelah notifikasi Midtrans diverifikasi server.</p></div></section>
    <section id="faq" className="pricing-faq"><span className="entry-kicker">Pertanyaan umum</span><h2>Yang perlu Anda ketahui</h2><div>{[{q:"Apakah saya perlu kartu kredit untuk mencoba?",a:"Tidak. Masa uji coba 14 hari dapat dimulai tanpa kartu kredit."},{q:"Apakah Vizora langsung mengirim invoice dari chat?",a:"Tidak. Setiap draft harus diperiksa dan disetujui sebelum dibuat atau dikirim."},{q:"Bisakah saya mengubah paket kapan saja?",a:"Ya. Administrator dapat memilih paket baru dari halaman ini; masa aktif diperbarui setelah pembayaran terkonfirmasi."},{q:"Bagaimana pembayaran dikonfirmasi?",a:"Vizora memverifikasi signature notifikasi dan mengecek ulang status transaksi ke Midtrans sebelum mengaktifkan paket."}].map((item,index)=><article key={item.q} className={openFaq===index?"open":""}><button onClick={()=>setOpenFaq(openFaq===index?-1:index)}><b>{item.q}</b><ChevronDown size={18}/></button>{openFaq===index&&<p>{item.a}</p>}</article>)}</div></section>
    <section className="pricing-final"><span><WalletCards size={22}/></span><h2>Keuangan bisnis, lebih jernih.</h2><p>Mulai rapikan invoice dan arus kas bersama Vizora hari ini.</p><Link href={user ? "#harga" : "/signup"}>{user ? "Pilih paket" : "Mulai gratis 14 hari"} <ArrowRight size={16}/></Link></section>
    <footer className="marketing-footer"><EntryBrand/><p>© 2026 Vizora. Dibuat untuk bisnis Indonesia.</p><div><a href="#">Privasi</a><a href="#">Ketentuan</a></div></footer>
  </main>;
}
