import { Platform, Share } from "react-native";
import * as Clipboard from "expo-clipboard";

// The web app's own hosted origin — used as a fallback when we can't read
// window.location (native/Expo Go). On web, window.location.origin is used
// instead so a locally-run or LAN copy of the app shares a link that
// actually points back at itself, not always the production URL.
const FALLBACK_BASE_URL = "https://pickthepack.onrender.com";

/** A link that, opened in any browser, loads the app with the room code pre-filled. */
export function buildInviteLink(code) {
  const base = Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : FALLBACK_BASE_URL;
  return `${base}/?code=${code}`;
}

function buildInviteMessage(code) {
  return `Join my Pick the Pack table! ${buildInviteLink(code)}\n\n(Or just enter room code ${code} if that link doesn't work.)`;
}

/**
 * Shares the invite via the native/OS share sheet where available. Falls
 * back to copying the link to the clipboard when sharing isn't supported
 * (react-native-web's Share only works via the Web Share API, which most
 * desktop browsers don't implement) — calls `onCopied` so the screen can
 * show its own confirmation, since there's no OS-level feedback for a
 * clipboard copy the way there is for the share sheet.
 */
export async function shareInvite(code, { onCopied } = {}) {
  try {
    await Share.share({ message: buildInviteMessage(code) });
  } catch {
    try {
      await Clipboard.setStringAsync(buildInviteLink(code));
      onCopied && onCopied();
    } catch {
      // Nothing more we can do — let it fail quietly rather than crash.
    }
  }
}
