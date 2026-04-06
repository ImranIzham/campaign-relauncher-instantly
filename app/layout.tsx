import type { Metadata } from "next";
import { Montserrat, Unbounded, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthGate } from "./(shared)/components/auth-gate";
import { NavTabs } from "./(shared)/components/nav-tabs";

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin"],
  weight: ["400", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Campaign Tools — Understory",
  description: "Relaunch and create email campaigns with one click",
  icons: {
    icon: "/favicon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${montserrat.variable} ${unbounded.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthGate>
          <div className="min-h-screen bg-[#0d1117] flex flex-col items-center p-4 relative">
            {/* Flowing lines background */}
            <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
              <svg
                className="absolute w-full h-full opacity-[0.06]"
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid slice"
              >
                <defs>
                  <pattern id="flow" x="0" y="0" width="200" height="120" patternUnits="userSpaceOnUse">
                    <path d="M-40 90 C20 50, 80 70, 140 40 S260 10, 300 40" stroke="#02E481" strokeWidth="1.5" fill="none" opacity="0.9"/>
                    <path d="M-40 110 C20 70, 80 90, 140 60 S260 30, 300 60" stroke="#02E481" strokeWidth="0.8" fill="none" opacity="0.5"/>
                    <path d="M-40 60 C20 30, 80 50, 140 20 S260 0, 300 20" stroke="#02E481" strokeWidth="1" fill="none" opacity="0.6"/>
                  </pattern>
                  <pattern id="flow2" x="100" y="60" width="200" height="120" patternUnits="userSpaceOnUse">
                    <path d="M-40 80 C30 40, 90 65, 150 30 S270 5, 310 35" stroke="#02E481" strokeWidth="1.2" fill="none" opacity="0.4"/>
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#flow)" />
                <rect width="100%" height="100%" fill="url(#flow2)" />
              </svg>
              <div
                className="absolute inset-0"
                style={{ background: "radial-gradient(ellipse 90% 70% at 50% 30%, rgba(13,17,23,0) 0%, rgba(13,17,23,0.92) 70%)" }}
              />
            </div>
            {/* Header */}
            <div className="w-full max-w-5xl flex items-center justify-between mb-6 pt-4 relative z-10">
              <div>
                <h1 className="text-xl font-bold text-[#02E481] font-[var(--font-display)]">
                  Understory
                </h1>
              </div>
              <NavTabs />
            </div>
            {/* Content */}
            <div className="w-full max-w-5xl flex-1 relative z-10">
              {children}
            </div>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
