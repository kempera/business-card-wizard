import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Business Card Wizard",
  description: "AI OCR, CRM review, enrichment, Salesforce push, and vCard export for business cards.",
  creator: "Dr. Andreas Kemper",
  publisher: "Dr. Andreas Kemper"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
