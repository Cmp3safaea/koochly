"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup } from "firebase/auth";
import type { User } from "firebase/auth";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../lib/firebaseClient";
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

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export function AuthWelcome() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    const auth = getAuthClientOrNull();
    if (!auth) {
      setUser(null);
      setAuthReady(true);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  const signIn = useCallback(async () => {
    const auth = getAuthClientOrNull();
    if (!auth) return;
    setSigningIn(true);
    try {
      await signInWithPopup(auth, getGoogleProvider());
    } catch {
      /* popup closed or error */
    } finally {
      setSigningIn(false);
    }
  }, []);

  if (!authReady) return null;

  if (user) {
    return (
      <div className={styles.box}>
        <div className={styles.welcome}>
          {t("auth.welcome", { name: welcomeLabel(user, t("auth.userFallback")) })}
        </div>
      </div>
    );
  }

  if (!isFirebaseClientConfigured()) return null;

  return (
    <div className={styles.box}>
      <button
        type="button"
        className={styles.signInGoogleBtn}
        onClick={() => void signIn()}
        disabled={signingIn}
        aria-busy={signingIn}
      >
        <GoogleGlyph className={styles.signInGoogleGlyph} />
        <span>{signingIn ? t("auth.signingIn") : t("auth.signInWithGoogle")}</span>
      </button>
    </div>
  );
}
