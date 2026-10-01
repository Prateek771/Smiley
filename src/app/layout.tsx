import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Smiley · Hospital claims desk", template: "%s · Smiley" },
  description: "Explore the Smiley cashless-discharge workflow with fictional cases, evidence, and clearly separated financial facts.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
