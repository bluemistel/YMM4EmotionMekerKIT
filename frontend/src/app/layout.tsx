import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "YMM4 EmotionMaker KIT",
  description: "YMM4 表情アイテム自動配置ツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
