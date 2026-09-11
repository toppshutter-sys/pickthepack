import React, { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import GlassPanel from "./GlassPanel";
import { colors } from "../theme";

/** "Ann" / "Ann & Bo" / "Ann, Bo & Cy" — natural-language join for a
 * winners list (1 entry normally, more only on a split-pot tie). */
function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

function formatEntry(entry) {
  const verb = entry.winners.length > 1 ? "split" : "won";
  return `${joinNames(entry.winners)} ${verb} $${entry.potAmount} — ${entry.method}`;
}

/**
 * A compact, read-only, collapsible log of past rounds this table has
 * played this session — session-lifetime only, same as the running net
 * totals it complements: it lives as long as the room does and resets
 * whenever the table itself does (see room.history on the server).
 * Renders nothing at all when there's no history yet, so a fresh table
 * doesn't show an empty panel.
 */
export default function RoundHistoryPanel({ history }) {
  const [expanded, setExpanded] = useState(false);
  if (!history || history.length === 0) return null;
  const newestFirst = [...history].reverse();

  return (
    <GlassPanel style={styles.panel}>
      <TouchableOpacity onPress={() => setExpanded((e) => !e)} activeOpacity={0.7} style={styles.header}>
        <Text style={styles.headerText}>📜 Round History ({history.length})</Text>
        <Text style={styles.chevron}>{expanded ? "▲" : "▼"}</Text>
      </TouchableOpacity>
      {expanded && (
        <View style={styles.list}>
          {newestFirst.map((entry, i) => (
            <Text key={i} style={styles.entryText}>
              {formatEntry(entry)}
            </Text>
          ))}
        </View>
      )}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  panel: { width: "100%", marginBottom: 16, paddingVertical: 10, paddingHorizontal: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  headerText: { color: colors.sunGold, fontWeight: "700", fontSize: 13 },
  chevron: { color: colors.textMuted, fontSize: 11 },
  list: { marginTop: 10, gap: 6 },
  entryText: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
});
