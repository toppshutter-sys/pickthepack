import { Platform } from "react-native";

// Web push's applicationServerKey wants the VAPID public key as a raw
// Uint8Array, not the base64url string the server hands out — this is the
// standard conversion (same one MDN's own push guide uses).
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Whether this platform/browser can even offer push notifications at all. */
export function isPushSupported() {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** The subscription already on file with the browser, if any — used to restore the toggle's state on mount without re-prompting. */
export async function getExistingSubscription() {
  if (!isPushSupported()) return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/**
 * Requests Notification permission (if not already granted or denied),
 * subscribes this browser to push, and registers the subscription with
 * the server for this specific room/seat. Throws with a message meant to
 * be shown directly to the player (see GameScreen's PushToggle) — there's
 * a real, actionable reason for every failure mode here (unsupported
 * browser, denied permission, server misconfiguration), unlike sound/
 * haptics failures elsewhere in the app which are silently swallowed
 * because they're just a nice-to-have.
 */
export async function subscribeToPush(socket, code) {
  if (!isPushSupported()) {
    throw new Error("This browser doesn't support push notifications.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Notification permission was denied — enable it in your browser's site settings to turn this on.");
  }

  // Same-origin by design (see DEPLOYMENT.md / inviteLink.js's identical
  // assumption): the web app and the game server are always the same
  // Render service, same URL, so there's no separate "API base" to thread
  // in as a prop here.
  const res = await fetch(`${window.location.origin}/push/public-key`);
  if (!res.ok) throw new Error("Could not reach the server for push setup.");
  const { publicKey } = await res.json();

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await new Promise((resolve, reject) => {
    socket.emit("register-push-subscription", { code, subscription: subscription.toJSON() }, (response) => {
      if (response && response.ok === false) reject(new Error(response.error || "Could not register for notifications."));
      else resolve();
    });
  });

  return subscription;
}

/** Unsubscribes this browser from push and tells the server to drop the registration. */
export async function unsubscribeFromPush(socket, code) {
  const subscription = await getExistingSubscription();
  if (subscription) {
    await subscription.unsubscribe().catch(() => {});
  }
  socket.emit("unregister-push-subscription", { code }, () => {});
}
