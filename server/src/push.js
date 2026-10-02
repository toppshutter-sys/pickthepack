"use strict";

const webpush = require("web-push");

/**
 * VAPID keys authenticate this server to browser push services (Google's,
 * Mozilla's, etc.) — they identify WHO is sending pushes, not WHAT'S in
 * them, and the public half is handed to every subscribing browser as a
 * matter of course anyway. Generated once (`web-push generate-vapid-keys`)
 * and committed here, consistent with this app's existing no-secrets
 * posture (see the money-note atop rooms.js) rather than requiring a
 * Render env var nobody would remember to set. Override via env vars if
 * you want your own.
 */
const VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BK2I78cVcg9FzraQUlCqeFScVQy08ck1ZZ7NVxMyEmdmPNIhkR1w1triXy7k5avsya3sfQoPd3lbAAQbflk0y5U";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "g1KKuwukMtgPC6PyehcuXmE7-NVnrlWhjPh8DmxaU0o";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:pickthepack@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

/**
 * Sends one push notification, swallowing the failure modes that just mean
 * "this subscription is dead" (uninstalled, permissions revoked, browser
 * storage cleared) rather than anything the caller can act on — there's no
 * retry that makes sense here, and the only reference to a bad
 * subscription is the in-memory player object that handed it to us, which
 * naturally gets overwritten the next time (if ever) that player
 * re-subscribes.
 */
function sendPush(subscription, payload) {
  if (!subscription) return Promise.resolve();
  return webpush.sendNotification(subscription, JSON.stringify(payload)).catch(() => {});
}

module.exports = { VAPID_PUBLIC_KEY, sendPush };
