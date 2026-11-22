"use strict";

function references(prompt) {
  const result = [];
  for (const match of prompt.matchAll(
    /@(file|symbol)(?:\(([^)]+)\)|:([^\s,)]+)|\s+(`[^`]+`|[^\s,)]+))/g,
  )) {
    const value = (match[2] || match[3] || match[4]).replace(/^`|`$/g, "");
    result.push({ kind: match[1], value });
  }
  return result;
}

function definitions(index, name) {
  const symbol = name.split(".").pop();
  if (!/^[\w$]+$/.test(symbol)) return [];
  const escaped = symbol.replace(/\$/g, "\\$");
  const declaration = new RegExp(
    "(?:^|\\s)(?:async\\s+)?(?:def|class|function|interface|enum|struct|trait|fn|func|type|const|let|var)\\s+" +
      escaped +
      "(?=[\\s([<{:=;]|$)",
  );
  const results = [];
  for (const file of index.files) {
    const lines = file.text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (declaration.test(lines[i]))
        results.push({
          name: file.name,
          line: i + 1,
          excerpt: lines
            .slice(i, i + 8)
            .join("\n")
            .slice(0, 700),
        });
      if (results.length === 8) return results;
    }
  }
  return results;
}
module.exports = { references, definitions };
