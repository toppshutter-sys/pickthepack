import React, { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import GlassPanel from "./GlassPanel";
import GradientButton from "./GradientButton";
import { colors } from "../theme";

const DISMISS_KEY = "pick-the-pack:install-dismissed-at";
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

function isAlreadyInstalled() {
  if (typeof window === "undefined") return false;
  const standaloneMedia = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches;
  return standaloneMedia || window.navigator.standalone === true;
}

// iPadOS 13+ reports itself as a Mac, hence the touch-points check.
function isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function recentlyDismissed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_FOR_MS;
  } catch {
    return false;
  }
}

/**
 * "Install the app" nudge, rendered on the home screen for anyone who
 * hasn't installed the PWA yet — index.html's beforeinstallprompt listener
 * suppresses the browser's own native install UI unconditionally (for
 * every visitor, not just invite-link arrivals), so this is the ONLY
 * install affordance anyone gets and needs to be equally unconditional.
 * Chromium browsers hand us a real install prompt (captured early in
 * public/index.html); iOS Safari has no such API, so there it's a short
 * how-to for Add to Home Screen instead. Renders nothing on native builds,
 * when already installed, when the browser offers no way to install, or
 * for a week after being dismissed.
 */
export default function InstallPrompt() {
  const [hasPrompt, setHasPrompt] = useState(() => typeof window !== "undefined" && !!window.__pwaInstallPrompt);
  const [hidden, setHidden] = useState(() => Platform.OS !== "web" || isAlreadyInstalled() || recentlyDismissed());

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onAvailable = () => setHasPrompt(true);
    const onInstalled = () => setHidden(true);
    window.addEventListener("pwa-install-available", onAvailable);
    window.addEventListener("pwa-installed", onInstalled);
    return () => {
      window.removeEventListener("pwa-install-available", onAvailable);
      window.removeEventListener("pwa-installed", onInstalled);
    };
  }, []);

  if (hidden) return null;
  const showIOSSteps = !hasPrompt && isIOS();
  if (!hasPrompt && !showIOSSteps) return null;

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Not persisting the dismissal just means it may show again — fine.
    }
  }

  async function install() {
    const prompt = window.__pwaInstallPrompt;
    if (!prompt) return;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      // Prompt already used or blocked — nothing to recover, just hide it.
    }
    window.__pwaInstallPrompt = null;
    setHidden(true);
  }

  return (
    <GlassPanel style={styles.panel} borderColor={colors.aquaDim}>
      <Text style={styles.title}>📲 Install Pick the Pack</Text>
      {hasPrompt ? (
        <>
          <Text style={styles.body}>Add it to your home screen to jump straight back into the table anytime.</Text>
          <View style={styles.buttonWrap}>
            <GradientButton onPress={install}>Install app</GradientButton>
          </View>
        </>
      ) : (
        <Text style={styles.body}>
          Tap the Share button in your browser, then choose “Add to Home Screen” to install it.
        </Text>
      )}
      <TouchableOpacity onPress={dismiss} activeOpacity={0.7} style={styles.dismiss}>
        <Text style={styles.dismissText}>Not now</Text>
      </TouchableOpacity>
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: { width: "100%", padding: 14, marginBottom: 16, alignItems: "center" },
  title: { color: colors.sunGold, fontSize: 15, fontWeight: "800", marginBottom: 6 },
  body: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18, marginBottom: 10 },
  buttonWrap: { width: "100%", marginBottom: 4 },
  dismiss: { paddingVertical: 4 },
  dismissText: { color: colors.textMuted, fontSize: 12 },
});
