"use client";

import { useEffect, useRef } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getAuthClientOrNull } from "../../../lib/firebaseClient";

type Props = {
  page: string;
  pathname: string;
  city?: string;
  adId?: string;
  departmentIds?: string[];
  categoryCodes?: string[];
};

function postActivity(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon("/api/activitylog", blob);
    return;
  }
  void fetch("/api/activitylog", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export default function ActivityLogClient({
  page,
  pathname,
  city = "",
  adId = "",
  departmentIds = [],
  categoryCodes = [],
}: Props) {
  const lastKeyRef = useRef<string>("");
  const lastAtRef = useRef<number>(0);
  const userRef = useRef<User | null>(null);
  const anonIdRef = useRef<string>("");

  useEffect(() => {
    const KEY = "koochly_anon_id";
    try {
      const existing = localStorage.getItem(KEY)?.trim() ?? "";
      if (existing) {
        anonIdRef.current = existing;
        return;
      }
      const next =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `anon_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(KEY, next);
      anonIdRef.current = next;
    } catch {
      anonIdRef.current = `anon_${Date.now()}`;
    }
  }, []);

  useEffect(() => {
    const auth = getAuthClientOrNull();
    if (!auth) {
      userRef.current = null;
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      userRef.current = u;
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const uid = userRef.current?.uid ?? getAuthClientOrNull()?.currentUser?.uid ?? "";
    const anonId = anonIdRef.current;

    const key = JSON.stringify({
      page,
      pathname,
      city,
      adId,
      uid: uid ? "u" : "",
      anonId,
      departmentIds: [...departmentIds].sort(),
      categoryCodes: [...categoryCodes].sort(),
    });
    const now = Date.now();
    // Lightweight dedupe/throttle to avoid heavy writes while user is filtering quickly.
    if (lastKeyRef.current === key && now - lastAtRef.current < 30000) return;
    lastKeyRef.current = key;
    lastAtRef.current = now;

    postActivity({
      uid,
      anonId,
      page,
      pathname,
      city,
      adId,
      departmentIds,
      categoryCodes,
    });
  }, [page, pathname, city, adId, departmentIds, categoryCodes]);

  return null;
}

