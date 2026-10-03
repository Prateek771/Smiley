import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smiley · Hospital claims desk", template: "%s · Smiley" },
  description: "Manage hospital cashless claims, source evidence, payer queries and discharge coordination in a scoped staff workspace.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
