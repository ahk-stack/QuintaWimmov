import type { Metadata, Viewport } from "next";
import { Caladea, Lato } from "next/font/google";
import "./globals.css";

/*
 * Caladea and Lato are static families, so weights are explicit. Only the
 * weights actually used are declared — every extra one is a preloaded font file
 * the browser fetches and never paints. latin-ext stays because the roster and
 * hotel names carry accented characters.
 *
 * Caladea ships Bold only here: the brand specifies Caladea Bold for headings,
 * and headings are the sole place it is used.
 */
const caladea = Caladea({
  variable: "--font-caladea",
  subsets: ["latin", "latin-ext"],
  weight: ["700"],
  display: "swap",
});

const lato = Lato({
  variable: "--font-lato",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "700"],
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
