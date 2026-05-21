import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/contexts/AuthContext";

export const metadata: Metadata = {
  title: "WhiterChat | منصة تواصل اجتماعي عربية",
  description: "WhiterChat منصة تواصل اجتماعي عربية لمشاركة الصور والمنشورات والتفاعل بين المستخدمين.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
