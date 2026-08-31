"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/control", label: "Control" },
  { href: "/configuration", label: "Configuration" },
  { href: "/portfolio", label: "Portfolio" },
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-[#1e2433] bg-[#090b10]/95 backdrop-blur-md">
      {/* Top micro status bar */}
      <div className="border-b border-[#151923] bg-[#06070a] px-4 sm:px-6 lg:px-10 py-1 text-[11px] font-mono-code text-zinc-500">
        <div className="mx-auto flex max-w-[1560px] items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
              BASE MAINNET
            </span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">GONKA AI ROUTER: CONNECTED</span>
            <span className="text-zinc-600">|</span>
            <span className="text-amber-400/90 font-medium">SIMULATED ENVIRONMENT</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">BURNER: <span className="text-zinc-300">0x8bbF...a975</span></span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">TTL GUARD: 60s</span>
          </div>
        </div>
      </div>

      {/* Main navigation */}
      <div className="mx-auto flex max-w-[1560px] items-center justify-between px-4 sm:px-6 lg:px-10 py-3">
        {/* Brand Logo */}
        <div className="flex items-center gap-3.5">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative flex h-13 w-13 h-[52px] w-[52px] items-center justify-center shrink-0">
              <Image
                src="/logo.png"
                alt="NutShell Logo"
                width={80}
                height={80}
                className="h-full w-full object-contain drop-shadow-[0_0_14px_rgba(16,185,129,0.4)]"
                priority
              />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-extrabold tracking-wider text-white group-hover:text-emerald-400 transition-colors font-mono-code leading-none">
                NUT<span className="text-emerald-400 font-extrabold">SHELL</span>
              </span>
              <span className="text-[10px] tracking-wider text-zinc-400 uppercase font-mono-code mt-1">
                AI Crisis Detection & Hedging
              </span>
            </div>
          </Link>
        </div>

        {/* Center Nav tabs */}
        <nav className="flex items-center gap-1.5 rounded-lg border border-[#1e2433] bg-[#0e1117] p-1">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/" || pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative rounded-md px-4 py-1.5 text-xs font-semibold uppercase tracking-wider transition-all font-mono-code ${
                  isActive
                    ? "bg-[#1c2331] text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
                    : "text-zinc-400 hover:bg-[#141822] hover:text-zinc-200 border border-transparent"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Right Status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-950/20 px-3 py-1.5 text-xs font-mono-code text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span className="font-semibold tracking-wider">AGENT ARMED</span>
          </div>
        </div>
      </div>
    </header>
  );
}
