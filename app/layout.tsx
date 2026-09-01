import type { Metadata, Viewport } from "next";
import { Caladea, Lato } from "next/font/google";
import "./globals.css";

/* Caladea and Lato are static families, so explicit weights are required. */
const caladea = Caladea({
  variable: "--font-caladea",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
  display: "swap",
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "700", "900"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Quinta Lead Hub",
    template: "%s · Quinta Lead Hub",
  },
  description:
    "Internal lead exchange, chat and news for Quinta sales and consultants.",
  /*
   * This deployment is reachable without a sign-in and holds prospect contact
   * details, so it must never be indexed. Also enforced in app/robots.ts.
   */
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${caladea.variable} ${lato.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
