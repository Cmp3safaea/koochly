import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import type { Locale } from "@koochly/shared";
import { getApiBaseUrl } from "../config/apiBase";

export type PriorityAdItem = {
  id: string;
  seq: number;
  title: string;
  category: string;
  cityFa: string;
  cityEng: string;
  image: string | null;
  isPriority: boolean;
};

const CARD_GAP = 12;
const AUTO_MS = 5000;
const accent = "#0f766e";
const surface = "#ffffff";

type Props = {
  locale: Locale;
  sectionTitle: string;
  badgeLabel: string;
  emptyLabel: string;
  errorLabel: string;
  hintLabel: string;
  isRtl: boolean;
};

export function PriorityAdsCarousel({
  locale,
  sectionTitle,
  badgeLabel,
  emptyLabel,
  errorLabel,
  hintLabel,
  isRtl,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const horizontalPadding = 20;
  const cardWidth = windowWidth - horizontalPadding * 2;
  const step = cardWidth + CARD_GAP;

  const [ads, setAds] = useState<PriorityAdItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const indexRef = useRef(0);
  const [index, setIndex] = useState(0);
  const count = ads.length;

  useEffect(() => {
    let cancelled = false;
    const base = getApiBaseUrl();

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`${base}/api/ads/priority`);
        const data = (await res.json()) as { ads?: PriorityAdItem[]; error?: string };
        if (!res.ok) {
          throw new Error(data?.error ?? errorLabel);
        }
        if (!cancelled) {
          setAds(Array.isArray(data.ads) ? data.ads : []);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : errorLabel);
          setAds([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [errorLabel]);

  const scrollToIndex = useCallback(
    (i: number, animated: boolean) => {
      if (count === 0) return;
      const safe = ((i % count) + count) % count;
      indexRef.current = safe;
      setIndex(safe);
      scrollRef.current?.scrollTo({ x: safe * step, animated });
    },
    [count, step],
  );

  useEffect(() => {
    if (count <= 1) return;
    const id = setInterval(() => {
      scrollToIndex(indexRef.current + 1, true);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [count, scrollToIndex]);

  const onScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (count === 0) return;
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / step);
      const safe = Math.max(0, Math.min(count - 1, i));
      indexRef.current = safe;
      setIndex(safe);
    },
    [count, step],
  );

  const openAd = useCallback(
    (seq: number) => {
      const base = getApiBaseUrl();
      const url = `${base}/${locale}/b/${seq}`;
      void Linking.openURL(url);
    },
    [locale],
  );

  const subtitleFor = useMemo(
    () => (ad: PriorityAdItem) => {
      const city = locale === "fa" ? ad.cityFa || ad.cityEng : ad.cityEng || ad.cityFa;
      const parts = [ad.category, city].filter(Boolean);
      return parts.join(locale === "fa" ? " • " : " · ");
    },
    [locale],
  );

  if (loading) {
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>{sectionTitle}</Text>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={accent} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>{sectionTitle}</Text>
        <Text style={[styles.muted, isRtl && styles.textRtl]}>{error}</Text>
      </View>
    );
  }

  if (count === 0) {
    return (
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>{sectionTitle}</Text>
        <Text style={[styles.muted, isRtl && styles.textRtl]}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>{sectionTitle}</Text>
      <Text style={[styles.hint, isRtl && styles.textRtl]}>{hintLabel}</Text>

      <View style={styles.carouselLtr}>
        <ScrollView
          ref={scrollRef}
          horizontal
          decelerationRate="fast"
          snapToInterval={step}
          snapToAlignment="start"
          disableIntervalMomentum
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          onScrollEndDrag={onScrollEnd}
          contentContainerStyle={[
            styles.hScrollContent,
            { paddingHorizontal: horizontalPadding },
          ]}
        >
          {ads.map((ad) => (
            <Pressable
              key={ad.id}
              onPress={() => openAd(ad.seq)}
              style={[styles.card, { width: cardWidth }]}
            >
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{badgeLabel}</Text>
              </View>
              {ad.image ? (
                <Image source={{ uri: ad.image }} style={styles.cardImage} />
              ) : (
                <View style={[styles.cardImage, styles.imagePlaceholder]}>
                  <Text style={styles.placeholderGlyph} numberOfLines={1}>
                    {ad.title.slice(0, 1)}
                  </Text>
                </View>
              )}
              <View style={styles.cardBody}>
                <Text
                  style={[styles.cardTitle, isRtl && styles.textRtl]}
                  numberOfLines={2}
                >
                  {ad.title}
                </Text>
                {subtitleFor(ad) ? (
                  <Text
                    style={[styles.cardCat, isRtl && styles.textRtl]}
                    numberOfLines={2}
                  >
                    {subtitleFor(ad)}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>

        {count > 1 ? (
          <View style={styles.dotsRow}>
            {ads.map((ad, i) => (
              <Pressable
                key={ad.id}
                onPress={() => scrollToIndex(i, true)}
                style={styles.dotHit}
                accessibilityRole="button"
              >
                <View
                  style={[styles.dot, i === index ? styles.dotActive : styles.dotIdle]}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: accent,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  hint: {
    fontSize: 12,
    fontWeight: "600",
    color: "#94a3b8",
    marginBottom: 10,
    paddingHorizontal: 20,
  },
  muted: {
    fontSize: 14,
    color: "#64748b",
    paddingHorizontal: 20,
  },
  textRtl: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  centerBox: {
    paddingVertical: 28,
    alignItems: "center",
  },
  carouselLtr: {
    direction: "ltr",
  },
  hScrollContent: {
    gap: CARD_GAP,
    paddingBottom: 4,
  },
  card: {
    backgroundColor: surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  badge: {
    position: "absolute",
    top: 10,
    zIndex: 2,
    left: 10,
    backgroundColor: "rgba(15, 118, 110, 0.95)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  badgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },
  cardImage: {
    width: "100%",
    height: 160,
    backgroundColor: "#e5e7eb",
  },
  imagePlaceholder: {
    alignItems: "center",
    justifyContent: "center",
  },
  placeholderGlyph: {
    fontSize: 48,
    fontWeight: "800",
    color: "#94a3b8",
  },
  cardBody: {
    padding: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#0f172a",
    marginBottom: 4,
  },
  cardCat: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748b",
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
  },
  dotHit: {
    padding: 6,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
  dotIdle: {
    width: 8,
    backgroundColor: "#cbd5e1",
  },
  dotActive: {
    width: 22,
    backgroundColor: accent,
  },
});
