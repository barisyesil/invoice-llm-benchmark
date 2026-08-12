"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Tekli Test", hint: "Bir fatura · birden çok model" },
  { href: "/toplu", label: "Toplu Test", hint: "Bir model · birden çok fatura" },
];

export function SiteHeader({ subtitle }: { subtitle: string }) {
  const pathname = usePathname();

  return (
    <header className="topbar">
      <div className="row" style={{ gap: 22 }}>
        <h1>
          <span className="dot" /> invoice-llm-benchmark
        </h1>
        <nav className="tabs">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`tab${active ? " active" : ""}`}
                title={tab.hint}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="sub">{subtitle}</div>
    </header>
  );
}
