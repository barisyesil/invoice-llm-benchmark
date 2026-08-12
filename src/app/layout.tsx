import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "invoice-llm-benchmark — Vision LLM Fiş Testi",
  description:
    "Farklı LLM sağlayıcılarının market fişlerinden veri çıkarma doğruluğunu, hızını ve maliyetini karşılaştıran PoC test arayüzü.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
