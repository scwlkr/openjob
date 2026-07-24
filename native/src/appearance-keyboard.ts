export type AppearanceKeyboardAction = "escape" | "next" | "previous";

const keyCodes = {
  android: {
    escape: 111,
    next: new Set([20, 22]),
    previous: new Set([19, 21]),
  },
  ios: {
    escape: 41,
    next: new Set([79, 81]),
    previous: new Set([80, 82]),
  },
} as const;

export function resolveAppearanceKey(
  platform: string,
  keyCode: number,
): AppearanceKeyboardAction | null {
  if (platform !== "android" && platform !== "ios") return null;
  const platformKeys = keyCodes[platform];
  if (keyCode === platformKeys.escape) return "escape";
  if (platformKeys.next.has(keyCode)) return "next";
  if (platformKeys.previous.has(keyCode)) return "previous";
  return null;
}
