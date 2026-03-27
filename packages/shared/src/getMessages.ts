import type { Locale } from "./config";
import type { Messages } from "./messages/fa";
import fa from "./messages/fa";
import en from "./messages/en";

export function getMessages(locale: Locale): Messages {
  return locale === "en" ? en : fa;
}
