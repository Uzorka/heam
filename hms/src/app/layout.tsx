import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { Toaster } from "@/components/forms/toaster";

export const metadata: Metadata = {
  title: { default: "Aduraking HMS", template: "%s · Aduraking HMS" },
  description: "Hospital management system for Aduraking Hospital and Maternity",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("hms_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang="en-NG" className={theme === "dark" ? "dark" : undefined}>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow-pop"
        >
          Skip to main content
        </a>
        <Toaster>{children}</Toaster>
      </body>
    </html>
  );
}
