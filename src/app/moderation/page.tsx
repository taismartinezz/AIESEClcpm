import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import ModerationHome from "@/components/moderation/ModerationHome";

export const metadata: Metadata = {
  title: `Moderation · ${APP_NAME}`,
  robots: { index: false, follow: false },
};

export default function ModerationPage() {
  return <ModerationHome />;
}
