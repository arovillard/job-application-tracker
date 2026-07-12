import type { Metadata } from "next";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ThemeProvider } from "../components/ThemeProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Opportunity Tracker",
  description: "Local-first tracker for job opportunities and professional connections"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html data-scroll-behavior="smooth" lang="en">
      <body><ThemeProvider>{children}</ThemeProvider></body>
    </html>
  );
}
