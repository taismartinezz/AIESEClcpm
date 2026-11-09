import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import ModeratorSignIn from "@/components/auth/ModeratorSignIn";

// Sign-in for app moderators only. Not linked from anywhere: moderators get
// the address directly, and search engines leave it out.
export const metadata: Metadata = {
  title: `Moderators · ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function ModeratorsPage() {
  return <ModeratorSignIn />;
}
