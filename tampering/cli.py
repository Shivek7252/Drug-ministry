"""
CLI entry point.

  python cli.py path/to/document.pdf [--json] [--snapshot path/to/cdsco.csv]

Prints the report. With --json, prints the raw JSON the API would return.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Windows consoles default to cp1252 — force UTF-8 so verdict strings
# (em-dash, ≥) and finding messages render correctly.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from engine import analyze_document
from issuer_verifiers import CDSCOVerifier


def _ascii_severity(sev: str) -> str:
    return f"[{sev:^8}]"


def _print_human(report: dict) -> None:
    print(f"\nVERDICT : {report['verdict']}")
    print(f"SCORE   : {report['score']}")
    print(f"KIND    : {report['layers'].get('kind', '?')}")

    fields = report.get("extracted_fields") or {}
    if fields:
        print("\nExtracted fields:")
        for k, v in fields.items():
            print(f"  {k:14s} {v}")

    findings = report.get("findings") or []
    if findings:
        print("\nFindings:")
        for f in findings:
            print(f"  {_ascii_severity(f['severity'])} {f['analyzer']}/{f['code']}")
            print(f"            {f['message']}")

    print(f"\n{report['disclaimer']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Document forensics CLI")
    parser.add_argument("path", help="path to PDF or image")
    parser.add_argument("--json", action="store_true", help="emit raw JSON")
    parser.add_argument("--snapshot", help="path to CDSCO snapshot CSV/JSON")
    parser.add_argument("--no-verifier", action="store_true",
                        help="skip issuer verification")
    args = parser.parse_args(argv)

    p = Path(args.path)
    if not p.exists():
        print(f"file not found: {p}", file=sys.stderr)
        return 2

    data = p.read_bytes()
    verifier = None if args.no_verifier else CDSCOVerifier(snapshot_path=args.snapshot)

    report = analyze_document(data, filename=p.name, issuer_verifier=verifier).to_dict()
    if args.json:
        json.dump(report, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        _print_human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
