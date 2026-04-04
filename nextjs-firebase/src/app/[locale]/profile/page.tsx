import type { Metadata } from "next";
import ProfileClient from "./ProfileClient";

export const metadata: Metadata = {
  title: "Profile - Divaro",
  robots: { index: false, follow: false },
};

export default function ProfilePage() {
  return <ProfileClient />;
}
