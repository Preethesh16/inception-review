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
  return candidates.slice(0, 1).map(({ score, ...item }) => ({
    ...item,
    excerpt: item.excerpt.slice(0, budget),
  }));
}
// If the first test passage is mostly imports, find a short worked example
// that exercises an identifier from a retrieved implementation passage.
function relatedTest(name, source, implementation, budget) {
  if (!/(?:^|\/)test_[^/]+\.py$/.test(name) || budget < 80) return [];
  const identifiers = implementation.match(/\b[A-Za-z]\w*_\w+\b/g) || [];
  const words = new Set(
    identifiers
      .flatMap((word) => word.toLowerCase().split("_"))
      .filter((w) => w.length > 3),
  );
  if (!words.size) return [];
  const lines = source.split(/\r?\n/);
  let best;
  for (let i = 0; i < lines.length; i++) {
    const decl = /^(\s*)(?:async )?def (test_\w+)\(/.exec(lines[i]);
    if (!decl) continue;
    let end = i + 1;
    while (end < lines.length && end <= i + 16) {
      const line = lines[end];
      if (line.trim() && line.search(/\S/) <= decl[1].length) break;
      end++;
    }
    const excerpt = lines.slice(i, end).join("\n").trimEnd();
    if (!/\bassert\b/.test(excerpt)) continue;
    const terms = new Set(excerpt.toLowerCase().match(/[a-z0-9]+/g));
    const title = new Set(decl[2].toLowerCase().split("_"));
    const score = [...words].reduce(
      (n, w) => n + Number(terms.has(w)) + 3 * Number(title.has(w)),
      0,
    );
    if (
      score &&
      (!best ||
        score > best.score ||
        (score === best.score && excerpt.length < best.excerpt.length))
    ) {
      best = {
        name,
        line: i + 1,
        definition: decl[2],
        reason: "related test example",
        score,
        excerpt,
      };
    }
  }
  if (!best) return [];
  const { score, ...example } = best;
  return [{ ...example, excerpt: example.excerpt.slice(0, budget) }];
}

module.exports = { referencedDefinitions, relatedTest };
