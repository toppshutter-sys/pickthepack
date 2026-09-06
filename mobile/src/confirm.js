import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirm dialog. react-native-web's Alert.alert is a
 * total no-op (no dialog shown, no button callbacks ever fire), which
 * silently broke every "Leave table?" confirmation on the web build —
 * this falls back to the browser's native window.confirm() there instead.
 */
export function confirmAsync(title, message, confirmLabel = "OK") {
  if (Platform.OS === "web") {
    return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
