import { useId } from "react";
import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import {
  markBackPath,
  markFrontPath,
  wordmarkPaths,
  wordmarkWidth,
} from "./brand-assets";
import { brandPalette } from "./brand-tokens";

export function OpenJobWordmark({
  inverse,
  width = 150,
}: {
  inverse: boolean;
  width?: number;
}) {
  return (
    <Svg
      accessibilityLabel="OpenJob"
      accessibilityRole="header"
      height={(width * 84) / wordmarkWidth}
      testID="openjob-wordmark-canonical"
      viewBox={`0 0 ${wordmarkWidth} 84`}
      width={width}
    >
      <G fill={inverse ? brandPalette.chalk : brandPalette.graphite}>
        {wordmarkPaths.map((path, index) => <Path d={path} key={index} />)}
      </G>
    </Svg>
  );
}

export function OpenJobBrandmark({
  inverse,
  size = 112,
}: {
  inverse: boolean;
  size?: number;
}) {
  const id = useId();
  const backId = `mark-back-${id}`;
  const frontId = `mark-front-${id}`;
  const [base, shade, fold] = inverse
    ? ["#6389FF", "#4169E1", "#8CA8FF"]
    : ["#4169E1", "#3157D5", "#6C90FF"];
  return (
    <Svg
      accessibilityElementsHidden
      height={(size * 80) / 84}
      testID="openjob-brandmark-canonical"
      viewBox="0 0 84 80"
      width={size}
    >
      <Defs>
        <LinearGradient id={backId} x1="24" y1="4" x2="76" y2="60" gradientUnits="userSpaceOnUse">
          <Stop stopColor={fold} />
          <Stop offset={0.55} stopColor={base} />
          <Stop offset="1" stopColor={shade} />
        </LinearGradient>
        <LinearGradient id={frontId} x1="8" y1="26" x2="62" y2="74" gradientUnits="userSpaceOnUse">
          <Stop stopColor={base} />
          <Stop offset={0.6} stopColor={shade} />
          <Stop offset="1" stopColor={base} />
        </LinearGradient>
      </Defs>
      <Path d={markBackPath} fill={`url(#${backId})`} />
      <Path d={markFrontPath} fill={`url(#${frontId})`} />
      <Path d="M30 4H41L36 18H24Z" fill={fold} opacity={0.65} />
      <Path d="m33 4-5 14h3l5-14Z" fill={brandPalette.chalk} opacity={0.17} />
      <Path d="M36 60H50L44 74H30Z" fill={fold} opacity={0.7} />
      <Path d="m40 60-6 14h3l6-14Z" fill={brandPalette.chalk} opacity={0.22} />
    </Svg>
  );
}
