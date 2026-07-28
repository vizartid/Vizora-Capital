"use client";

import {
  Activity,
  ArrowLeftRight,
  BadgeDollarSign,
  BookOpen,
  Bot,
  ChevronDown,
  FileText,
  LayoutDashboard,
  Menu,
  PackageOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sparkles,
  UserCog,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useVizora } from "../providers/VizoraProvider";

type ActivePage = "dashboard" | "chat" | "invoices" | "transactions" | "customers" | "items" | "team" | "audit" | "settings";

const nav = [
  { id: "dashboard", label: "Ringkasan", href: "/", icon: LayoutDashboard },
  { id: "invoices", label: "Invoice", href: "/invoices", icon: FileText },
  { id: "transactions", label: "Transaksi", href: "/transactions", icon: ArrowLeftRight },
  { id: "customers", label: "Pelanggan", href: "/customers", icon: Users },
  { id: "items", label: "Item & Jasa", href: "/items", icon: PackageOpen },
];

const organizationNav = [
  { id: "team", label: "Tim & Akses", href: "/team", icon: UserCog },
  { id: "audit", label: "Audit log", href: "/audit", icon: Activity },
];

export function AppShell({ active, children }: { active: ActivePage; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { user, membership, business, loading } = useVizora();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!membership) router.replace("/onboarding");
  }, [loading, membership, router, user]);

  async function signOut() {
    await fetch("/api/auth/sign-out", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (loading || !user || !membership || !business) {
    return <main className="onboarding-page"><div className="onboarding-shell"><section className="onboarding-card"><span className="onboarding-icon"><WalletCards size={22} /></span><h1>Menyiapkan ruang kerja…</h1><p>Memuat data bisnis Anda dengan aman.</p></section></div></main>;
  }

  const initials = business.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  const memberInitials = membership.display_name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();

  return (
    <div className={`app-frame ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""} ${menuOpen ? "open" : ""}`}>
        <div className="sidebar-brand-row">
          <Link href="/" className="brand" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark"><WalletCards size={19} strokeWidth={2.4} /></span>
            <span>Vizora</span>
          </Link>
          <button className="mobile-close" onClick={() => setMenuOpen(false)} aria-label="Tutup menu"><X size={20} /></button>
        </div>
        <div className="business-switcher" title={business.name}>
          <span className="business-logo">{initials}</span>
          <span><b>{business.name}</b><small>Business account</small></span>
          <ChevronDown size={15} />
        </div>
        <nav className="main-nav" aria-label="Navigasi utama">
          <span className="nav-label">Workspace</span>
          {nav.map(({ id, label, href, icon: Icon }) => (
            <Link key={id} href={href} title={sidebarCollapsed ? label : undefined} className={`nav-item ${active === id ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              <Icon size={18} /><span>{label}</span>
            </Link>
          ))}
          <span className="nav-label organization-label">Organisasi</span>
          {organizationNav.map(({ id, label, href, icon: Icon }) => (
            <Link key={id} href={href} title={sidebarCollapsed ? label : undefined} className={`nav-item ${active === id ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
              <Icon size={18} /><span>{label}</span>
            </Link>
          ))}
          <span className="nav-label ai-label">Asisten</span>
          <Link href="/chat" title={sidebarCollapsed ? "Vizora AI" : undefined} className={`nav-item ai-nav ${active === "chat" ? "active" : ""}`} onClick={() => setMenuOpen(false)}>
            <Bot size={18} /><span>Vizora AI</span><Sparkles size={13} className="nav-sparkle" />
          </Link>
        </nav>
        <div className="sidebar-tip">
          <span><Sparkles size={15} /></span>
          <b>Percepat kerja Anda</b>
          <p>Buat invoice cukup dengan satu kalimat.</p>
          <Link href="/chat">Mulai percakapan</Link>
        </div>
        <div className="sidebar-bottom">
          <Link href="/pricing" title="Paket & harga"><BadgeDollarSign size={17} /><span>Paket & harga</span></Link>
          <a href="#" title="Pusat bantuan"><BookOpen size={17} /><span>Pusat bantuan</span></a>
          <Link href="/settings" title="Pengaturan"><Settings size={17} /><span>Pengaturan</span></Link>
          <button className="profile-row" title="Keluar dari Vizora" onClick={signOut}>
            <span className="profile-avatar">{memberInitials}</span>
            <span><b>{membership.display_name}</b><small>{membership.role}</small></span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <button
        className="sidebar-collapse"
        onClick={() => setSidebarCollapsed((current) => !current)}
        aria-label={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
        title={sidebarCollapsed ? "Perluas sidebar" : "Ciutkan sidebar"}
      >
        {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
      </button>
      {menuOpen && <button className="sidebar-scrim" aria-label="Tutup menu" onClick={() => setMenuOpen(false)} />}
      <main className="main-area">
        <button className="mobile-menu-button" aria-label="Buka menu" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
        <div className={`page-content ${active === "chat" ? "chat-page-content" : ""}`}>{children}</div>
      </main>
    </div>
  );
}
