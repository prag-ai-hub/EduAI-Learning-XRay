import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: "EduAI Learning X-Ray",
    description: "Teacher-approved AI that turns answer scripts into concept-level evidence, targeted practice and proven improvement.",
    icons: { icon: "/brand/shield.png", shortcut: "/brand/shield.png" },
    openGraph: { title: "EduAI Learning X-Ray", description: "Marks tell you who scored. Learning X-Ray tells you why.", images: [`${origin}/og.png`] },
    twitter: { card: "summary_large_image", title: "EduAI Learning X-Ray", description: "Marks tell you who scored. Learning X-Ray tells you why.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
