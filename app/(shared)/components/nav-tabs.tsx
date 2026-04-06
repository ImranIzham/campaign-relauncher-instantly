"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

const TABS = [
  { label: "Relauncher", href: "/" },
  { label: "Creator", href: "/creator" },
];

export function NavTabs() {
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 bg-[#0A0A0A] border border-[#262626] rounded-lg p-1">
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition ${
              isActive
                ? "bg-[#02E481] text-[#071018]"
                : "text-[#808080] hover:text-[#B3B3B3]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
