/**
 * Shared visual language for the whole app — "island sunset over a lagoon":
 * deep teal/turquoise water as the backdrop, warm gold-to-coral sunset as
 * the primary accent (buttons, titles, anything actionable), and a cool
 * aqua accent for secondary chrome (glass borders, badges, dividers).
 * Centralized here so every screen/component pulls from the same palette
 * instead of each re-declaring its own hex literals.
 */

export const colors = {
  // Backdrop — deep lagoon navy fading through tropical teal to a grounded
  // near-black teal, replacing the old forest-green "felt table" gradient.
  bgTop: "#0c3b4a",
  bgMid: "#0e6e68",
  bgBottom: "#04201e",

  // Sunset gold-to-coral — the app's one primary accent, used for titles,
  // primary buttons, glows, and anything meant to read as "the important
  // thing" or "tap this."
  sunGold: "#ffd76a",
  sunAmber: "#f5a75a",
  sunCoral: "#ff7d5c",

  // Cool aqua accent — secondary chrome: glass borders, dividers, badges,
  // the "connected/ready" state. Keeps the gold from being the only color
  // in the app.
  aqua: "#5ee7d0",
  aquaDim: "rgba(94,231,208,0.32)",
  aquaFaint: "rgba(94,231,208,0.16)",

  // Text
  textPrimary: "#f6faf7",
  textSecondary: "#a9d3ca",
  textMuted: "#7fa79d",

  // Status
  positive: "#5cd68a",
  negative: "#ff9184",

  // Glass surface (see GlassPanel) — a cool teal-tinted frosted glass
  // instead of the old plain dark tint.
  glassBg: "rgba(18,60,58,0.30)",
  glassBorder: "rgba(94,231,208,0.22)",

  // The playing table's felt surface (see GameScreen's tableSurface) and
  // its warm wood/rail-style trim.
  feltLight: "rgba(24,100,90,0.55)",
  feltDark: "rgba(4,26,24,0.65)",
  rail: "rgba(245,167,90,0.4)",
};

export const gradients = {
  background: [colors.bgTop, colors.bgMid, colors.bgBottom],
  backgroundLocations: [0, 0.42, 1],
  sunset: [colors.sunGold, colors.sunAmber, colors.sunCoral],
  cardBack: ["#0f5c58", "#062f2c"],
  // Felt lit from above — lighter at the top where the deck/target card
  // sit, darkening toward the bottom, like a table lamp over real felt.
  felt: [colors.feltLight, colors.feltDark],
  // A thin diagonal sheen swept across a card on hover — a hologram-foil
  // hint rather than a literal rainbow, so it reads as "premium" without
  // clashing with the sunset/aqua palette everything else uses.
  sheen: ["transparent", "rgba(255,255,255,0.55)", "transparent"],
};

// 4px grid — every padding/margin/gap added or touched going forward picks
// from this instead of a one-off number, so rhythm stays consistent as the
// app grows. Existing untouched screens keep their own close-enough values
// rather than being mechanically rewritten just to match.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 };

// Border-radius scale — cards sit at "lg", panels/banners at "md"/"xl",
// pill controls use 999 directly (that one's not really a "scale" step).
export const radius = { sm: 8, md: 12, lg: 14, xl: 22 };

/**
 * Soft, colored, multi-layer shadow presets — replaces flat `shadowColor:
 * "#000"` everywhere a card or panel needs to feel like it's actually
 * sitting above the felt rather than just stacked in z-order. Each preset
 * is two shadow descriptors: a tight, slightly-darker "contact" shadow and
 * a wide, faint, warm-tinted "ambient" one, meant to be applied to two
 * nested Views (RN only honors one shadow per layer — there's no native
 * equivalent of CSS's comma-separated box-shadow list).
 */
export const shadows = {
  gold: colors.sunAmber,
  aqua: colors.aqua,
  card: {
    ambient: { shadowColor: "#2a1206", shadowOpacity: 0.28, shadowRadius: 20, shadowOffset: { width: 0, height: 14 }, elevation: 3 },
    contact: { shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 5 },
  },
  cardHover: {
    ambient: { shadowColor: colors.sunAmber, shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 20 }, elevation: 6 },
    contact: { shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 10 },
  },
  panel: { shadowColor: "#06211d", shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
};
