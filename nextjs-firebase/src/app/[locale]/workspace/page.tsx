import type { Metadata } from "next";
import ProfileClient from "../profile/ProfileClient";

export const metadata: Metadata = {
  title: "My workspace - Koochly",
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <ProfileClient showWorkspaceHeader />;
}
