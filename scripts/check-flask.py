"""Run Task B's observable behavior against a candidate Flask checkout."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path, help="Flask checkout containing the reviewed edits")
    args = parser.parse_args()
    checkout = args.checkout.resolve()
    if not (checkout / "src/flask/cli.py").is_file():
        parser.error("expected a Flask source checkout")
    revision = subprocess.run(
        ["git", "rev-parse", "--short=8", "HEAD"], cwd=checkout,
        text=True, capture_output=True, check=True,
    ).stdout.strip()
    print(f"Candidate revision: {revision}", flush=True)

    sample = {
        "API_TOKEN_SUFFIX": "demo-token-357", "A_SECRET_HINT": "demo-secret-774",
        "DB_PASSWORD_BACKUP": "demo-password-119", "SERVICE_KEY_ID": "demo-key-481",
        "SITE_NAME": "public demo", "WORKER_COUNT": 7, "FEATURE_ENABLED": False,
    }
    with tempfile.TemporaryDirectory(prefix="inception-flask-check-") as directory:
        # Keep Flask's standard defaults, including values other than JSON scalars.
        Path(directory, "inception_demo.py").write_text(
            "from flask import Flask\napp = Flask(__name__)\n"
            f"app.config.update({sample!r})\n", encoding="utf-8",
        )
        env = {**os.environ, "PYTHONPATH": os.pathsep.join([str(checkout / "src"), directory]),
               "PYTHONDONTWRITEBYTECODE": "1", "FLASK_SKIP_DOTENV": "1"}
        def run(*args):
            return subprocess.run([sys.executable, "-m", *args], cwd=checkout, env=env,
                                  capture_output=True, text=True, timeout=120)
        suite = run("pytest", "tests/test_cli.py", "-q", "-p", "no:cacheprovider")
        print(suite.stdout.strip() or suite.stderr.strip())
        help_result = run("flask", "--app", "inception_demo:app", "--help")
        command = run("flask", "--app", "inception_demo:app", "config")
        try:
            data = json.loads(command.stdout)
        except ValueError:
            data = None
        ordinary = ("SITE_NAME", "WORKER_COUNT", "FEATURE_ENABLED")
        protected = [key for key in sample if key not in ordinary]
        checks = {
            "Flask CLI tests": suite.returncode == 0,
            "config listed in CLI help": help_result.returncode == 0 and any(
                line.split()[:1] == ["config"] for line in help_result.stdout.splitlines()),
            "command exits successfully with a JSON object": command.returncode == 0 and isinstance(data, dict),
            "all four sensitive values masked": isinstance(data, dict) and all(
                data.get(key) == "***" and sample[key] not in command.stdout for key in protected),
            "ordinary string, integer and boolean values preserved": isinstance(data, dict) and all(
                key in data and type(data[key]) is type(sample[key]) and data[key] == sample[key] for key in ordinary),
        }
        if command.returncode:
            print(command.stderr.strip() or f"Command exited {command.returncode}.")
        for label, ok in checks.items():
            print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
