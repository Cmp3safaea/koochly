import { StyleSheet, Text, type TextProps } from "react-native";

/**
 * Shared brand heading — same copy source as web via `@koochly/shared` `t("home.brand")`.
 * Use in Expo; to use the same component on Next.js, add `react-native-web` and transpile this package.
 */
export function BrandTitle({ style, children, ...rest }: TextProps) {
  return (
    <Text style={[styles.title, style]} {...rest}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
  },
});
