import type { Metadata } from "next";
import HelpPageClient from "./HelpPageClient";

export const metadata: Metadata = {
  title: "Help — city listings | Divaro",
  description: "How to use filters, search, map, and account features on the city listings page.",
};

export default function HelpPage() {
  return <HelpPageClient />;
}
