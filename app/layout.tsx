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
          <div className="min-h-screen bg-[#181819] flex flex-col items-center p-4">
            {/* Header */}
            <div className="w-full max-w-5xl flex items-center justify-between mb-6 pt-4">
              <div>
                <h1 className="text-xl font-bold text-[#02E481] font-[var(--font-display)]">
                  Understory
                </h1>
              </div>
              <NavTabs />
            </div>
            {/* Content */}
            <div className="w-full max-w-5xl flex-1">
              {children}
            </div>
          </div>
        </AuthGate>
      </body>
    </html>
  );
}
