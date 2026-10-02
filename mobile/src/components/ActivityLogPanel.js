import React, { useState } from "react";
import { Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import GlassPanel from "./GlassPanel";
import { colors } from "../theme";

/**
 * A compact, read-only, collapsible feed of everything that's happened at
 * this table — every flip, knock, placement, join/leave, and round
 * result — not just the round-by-round summary RoundHistoryPanel shows.
 * The messages themselves are already fully formatted server-side (see
 * addLog in rooms.js); this just lists them newest-first. Session-lifetime
 * only and capped server-side (the last 20 entries), same as the rest of
 * the room's state. Renders nothing while there's nothing to show yet, so
 * a fresh table doesn't display an empty panel.
 */
export default function ActivityLogPanel({ log }) {
  const [expanded, setExpanded] = useState(false);
  if (!log || log.length === 0) return null;
  const newestFirst = [...log].reverse();

  return (
    <GlassPanel style={styles.panel}>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)} activeOpacity={0.7} style={styles.header}>
        <Text style={styles.headerText}>📝 Activity ({log.length})</Text>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {expanded && (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent} nestedScrollEnabled>
          {newestFirst.map((entry, i) => (
            <Text key={i} style={styles.entryText}>
              {entry.message}
            </Text>
          ))}
        </ScrollView>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: { width: "100%", marginBottom: 16, paddingVertical: 10, paddingHorizontal: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerText: { color: colors.sunGold, fontWeight: "700", fontSize: 13 },
  chevron: { color: colors.textMuted, fontSize: 11 },
  list: { marginTop: 10, maxHeight: 220 },
  listContent: { gap: 6 },
  entryText: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
});
