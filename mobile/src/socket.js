import { io } from "socket.io-client";

let socket = null;
let connectedUrl = null;

/**
 * Returns a shared socket.io connection to `serverUrl`, reconnecting if the
 * URL changed since the last call. serverUrl works two ways:
 *  - Local testing: "http://192.168.1.23:4000" — your computer's LAN IP
 *    while running the server locally (see the README for how to find it).
 *    "localhost" will NOT work from a physical phone running Expo Go.
 *  - Hosted: a real "https://..." address (e.g. from Render or Fly.io — see
 *    DEPLOYMENT.md) works exactly the same way, no code changes needed, and
 *    lets players connect from anywhere instead of just the same wifi.
 */
export function getSocket(serverUrl) {
  if (socket && connectedUrl === serverUrl) {
    // Reconnect a socket that was manually disconnected (e.g. forfeiting
    // a mid-round leave) — socket.io-client won't do this on its own.
    if (!socket.connected) socket.connect();
    return socket;
  }
  if (socket) {
    socket.disconnect();
  }
  socket = io(serverUrl, { transports: ["websocket"], autoConnect: true });
  connectedUrl = serverUrl;
  return socket;
}

export function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (response && response.ok === false) {
        reject(new Error(response.error || "Unknown error"));
      } else {
        resolve(response);
      }
    });
  });
}
