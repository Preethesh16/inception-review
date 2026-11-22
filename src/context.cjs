"use strict";

const path = require("node:path");
const stop = new Set(
  "a an as at and be by for from in is it of on or that the this to which with".split(
    " ",
  ),
);

function words(text) {
  return (
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .match(/[a-z0-9]+/g) || []
  ).filter((word) => !stop.has(word));
}

function countWords(text) {
  const counts = new Map();
  for (const word of words(text)) counts.set(word, (counts.get(word) || 0) + 1);
  return counts;
}

class RepositoryIndex {
  constructor(files) {
    this.frequency = new Map();
    this.files = files.map(({ name, text }) => {
      const counts = countWords(text);
      for (const term of counts.keys())
        this.frequency.set(term, (this.frequency.get(term) || 0) + 1);
      const length = [...counts.values()].reduce((a, b) => a + b, 0);
      return { name, text, counts, length };
    });
    this.average =
      this.files.reduce((sum, file) => sum + file.length, 0) /
        this.files.length || 1;
  }

  retrieve(query, { budget = 6000, limit = 5, pinned = [] } = {}) {
    if (budget < 1 || limit < 1 || !this.files.length) return [];
    const terms = [...new Set(words(query))];
    const weights = new Map(
      terms.map((t) => [
        t,
        Math.log(
          1 +
            (this.files.length - (this.frequency.get(t) || 0) + 0.5) /
              ((this.frequency.get(t) || 0) + 0.5),
        ),
      ]),
    );
    const ranked = this.files
      .map((file) => {
        let score = 0;
        const matched = [];
        for (const [term, weight] of weights) {
          const occurrences = file.counts.get(term) || 0;
          if (!occurrences) continue;
          matched.push(term);
          score +=
            (weight * occurrences * 2.2) /
            (occurrences + 1.2 * (0.25 + (0.75 * file.length) / this.average));
        }
        const lexical = score;
        const filenameTerms = new Set(words(path.parse(file.name).name));
        for (const term of filenameTerms) {
          if (
            weights.has(term) &&
            !/^(test|tests|docs|src|lib|index)$/.test(term)
          )
            score += 1.25 * Math.log(this.files.length + 1) * weights.get(term);
        }
        return { file, score, lexical, matched };
      })
      .sort(
        (a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name),
      );
    const direct = [...ranked].sort((a, b) => b.lexical - a.lexical);
    const implementation = ranked.find(
      (item) =>
        item.score &&
        /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|cpp|cs|rb)$/i.test(
          item.file.name,
        ) &&
        !/(?:^|\/)(?:tests?|spec|examples?)(?:\/|_)/i.test(item.file.name),
    );
    const seed = implementation && path.parse(implementation.file.name).name;
    const hasCompanionName = (item) =>
      seed &&
      words(path.parse(item.file.name).name).includes(seed.toLowerCase());
    const boosted = (item) =>
      item.score +
      (hasCompanionName(item) ? Math.log(this.files.length + 1) * 2 : 0);
    const expanded = [...ranked].sort((a, b) => boosted(b) - boosted(a));
    const selected = new Map();
    const add = (item, reason) => {
      if (item && !selected.has(item.file.name) && selected.size < limit)
        selected.set(item.file.name, { item, reason });
    };
    for (const name of pinned)
      add(
        ranked.find((item) => item.file.name === name),
        "explicit file mention",
      );
    for (const item of direct.filter((item) => item.lexical > 0).slice(0, 2))
      add(item, "direct text match");
    for (const item of expanded.filter((item) => item.score > 0))
      add(
        item,
        hasCompanionName(item) && item !== implementation
          ? "shared filename with " + implementation.file.name
          : "direct text match",
      );

    const result = [];
    let remaining = budget;
    for (const { item, reason } of selected.values()) {
      const lines = item.file.text.split(/\r?\n/);
      const capacity = Math.floor(remaining / (selected.size - result.length));
      if (capacity < 1) break;
      const window = 10;
      const scores = lines.map((line) =>
        [...new Set(words(line))].reduce(
          (s, t) => s + (weights.get(t) || 0),
          0,
        ),
      );
      let score = 0,
        best = -1,
        start = 0;
      for (let i = 0; i < scores.length; ++i) {
        score += scores[i];
        if (i >= window) score -= scores[i - window];
        if ((i >= window - 1 || i === scores.length - 1) && score > best) {
          best = score;
          start = Math.max(0, i - window + 1);
        }
      }
      const excerpt = lines
        .slice(start, start + window)
        .join("\n")
        .slice(0, capacity);
      remaining -= excerpt.length;
      result.push({
        name: item.file.name,
        reason,
        matched: item.matched,
        line: start + 1,
        excerpt,
      });
    }
    return result;
  }
}
module.exports = { RepositoryIndex };
