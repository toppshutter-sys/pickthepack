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
};

export const gradients = {
  background: [colors.bgTop, colors.bgMid, colors.bgBottom],
  backgroundLocations: [0, 0.42, 1],
  sunset: [colors.sunGold, colors.sunAmber, colors.sunCoral],
  cardBack: ["#0f5c58", "#062f2c"],
};

export const shadows = {
  gold: colors.sunAmber,
  aqua: colors.aqua,
};
