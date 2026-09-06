import { useWindowDimensions } from "react-native";

// Baseline width this UI was designed against (a standard phone). Sizes
// scale relative to this, clamped so a tiny phone doesn't shrink text
// illegibly and a tablet or desktop browser window doesn't blow cards up
// huge — MAX_CONTENT_WIDTH separately keeps the whole layout sitting in a
// phone-width column on wide screens instead of stretching edge-to-edge.
const BASE_WIDTH = 375;
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.35;
export const MAX_CONTENT_WIDTH = 520;

/** Returns a scale factor (clamped) to multiply sizes/fonts by for the current window. */
export function useScale() {
  const { width } = useWindowDimensions();
  const effectiveWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const raw = effectiveWidth / BASE_WIDTH;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, raw));
}

/** Shared style for a screen's outer content container — caps width and centers on wide screens. */
export const centeredContent = {
  width: "100%",
  maxWidth: MAX_CONTENT_WIDTH,
  alignSelf: "center",
};
