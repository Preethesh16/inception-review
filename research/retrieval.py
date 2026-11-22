"""Compare file retrieval baselines before designing the editor integration."""
from pathlib import Path
from collections import Counter
import math
import re
from statistics import mean

import argparse
import subprocess
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("checkout", type=Path, help="A checkout of the Flask 3.1.3 tag")
root = parser.parse_args().checkout.resolve()
documents = {}
tokenize = lambda text: re.findall(r"[a-z]+", text.lower())
tracked = subprocess.check_output(["git", "-C", root, "ls-files", "-z"]).decode().split("\0")
for name in filter(None, tracked):
    path = root / name
    if path.is_file() and path.suffix in {".py", ".rst", ".md"}:
        name = path.relative_to(root).as_posix()
        documents[name] = Counter(tokenize(path.read_text(errors="replace")))
length = mean(sum(doc.values()) for doc in documents.values())
freq = Counter(term for doc in documents.values() for term in doc)
query = "Add a new built-in CLI command flask config that prints the loaded application's configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY. It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands."
terms = set(tokenize(query)) - set("a an the by in as it of or and must be that to any s".split())

def rank(name):
    doc = documents[name]
    norm = 1.2 * (.25 + .75 * sum(doc.values()) / length)
    return sum(math.log(1 + (len(documents)-freq[t]+.5)/(freq[t]+.5))*doc[t]*2.2/(doc[t]+norm) for t in terms)

ranked = sorted(documents, key=rank, reverse=True)
print("Documents",len(ranked),"top 8", ranked[:8])
for relevant in ["src/flask/cli.py","tests/test_cli.py","docs/cli.rst"]:
    print(relevant, "rank", ranked.index(relevant)+1)

# Score candidates against the first implementation result and evaluate
# whether sibling docs and tests become more accessible to a small prompt.
seed = next(p for p in ranked if p.split("/")[0] in {"src", "lib", "app"})
symbol = Path(seed).stem
def expand(name):
    labels = set(tokenize(Path(name).stem))
    return rank(name) + (math.log(len(documents)) * 2 if symbol in labels else 0)
reranked = sorted(documents, key=expand, reverse=True)
print("Seed", seed, "reranked top 8", reranked[:8])

study = [
    ("environment", "Support custom prefixes and nested keys when loading configuration from environment variables, with tests and documentation", ["src/flask/config.py", "tests/test_config.py", "docs/config.rst"]),
    ("templates", "Explain which template loader finds a template when multiple blueprints provide it, including debug output and tests", ["src/flask/templating.py", "tests/test_templating.py", "docs/blueprints.rst"]),
    ("streaming", "Keep the request context available to a streaming generator and describe the pattern for streamed responses", ["src/flask/helpers.py", "docs/patterns/streaming.rst"]),
]
for title, prompt, expected in study:
    terms = set(tokenize(prompt)) - set("a an the and of to for it with".split())
    ranked = sorted(documents, key=rank, reverse=True)
    seed = next(p for p in ranked if p.startswith("src/"))
    symbol = Path(seed).stem
    updated = sorted(documents, key=expand, reverse=True)
    print(title, seed, [(path, ranked.index(path)+1, updated.index(path)+1) for path in expected])

# Deterministic stress test for minor wording changes. This perturbs the
# retrieval input only; it does not simulate or measure model sampling.
import random
for title, prompt, expected in [("contest", query, ["src/flask/cli.py", "tests/test_cli.py", "docs/cli.rst"]), *study]:
    hits = []
    for trial in range(20):
        rng = random.Random(trial)
        tokens = tokenize(prompt)
        terms = {t for t in tokens if rng.random() >= .2} - set("a an the by in as it of or and must be that to any s".split())
        ranked = sorted(documents, key=rank, reverse=True)
        seed = next(p for p in ranked if p.startswith("src/"))
        symbol = Path(seed).stem
        updated = sorted(documents, key=expand, reverse=True)
        hits.append([sum(p in top[:5] for p in expected) / len(expected) for top in (ranked, updated)])
    print(title, "mean labeled file recall at 5, lexical then expanded", [round(mean(z), 3) for z in zip(*hits)])
