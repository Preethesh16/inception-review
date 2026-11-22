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
module.exports = { findText };
