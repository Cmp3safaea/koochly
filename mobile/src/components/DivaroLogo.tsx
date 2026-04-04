import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** Rose-gold mark; pair with `BrandTitle` for localized name (دیوارو / Divaro). */
export function DivaroLogo({
  width = 200,
  height = 54,
}: {
  width?: number;
  height?: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 360 96" accessibilityLabel="Divaro">
      <Defs>
        <LinearGradient id="divaroGoldMobile" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#d4a574" />
          <Stop offset="50%" stopColor="#b8734a" />
          <Stop offset="100%" stopColor="#8b5a3c" />
        </LinearGradient>
      </Defs>
      <Path
        fill="url(#divaroGoldMobile)"
        d="M44 48c0-14 10-26 24-28 6-1 12 1 17 4-8 2-14 8-16 16-2 10 4 20 14 24 4 2 9 2 13 0-3 10-12 18-23 20-15 3-29-6-32-21-1-5 0-10 2-15z"
      />
      <Path
        fill="url(#divaroGoldMobile)"
        opacity={0.85}
        d="M52 40c6-10 18-14 28-10-4 4-6 10-5 16 1 8 8 14 16 15-8 6-19 7-28 2-12-7-15-23-11-23z"
      />
    </Svg>
  );
}
