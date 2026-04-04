import { useMemo, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  createTranslator,
  getMessages,
  type Locale,
  locales,
} from "@koochly/shared";
import { BrandTitle } from "@koochly/ui";
import { DivaroLogo } from "../components/DivaroLogo";
import { PriorityAdsCarousel } from "../components/PriorityAdsCarousel";

const accent = "#0f766e";
const accentSoft = "rgba(15, 118, 110, 0.1)";
const textMuted = "#64748b";
const textStrong = "#0f172a";
const surface = "#ffffff";
const pageBg = "#f1f5f9";

export function HomeScreen() {
  const [locale, setLocale] = useState<Locale>("fa");
  const [search, setSearch] = useState("");
  const isRtl = locale === "fa";

  const t = useMemo(
    () => createTranslator(getMessages(locale)),
    [locale],
  );

  return (
    <View style={[styles.root, isRtl && styles.rootRtl]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={[styles.langRow, isRtl && styles.rowRtl]}>
            {(locales as readonly Locale[]).map((loc) => {
              const active = loc === locale;
              return (
                <Pressable
                  key={loc}
                  onPress={() => setLocale(loc)}
                  style={[styles.langChip, active && styles.langChipActive]}
                >
                  <Text
                    style={[styles.langChipText, active && styles.langChipTextActive]}
                  >
                    {loc === "fa" ? "فا" : "EN"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={[styles.brandRow, isRtl && styles.rowRtl]}>
          <DivaroLogo width={160} height={44} />
          <View style={styles.brandTextWrap}>
            <BrandTitle style={[styles.brandWordmark, isRtl && styles.textRtl]}>
              {t("home.brand")}
            </BrandTitle>
            <Text style={[styles.tagline, isRtl && styles.textRtl]}>
              {t("home.loadingSubtitle")}
            </Text>
          </View>
        </View>

        <View style={styles.heroCard}>
          <Text style={[styles.heroTitle, isRtl && styles.textRtl]}>
            {t("home.heroTitle")}
          </Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("home.searchPlaceholder")}
            placeholderTextColor="#9ca3af"
            style={[styles.searchInput, isRtl && styles.searchInputRtl]}
            textAlign={isRtl ? "right" : "left"}
            accessibilityLabel={t("home.searchAria")}
          />
          <Text style={[styles.heroHint, isRtl && styles.textRtl]}>
            {t("home.cardSearchBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>
            {t("home.infoWhatTitle")}
          </Text>
          <Text style={[styles.sectionBody, isRtl && styles.textRtl]}>
            {t("home.infoWhatBody")}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRtl && styles.textRtl]}>
            {t("home.infoHowTitle")}
          </Text>
          <Text style={[styles.sectionBody, isRtl && styles.textRtl]}>
            {t("home.infoHowBody")}
          </Text>
        </View>

        <View style={styles.cardsGrid}>
          <FeatureCard
            title={t("home.cardSearchTitle")}
            body={t("home.cardSearchBody")}
            isRtl={isRtl}
          />
          <FeatureCard
            title={t("home.cardRegisterTitle")}
            body={t("home.cardRegisterBody")}
            isRtl={isRtl}
          />
          <FeatureCard
            title={t("home.cardConnectTitle")}
            body={t("home.cardConnectBody")}
            isRtl={isRtl}
          />
        </View>

        <PriorityAdsCarousel
          locale={locale}
          sectionTitle={t("home.priorityAdsTitle")}
          badgeLabel={t("home.priorityBadge")}
          emptyLabel={t("home.priorityAdsEmpty")}
          errorLabel={t("home.priorityAdsError")}
          hintLabel={t("home.priorityAdsHint")}
          isRtl={isRtl}
        />

        <View style={styles.footer}>
          <Text style={[styles.footerText, isRtl && styles.textRtl]}>
            {t("home.loadingWelcome")}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function FeatureCard({
  title,
  body,
  isRtl,
}: {
  title: string;
  body: string;
  isRtl: boolean;
}) {
  return (
    <View style={styles.featureCard}>
      <View
        style={[
          styles.featureAccent,
          isRtl ? styles.featureAccentRtl : styles.featureAccentLtr,
        ]}
      />
      <Text
        style={[
          styles.featureTitle,
          isRtl ? styles.textRtl : undefined,
          isRtl ? styles.featureTextPadRtl : styles.featureTextPadLtr,
        ]}
      >
        {title}
      </Text>
      <Text
        style={[
          styles.featureBody,
          isRtl ? styles.textRtl : undefined,
          isRtl ? styles.featureTextPadRtl : styles.featureTextPadLtr,
        ]}
      >
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: pageBg,
    paddingTop: Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) + 8 : 52,
  },
  rootRtl: {
    direction: "rtl",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  topBar: {
    marginBottom: 8,
  },
  langRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  rowRtl: {
    flexDirection: "row-reverse",
  },
  langChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: surface,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  langChipActive: {
    backgroundColor: accentSoft,
    borderColor: accent,
  },
  langChipText: {
    fontSize: 13,
    fontWeight: "700",
    color: textMuted,
  },
  langChipTextActive: {
    color: accent,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 22,
  },
  brandTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  brandWordmark: {
    textAlign: "left",
    fontSize: 26,
    color: textStrong,
  },
  tagline: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 22,
    color: textMuted,
    textAlign: "left",
  },
  textRtl: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  heroCard: {
    backgroundColor: surface,
    borderRadius: 20,
    padding: 18,
    marginBottom: 22,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    ...Platform.select({
      ios: {
        shadowColor: "#0f172a",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      },
      android: { elevation: 3 },
    }),
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: "800",
    color: textStrong,
    marginBottom: 14,
    letterSpacing: -0.3,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    fontSize: 16,
    backgroundColor: "#fafafa",
    color: textStrong,
  },
  searchInputRtl: {
    writingDirection: "rtl",
  },
  heroHint: {
    marginTop: 12,
    fontSize: 13,
    lineHeight: 20,
    color: textMuted,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: accent,
    marginBottom: 8,
  },
  sectionBody: {
    fontSize: 15,
    lineHeight: 24,
    color: textStrong,
    opacity: 0.92,
  },
  cardsGrid: {
    gap: 12,
    marginTop: 4,
  },
  featureCard: {
    backgroundColor: surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e8ecf1",
    overflow: "hidden",
  },
  featureAccent: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: accent,
  },
  featureAccentLtr: {
    left: 0,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  featureAccentRtl: {
    right: 0,
    borderTopRightRadius: 16,
    borderBottomRightRadius: 16,
  },
  featureTextPadLtr: {
    paddingLeft: 8,
  },
  featureTextPadRtl: {
    paddingRight: 8,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: textStrong,
    marginBottom: 6,
  },
  featureBody: {
    fontSize: 14,
    lineHeight: 22,
    color: textMuted,
  },
  footer: {
    marginTop: 28,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  footerText: {
    fontSize: 14,
    fontWeight: "600",
    color: accent,
    textAlign: "center",
  },
});
