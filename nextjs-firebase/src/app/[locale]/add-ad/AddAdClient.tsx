"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { onAuthStateChanged, signInWithPopup, type User } from "firebase/auth";
import {
  getAuthClientOrNull,
  getGoogleProvider,
  isFirebaseClientConfigured,
} from "../../../lib/firebaseClient";
import { useI18n, useLocalizedHref } from "../../../i18n/client";
import KoochlyLogo from "../../images/Koochly-Logo.png";
import { CustomSelect } from "./CustomSelect";
import styles from "./AddAdForm.module.css";

const AddAdLocationPicker = dynamic(() => import("./AddAdLocationPicker"), { ssr: false });

type CityRow = {
  id: string;
  city_fa?: string;
  city_eng?: string;
  active?: boolean;
} & Record<string, unknown>;

type DeptRow = {
  id: string;
  label: string;
};

type CategoryRow = { code: string; label: string };

const MAX_AD_IMAGES = 3;
const MAX_IMAGE_FILE_BYTES = 100 * 1024;
const ACCEPT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
      resolve({ base64: payload, mime: file.type || "image/jpeg" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

function cityLabel(c: CityRow): string {
  const fa =
    typeof c.city_fa === "string" && c.city_fa.trim() ? c.city_fa.trim() : "";
  const en =
    typeof c.city_eng === "string" && c.city_eng.trim() ? c.city_eng.trim() : "";
  if (fa && en) return `${fa} · ${en}`;
  return fa || en || c.id;
}

function cityCenterFromRow(c: CityRow | undefined): { lat: number; lng: number } | null {
  if (!c) return null;
  const raw = c.latlng as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const lat = Number(
    raw.__lat__ ?? raw.lat ?? raw.latitude,
  );
  const lng = Number(
    raw.__lon__ ?? raw.lon ?? raw.longitude ?? raw.lng,
  );
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

export default function AddAdClient() {
  const { t, locale } = useI18n();
  const loc = useLocalizedHref();
  const configured = isFirebaseClientConfigured();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [cities, setCities] = useState<CityRow[]>([]);
  const [departments, setDepartments] = useState<DeptRow[]>([]);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaErr, setMetaErr] = useState<string | null>(null);
  const [categoryOptions, setCategoryOptions] = useState<CategoryRow[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  const [cityId, setCityId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [catCode, setCatCode] = useState("");
  const [title, setTitle] = useState("");
  const [engName, setEngName] = useState("");
  const [details, setDetails] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [instagram, setInstagram] = useState("");
  const [latStr, setLatStr] = useState("");
  const [lonStr, setLonStr] = useState("");
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([]);

  useLayoutEffect(() => {
    const urls = imageFiles.map((f) => URL.createObjectURL(f));
    setImagePreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [imageFiles]);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ seq: number; url: string } | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cRes, dRes] = await Promise.all([
          fetch("/api/cities"),
          fetch(`/api/directory?locale=${encodeURIComponent(locale)}`),
        ]);
        const cJson = await cRes.json().catch(() => ({}));
        const dJson = await dRes.json().catch(() => ({}));
        if (!cRes.ok) throw new Error(cJson?.error ?? t("addAd.errCities"));
        if (!dRes.ok) throw new Error(dJson?.error ?? t("addAd.errDept"));
        if (cancelled) return;
        setCities(Array.isArray(cJson.cities) ? cJson.cities : []);
        setDepartments(Array.isArray(dJson.departments) ? dJson.departments : []);
      } catch (e) {
        if (!cancelled) {
          setMetaErr(e instanceof Error ? e.message : t("addAd.errLoad"));
        }
      } finally {
        if (!cancelled) setMetaLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, locale]);

  const activeCities = useMemo(
    () => cities.filter((c) => c.active === true),
    [cities],
  );

  const selectedCity = useMemo(
    () => activeCities.find((x) => x.id === cityId),
    [activeCities, cityId],
  );

  const mapCenter = useMemo(() => cityCenterFromRow(selectedCity), [selectedCity]);

  useEffect(() => {
    if (!departmentId) {
      setCategoryOptions([]);
      setCategoriesLoading(false);
      return;
    }
    let cancelled = false;
    setCategoriesLoading(true);
    setCategoryOptions([]);
    const url = `/api/directory/${encodeURIComponent(departmentId)}/categories`;
    fetch(url)
      .then(async (res) => {
        const j = (await res.json().catch(() => ({}))) as {
          categories?: unknown;
          error?: string;
        };
        if (!res.ok) throw new Error(j.error ?? t("addAd.errDept"));
        return j;
      })
      .then((j) => {
        if (cancelled) return;
        const raw = j.categories;
        const list = Array.isArray(raw)
          ? raw.filter(
              (row): row is CategoryRow =>
                row != null &&
                typeof row === "object" &&
                typeof (row as CategoryRow).code === "string" &&
                typeof (row as CategoryRow).label === "string",
            )
          : [];
        setCategoryOptions(list);
      })
      .catch(() => {
        if (!cancelled) setCategoryOptions([]);
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [departmentId, t]);

  const signIn = useCallback(async () => {
    const auth = getAuthClientOrNull();
    if (!auth) return;
    await signInWithPopup(auth, getGoogleProvider());
  }, []);

  const onDeptChange = (id: string) => {
    setDepartmentId(id);
    setCatCode("");
  };

  const parseCoord = (s: string): number | null => {
    const t = s.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  };

  const submit = async () => {
    setErr(null);
    if (!user || !configured) return;
    if (!cityId || !departmentId || !catCode || title.trim().length < 2) {
      setErr(t("addAd.errFill"));
      return;
    }
    const lat = parseCoord(latStr);
    const lon = parseCoord(lonStr);
    if ((latStr.trim() || lonStr.trim()) && (lat === null || lon === null)) {
      setErr(t("addAd.errCoords"));
      return;
    }

    const auth = getAuthClientOrNull();
    if (!auth?.currentUser) {
      setErr(t("addAd.errSession"));
      return;
    }

    setBusy(true);
    try {
      const imagesPayload: {
        imageBase64: string;
        imageMimeType: string;
        imageFileName: string;
      }[] = [];
      for (const imageFile of imageFiles) {
        if (!ACCEPT_IMAGE_TYPES.has(imageFile.type)) {
          setErr(t("addAd.errImageType"));
          setBusy(false);
          return;
        }
        if (imageFile.size > MAX_IMAGE_FILE_BYTES) {
          setErr(t("addAd.errImageSize", { name: imageFile.name }));
          setBusy(false);
          return;
        }
        const img = await readFileAsBase64(imageFile);
        imagesPayload.push({
          imageBase64: img.base64,
          imageMimeType: img.mime,
          imageFileName: imageFile.name,
        });
      }

      const idToken = await auth.currentUser.getIdToken(true);
      const res = await fetch("/api/ads/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          cityId,
          departmentId,
          catCode,
          title: title.trim(),
          engName: engName.trim(),
          details: details.trim(),
          address: address.trim(),
          phone: phone.trim(),
          website: website.trim(),
          instagram: instagram.trim(),
          lat,
          lon,
          images: imagesPayload.length ? imagesPayload : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        seq?: number;
        url?: string;
      };
      if (!res.ok) {
        setErr(data.error ?? t("addAd.errSubmit"));
        return;
      }
      if (typeof data.seq === "number" && typeof data.url === "string") {
        setSuccess({ seq: data.seq, url: data.url });
        setTitle("");
        setEngName("");
        setDetails("");
        setAddress("");
        setPhone("");
        setWebsite("");
        setInstagram("");
        setLatStr("");
        setLonStr("");
        setImageFiles([]);
      }
    } catch (e) {
      console.error(e);
      setErr(t("addAd.errNetwork"));
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <p className={styles.mutedCfg}>{t("addAd.notConfigured")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.topBar}>
          <Link href={loc("/")} className={styles.brand}>
            <Image src={KoochlyLogo} alt="" className={styles.logo} width={52} height={52} />
            <div className={styles.brandText}>
              <span className={styles.brandTitle}>{t("addAd.brand")}</span>
              <span className={styles.brandSub}>{t("addAd.sub")}</span>
            </div>
          </Link>
          <Link href={loc("/")} className={styles.backLink}>
            {t("addAd.backHome")}
          </Link>
        </div>

        <div className={styles.card}>
          <header className={styles.cardHead}>
            <div className={styles.cardKicker}>{t("addAd.kicker")}</div>
            <h1 className={styles.cardTitle}>{t("addAd.title")}</h1>
            <p className={styles.cardLead}>
              {t("addAd.lead")}
            </p>
            <div className={styles.notice}>
              {t("addAd.approvedNote")}
            </div>
          </header>

          {!authReady ? (
            <p className={styles.hint}>{t("addAd.checkingAuth")}</p>
          ) : !user ? (
            <div className={styles.authGate}>
              <h2 className={styles.authTitle}>{t("addAd.authTitle")}</h2>
              <p className={styles.authLead}>
                {t("addAd.authLead")}
              </p>
              <button type="button" className={styles.signIn} onClick={() => void signIn()}>
                {t("addAd.signInGoogle")}
              </button>
            </div>
          ) : metaLoading ? (
            <p className={styles.hint}>{t("addAd.loadingMeta")}</p>
          ) : metaErr ? (
            <p className={styles.error} role="alert">
              {metaErr}
            </p>
          ) : (
            <>
              <div className={`${styles.grid} ${styles.grid2}`}>
                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-city">
                    {t("addAd.city")}
                  </label>
                  <CustomSelect
                    id="ad-city"
                    field="city"
                    value={cityId}
                    onChange={setCityId}
                    placeholder={t("addAd.cityPh")}
                    options={activeCities.map((c) => ({
                      value: c.id,
                      label: cityLabel(c),
                    }))}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-dept">
                    {t("addAd.dept")}
                  </label>
                  <CustomSelect
                    id="ad-dept"
                    field="department"
                    value={departmentId}
                    onChange={onDeptChange}
                    placeholder={t("addAd.deptPh")}
                    options={departments.map((d) => ({
                      value: d.id,
                      label: d.label,
                    }))}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-cat">
                    {t("addAd.category")}
                  </label>
                  <CustomSelect
                    id="ad-cat"
                    field="category"
                    value={catCode}
                    onChange={setCatCode}
                    placeholder={
                      !departmentId
                        ? t("addAd.catPickDept")
                        : categoriesLoading
                          ? t("addAd.catLoading")
                          : categoryOptions.length === 0
                            ? t("addAd.catEmpty")
                            : t("addAd.catPh")
                    }
                    disabled={
                      !departmentId || categoriesLoading || categoryOptions.length === 0
                    }
                    options={categoryOptions.map((c) => ({
                      value: c.code,
                      label: c.label,
                    }))}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-title">
                    {t("addAd.adTitle")}
                  </label>
                  <input
                    id="ad-title"
                    className={styles.input}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={t("addAd.adTitlePh")}
                    dir="auto"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-eng">
                    {t("addAd.engName")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-eng"
                    className={styles.input}
                    value={engName}
                    onChange={(e) => setEngName(e.target.value)}
                    placeholder={t("addAd.engNamePh")}
                    dir="ltr"
                    lang="en"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-details">
                    {t("addAd.details")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <textarea
                    id="ad-details"
                    className={styles.textarea}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder={t("addAd.detailsPh")}
                    dir="auto"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <label className={styles.label} htmlFor="ad-address">
                    {t("addAd.address")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-address"
                    className={styles.input}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder={t("addAd.addressPh")}
                    dir="auto"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-phone">
                    {t("addAd.phone")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-phone"
                    className={styles.input}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+44 …"
                    dir="ltr"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-web">
                    {t("addAd.website")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-web"
                    className={styles.input}
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder="example.com"
                    dir="ltr"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="ad-ig">
                    {t("addAd.instagram")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </label>
                  <input
                    id="ad-ig"
                    className={styles.input}
                    value={instagram}
                    onChange={(e) => setInstagram(e.target.value)}
                    placeholder="@handle or URL"
                    dir="ltr"
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>
                    {t("addAd.map")}{" "}
                    <span className={styles.optional}>({t("addAd.optional")})</span>
                  </span>
                  <AddAdLocationPicker
                    cityCenter={mapCenter}
                    latStr={latStr}
                    lonStr={lonStr}
                    onCoordsChange={(lat, lng) => {
                      setLatStr(lat.toFixed(6));
                      setLonStr(lng.toFixed(6));
                    }}
                    onClear={() => {
                      setLatStr("");
                      setLonStr("");
                    }}
                  />
                </div>

                <div className={`${styles.field} ${styles.fieldFull}`}>
                  <span className={styles.label}>
                    {t("addAd.images")}{" "}
                    <span className={styles.optional}>({t("addAd.imagesSub")})</span>
                  </span>
                  <div className={styles.imageRow}>
                    <label
                      className={`${styles.fileBtn} ${
                        imageFiles.length >= MAX_AD_IMAGES ? styles.fileBtnMuted : ""
                      }`}
                    >
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        style={{ display: "none" }}
                        disabled={imageFiles.length >= MAX_AD_IMAGES}
                        onChange={(e) => {
                          const input = e.target;
                          const list = input.files;
                          if (!list?.length) return;
                          const additions: File[] = [];
                          for (const f of Array.from(list)) {
                            if (imageFiles.length + additions.length >= MAX_AD_IMAGES) break;
                            if (!ACCEPT_IMAGE_TYPES.has(f.type)) {
                              setErr(t("addAd.errImageType"));
                              input.value = "";
                              return;
                            }
                            if (f.size > MAX_IMAGE_FILE_BYTES) {
                              setErr(t("addAd.errImageSize", { name: f.name }));
                              input.value = "";
                              return;
                            }
                            additions.push(f);
                          }
                          if (additions.length) {
                            setErr(null);
                            setImageFiles((prev) => [...prev, ...additions]);
                          }
                          input.value = "";
                        }}
                      />
                      {imageFiles.length >= MAX_AD_IMAGES ? t("addAd.maxImages") : t("addAd.addImage")}
                    </label>
                    {imageFiles.length === 0 ? (
                      <span className={styles.fileName}>{t("addAd.noImages")}</span>
                    ) : null}
                  </div>
                  {imageFiles.length > 0 ? (
                    <ul className={styles.imageList}>
                      {imageFiles.map((f, i) => {
                        const preview = imagePreviewUrls[i];
                        return (
                          <li
                            key={`${i}-${f.name}-${f.size}-${f.lastModified}`}
                            className={styles.imageListItem}
                          >
                            <div className={styles.imageThumbWrap}>
                              {preview ? (
                                <img
                                  src={preview}
                                  alt=""
                                  className={styles.imageThumb}
                                />
                              ) : (
                                <div className={styles.imageThumbFallback} aria-hidden />
                              )}
                            </div>
                            <span className={styles.imageItemName} dir="ltr" title={f.name}>
                              {f.name}
                            </span>
                            <button
                              type="button"
                              className={styles.imageRemove}
                              onClick={() => setImageFiles((p) => p.filter((_, j) => j !== i))}
                              aria-label={t("addAd.removeFileAria", { name: f.name })}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <p className={styles.hint}>
                    {t("addAd.imagesHint")}
                  </p>
                </div>
              </div>

              {err ? (
                <div className={styles.error} role="alert">
                  {err}
                </div>
              ) : null}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.submit}
                  disabled={busy}
                  onClick={() => void submit()}
                >
                  {busy ? t("addAd.submitting") : t("addAd.submit")}
                </button>
              </div>
            </>
          )}

          {success ? (
            <div className={styles.success} role="status">
              <div className={styles.successTitle}>{t("addAd.successTitle")}</div>
              <p className={styles.successText}>
                {t("addAd.successBody")}: <strong>{success.seq}</strong> — {t("addAd.successUrl")}
                :&nbsp;
                <span dir="ltr">{success.url}</span>
              </p>
              <Link href={loc(`/b/${success.seq}`)} className={styles.successLink}>
                {t("addAd.viewAd")}
              </Link>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
