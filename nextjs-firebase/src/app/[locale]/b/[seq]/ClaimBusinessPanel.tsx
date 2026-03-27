"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../../../../lib/firebaseClient";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import { useI18n } from "../../../../i18n/client";
import styles from "./ClaimBusinessPanel.module.css";

type Props = {
  adId: string;
};

function readFileAsBase64(file: File): Promise<{ base64: string; mime: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r !== "string") {
        reject(new Error("read_failed"));
        return;
      }
      const comma = r.indexOf(",");
      const payload = comma >= 0 ? r.slice(comma + 1) : r;
      resolve({ base64: payload, mime: file.type || "application/octet-stream" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

export default function ClaimBusinessPanel({ adId }: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const configured = isFirebaseClientConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [comment, setComment] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!configured) {
      setAuthReady(true);
      return;
    }
    const auth = getAuthClientOrNull();
    if (!auth) {
      setAuthReady(true);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, [configured]);

  const signIn = useCallback(async () => {
    setErr(null);
    const auth = getAuthClientOrNull();
    if (!auth) return;
    try {
      await signInWithPopup(auth, getGoogleProvider());
    } catch (e) {
      console.error(e);
      setErr(t("claim.signInErr"));
    }
  }, [t]);

  const submit = useCallback(async () => {
    setErr(null);
    if (!configured || !user) return;
    if (!file) {
      setErr(t("claim.pickFile"));
      return;
    }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (!allowed.includes(file.type)) {
      setErr(t("claim.fileType"));
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setErr(t("claim.fileSize"));
      return;
    }

    const auth = getAuthClientOrNull();
    if (!auth || !auth.currentUser) {
      setErr(t("claim.needAuth"));
      return;
    }

    setBusy(true);
    try {
      const { base64, mime } = await readFileAsBase64(file);
      const idToken = await auth.currentUser.getIdToken(true);
      const res = await fetch("/api/apply/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          adId,
          comment: comment.trim(),
          docsBase64: base64,
          docsMimeType: mime,
          docsFileName: file.name,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setErr(data.error ?? t("claim.submitErr"));
        return;
      }
      setDone(true);
      setExpanded(false);
      setComment("");
      setFile(null);
    } catch (e) {
      console.error(e);
      setErr(t("claim.submitFail"));
    } finally {
      setBusy(false);
    }
  }, [adId, comment, configured, file, user, t]);

  if (!configured) {
    return (
      <div className={styles.wrap}>
        <div className={styles.head}>{t("claim.headDisabled")}</div>
        <p className={styles.notConfigured}>{t("claim.disabledHint")}</p>
      </div>
    );
  }

  if (!authReady) {
    return (
      <div className={styles.wrap}>
        <div className={styles.head}>{t("claim.headDisabled")}</div>
        <p className={styles.hint}>{t("claim.loading")}</p>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>{t("claim.headAsk")}</div>
      <p className={styles.hint}>
        {t("claim.hint")}
      </p>

      {done ? (
        <p className={styles.success} role="status">
          {t("claim.success")}
        </p>
      ) : null}

      {!user ? (
        <div className={styles.actions}>
          <button type="button" className={styles.signInBtn} onClick={signIn}>
            {t("claim.signInCta")}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.trigger}
            disabled={busy}
            onClick={() => {
              setExpanded((v) => !v);
              setErr(null);
            }}
          >
            {expanded ? t("claim.closeForm") : t("claim.openForm")}
          </button>

          {expanded ? (
            <div className={styles.form}>
              <div>
                <label className={styles.label} htmlFor={`claim-comment-${adId}`}>
                  {t("claim.notes")}
                </label>
                <textarea
                  id={`claim-comment-${adId}`}
                  className={styles.textarea}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder={t("claim.notesPh")}
                  maxLength={2000}
                  dir="auto"
                />
              </div>
              <div>
                <label className={styles.label} htmlFor={`claim-file-${adId}`}>
                  {t("claim.proof")}
                </label>
                <input
                  id={`claim-file-${adId}`}
                  className={styles.fileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
              {err ? (
                <p className={styles.error} role="alert">
                  {err}
                </p>
              ) : null}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.submit}
                  disabled={busy || !file}
                  onClick={() => void submit()}
                >
                  {busy ? t("claim.sending") : t("claim.send")}
                </button>
                <button
                  type="button"
                  className={styles.cancel}
                  disabled={busy}
                  onClick={() => {
                    setExpanded(false);
                    setErr(null);
                  }}
                >
                  {t("claim.cancel")}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
