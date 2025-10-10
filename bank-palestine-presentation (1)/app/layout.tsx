import type React from "react"
import type { Metadata } from "next"
import { Noto_Sans_Arabic } from "next/font/google"
import "./globals.css"

const notoSansArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-noto-sans-arabic",
})

export const metadata: Metadata = {
  title: "استراتيجيات الاتصال في بنك فلسطين",
  description: "عرض تقديمي احترافي عن استراتيجيات الاتصال في بنك فلسطين: الوسائل الرقمية، التقليدية، والإعلانات",
    generator: 'v0.app'
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ar" dir="rtl" className={notoSansArabic.variable}>
      <body className="antialiased">{children}</body>
    </html>
  )
}
