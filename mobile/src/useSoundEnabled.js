import { useState, useEffect, useRef, useCallback } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "pick-the-pack:sound-enabled";

// Shared on/off preference for sound effects, persisted across sessions.
// Returns a ref alongside the state so callers that fire sounds from
// inside other event-driven effects (see GameScreen's flip/knock/win/start
// trackers) can check the current value without adding it to their
// dependency arrays — toggling sound shouldn't retrigger event detection.
export function useSoundEnabled() {
  const [enabled, setEnabledState] = useState(true);
  const enabledRef = useRef(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw === "false") {
          setEnabledState(false);
          enabledRef.current = false;
        }
      })
      .catch(() => {
        // ignore — default to sound on
      });
  }, []);

  const setEnabled = useCallback((value) => {
    setEnabledState(value);
    enabledRef.current = value;
    AsyncStorage.setItem(STORAGE_KEY, value ? "true" : "false").catch(() => {
      // ignore — preference just won't persist this time
    });
  }, []);

  return [enabled, setEnabled, enabledRef];
}
