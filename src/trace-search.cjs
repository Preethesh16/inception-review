"use strict";

function findText(files, needle, restrict, limit = 12) {
  if (typeof needle !== "string" || !needle.trim())
    throw new Error("Supply a nonempty literal to locate.");
  const hits = [];
  const lower = needle.toLowerCase();
  for (const file of files) {
    if (restrict && file.name !== restrict) continue;
    const lines = file.text.split(/\r?\n/);
    for (let line = 0; line < lines.length; line++) {
      const column = lines[line].toLowerCase().indexOf(lower);
      if (column < 0) continue;
      hits.push({
        path: file.name,
        line: line + 1,
        text: lines[line].slice(
          Math.max(0, column - 60),
          column + needle.length + 90,
        ),
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}
// Give documentation reads a compact table of contents for targeted follow-up reads.
function sectionLocations(path, lines) {
  if (!/\.(?:md|rst)$/i.test(path)) return [];
  const sections = [];
  let fence = "";
  for (let i = 0; i < lines.length && sections.length < 35; i++) {
    const text = lines[i];
    if (path.toLowerCase().endsWith(".md")) {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(text)?.[1];
      const closesFence =
        marker && marker[0] === fence[0] && marker.length >= fence.length;
      if (marker && (!fence || closesFence)) {
        fence = fence ? "" : marker;
        continue;
      }
      if (fence || !/^#{1,4}\s+\S/.test(text)) continue;
      sections.push({
        line: i + 1,
        heading: text.replace(/^#+\s+/, "").slice(0, 100),
      });
    } else if (
      /^\S/.test(text) &&
      /^[=~^"'*+#-]{3,}\s*$/.test(lines[i + 1] || "") &&
      /[\p{L}\p{N}]/u.test(text)
    ) {
      sections.push({ line: i + 1, heading: text.slice(0, 100) });
    }
  }
  return sections;
}
module.exports = { findText, sectionLocations };
