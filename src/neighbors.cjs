"use strict";

// Follow identifiers in retrieved passages to local Python definitions. The
// excerpt includes decorators and the signature, plus the start of the body.
function referencedDefinitions(name, source, passage, query, budget) {
  if (!name.endsWith(".py") || budget < 1) return [];
  const lines = source.split(/\r?\n/);
  const queryWords = new Set(query.toLowerCase().match(/[a-z0-9]+/g) || []);
  const identifiers = new Set(passage.match(/[A-Za-z_]\w*/g) || []);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(?:async\s+)?(?:def|class)\s+(\w+)/.exec(lines[i]);
    if (!match || !identifiers.has(match[1]) || passage.includes(lines[i]))
      continue;
    let start = i;
    // Capture simple adjacent decorators; multiline decorators stay in the file.
    while (start && lines[start - 1].startsWith("@")) start--;
    const excerpt = lines.slice(start, i + 9).join("\n");
    const terms = new Set(
      (match[1] + " " + excerpt).toLowerCase().match(/[a-z0-9]+/g) || [],
    );
    const score = [...queryWords].filter((t) => terms.has(t)).length;
    candidates.push({
      name,
      line: start + 1,
      definition: match[1],
      score,
      excerpt,
    });
  }
  candidates.sort((a, b) => b.score - a.score || a.line - b.line);
  return candidates
    .slice(0, 1)
    .map(({ score, ...item }) => ({
      ...item,
      excerpt: item.excerpt.slice(0, budget),
    }));
}
module.exports = { referencedDefinitions };
