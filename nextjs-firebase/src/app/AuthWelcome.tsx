"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import { getAuthClientOrNull } from "../lib/firebaseClient";
import { useI18n } from "../i18n/client";
import styles from "./AuthWelcome.module.css";

function welcomeLabel(user: User, fallback: string): string {
  const dn = typeof user.displayName === "string" ? user.displayName.trim() : "";
  if (dn) return dn;
  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (email) {
    const local = email.split("@")[0]?.trim();
    if (local) return local;
    return email;
  }
  const phone = typeof user.phoneNumber === "string" ? user.phoneNumber.trim() : "";
  if (phone) return phone;
  return fallback;
}

export function AuthWelcome() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const auth = getAuthClientOrNull();
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  if (!user) return null;

  return (
    <div className={styles.box}>
      <div className={styles.welcome}>
        {t("auth.welcome", { name: welcomeLabel(user, t("auth.userFallback")) })}
      </div>
    </div>
  );
}

