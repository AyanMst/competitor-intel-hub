#!/usr/bin/env python3
"""Run pip-audit and fail the process only on HIGH/CRITICAL findings.

pip-audit itself exits non-zero for any vulnerability, including low
severity. This wrapper prints the full report, then exits 1 only when a
finding is HIGH, CRITICAL, or CVSS >= 7.0. Findings with no severity
metadata are listed and do not fail the build.

Used by .github/workflows/dependency-audit.yml. Not imported by api.py
or the job worker.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REQUIREMENTS = ROOT / "requirements.txt"
FAIL_LABELS = {"HIGH", "CRITICAL"}
CVSS_HIGH_THRESHOLD = 7.0

# CVSS:3.1/AV:N/AC:L/... base score is not always embedded; some OSV
# records put a numeric score in the vector's trailing comment or a
# sibling field. We also accept a standalone 0.0–10.0 float.
_CVSS_VECTOR = re.compile(r"CVSS:3\.[01]/[A-Z:./]+", re.IGNORECASE)
_NUMERIC_SCORE = re.compile(r"\b(\d{1,2}(?:\.\d+)?)\b")


def _cvss_base_score(vector: str) -> float | None:
    """Best-effort CVSS v3 base score from a vector string.

    Uses the standard metric weights rather than a full CVSS library so
    this script has no extra dependency. Returns None if the vector is
    missing required metrics.
    """
    metrics = {}
    for part in vector.split("/"):
        if ":" not in part or part.upper().startswith("CVSS"):
            continue
        key, value = part.split(":", 1)
        metrics[key.upper()] = value.upper()

    av = {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.20}.get(metrics.get("AV", ""))
    ac = {"L": 0.77, "H": 0.44}.get(metrics.get("AC", ""))
    # Privileges Required depends on Scope
    scope_changed = metrics.get("S") == "C"
    pr = {
        "N": 0.85,
        "L": 0.68 if scope_changed else 0.62,
        "H": 0.50 if scope_changed else 0.27,
    }.get(metrics.get("PR", ""))
    ui = {"N": 0.85, "R": 0.62}.get(metrics.get("UI", ""))
    c = {"N": 0.0, "L": 0.22, "H": 0.56}.get(metrics.get("C", ""))
    i = {"N": 0.0, "L": 0.22, "H": 0.56}.get(metrics.get("I", ""))
    a = {"N": 0.0, "L": 0.22, "H": 0.56}.get(metrics.get("A", ""))
    if None in (av, ac, pr, ui, c, i, a):
        return None

    exploitability = 8.22 * av * ac * pr * ui
    impact_sub = 1 - ((1 - c) * (1 - i) * (1 - a))
    if impact_sub <= 0:
        return 0.0
    if scope_changed:
        impact = 7.52 * (impact_sub - 0.029) - 3.25 * (impact_sub - 0.02) ** 15
    else:
        impact = 6.42 * impact_sub
    if impact <= 0:
        return 0.0
    raw = min(10.0, impact + exploitability) if not scope_changed else min(10.0, 1.08 * (impact + exploitability))
    # CVSS v3 rounding: ceil to 1 decimal
    return round(int(raw * 10 + 0.999999) / 10.0, 1) if raw < 10 else 10.0


def _severity_is_high(vuln: dict) -> bool:
    label = vuln.get("severity")
    if isinstance(label, str) and label.upper() in FAIL_LABELS:
        return True

    entries = label if isinstance(label, list) else []
    extras = vuln.get("severities")
    if isinstance(extras, list):
        entries = [*entries, *extras]

    for item in entries:
        if isinstance(item, str) and item.upper() in FAIL_LABELS:
            return True
        if not isinstance(item, dict):
            continue
        for key in ("severity", "level", "rating"):
            value = item.get(key)
            if isinstance(value, str) and value.upper() in FAIL_LABELS:
                return True
        score = item.get("score")
        if isinstance(score, (int, float)) and float(score) >= CVSS_HIGH_THRESHOLD:
            return True
        if isinstance(score, str):
            if score.upper() in FAIL_LABELS:
                return True
            match = _CVSS_VECTOR.search(score)
            if match:
                computed = _cvss_base_score(match.group(0))
                if computed is not None and computed >= CVSS_HIGH_THRESHOLD:
                    return True
            numeric = _NUMERIC_SCORE.fullmatch(score.strip())
            if numeric and float(numeric.group(1)) >= CVSS_HIGH_THRESHOLD:
                return True

    description = vuln.get("description") or ""
    match = _CVSS_VECTOR.search(description)
    if match:
        computed = _cvss_base_score(match.group(0))
        if computed is not None and computed >= CVSS_HIGH_THRESHOLD:
            return True
    return False


def main() -> int:
    if not REQUIREMENTS.exists():
        print(f"missing {REQUIREMENTS}", file=sys.stderr)
        return 2

    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "pip_audit",
            "-r",
            str(REQUIREMENTS),
            "--format",
            "json",
            "--progress-spinner",
            "off",
        ],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )

    raw = proc.stdout.strip() or proc.stderr.strip()
    if proc.returncode not in (0, 1):
        print(proc.stdout, end="")
        print(proc.stderr, end="", file=sys.stderr)
        print(f"pip-audit failed with exit code {proc.returncode}", file=sys.stderr)
        return proc.returncode

    try:
        payload = json.loads(proc.stdout or "{}")
    except json.JSONDecodeError:
        print(proc.stdout, end="")
        print(proc.stderr, end="", file=sys.stderr)
        print("pip-audit did not return JSON; failing the job", file=sys.stderr)
        return 2

    dependencies = payload.get("dependencies") or []
    high_findings: list[tuple[str, str, str]] = []
    other_count = 0

    for dep in dependencies:
        name = dep.get("name") or "unknown"
        version = dep.get("version") or "?"
        for vuln in dep.get("vulns") or []:
            vuln_id = vuln.get("id") or "unknown"
            summary = f"{name}=={version} {vuln_id}"
            if _severity_is_high(vuln):
                high_findings.append((name, version, vuln_id))
                print(f"HIGH/CRITICAL  {summary}")
            else:
                other_count += 1
                print(f"low/moderate/unknown  {summary}")

    print(
        f"pip-audit summary: {len(high_findings)} high/critical, "
        f"{other_count} below-threshold (not failing the build)"
    )
    if high_findings:
        print("Failing because high/critical vulnerabilities were found.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
