#!/usr/bin/env python3
"""Check the code references in onboarding pages before they are committed.

Usage: python check_refs.py <chapter folder or .html file> [...]

For every <pre data-file="path/from/repo/root"> snippet it checks that:
  - the file exists,
  - every numbered line is within the file and the numbers go up,
  - each numbered line shares at least one name with the real source line
    (catches line numbers that drifted after the code changed).
It also checks that every relative href/src on the page points at something that exists.

Exits 1 if anything is wrong, printing each problem with the real line beside it.
"""

import html
import re
import subprocess
import sys
from pathlib import Path

SNIPPET = re.compile(r'<pre[^>]*\bdata-file="([^"]+)"[^>]*>(.*?)</pre>', re.S)
NUMBERED = re.compile(r"^\s*(\d+)\s+(.*)$")
LINK = re.compile(r'\b(?:href|src)="([^"#?]+)[^"]*"')
NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]{2,}")
# Words too common to prove two lines are the same line.
COMMON = {
    "def", "return", "for", "while", "and", "not", "None", "True", "False", "self",
    "else", "elif", "import", "from", "const", "let", "function", "the", "with",
}


# The comment marker for each language: everything after it on a snippet line is the
# lesson's annotation, not source. It must follow whitespace, so `months // 12` survives.
COMMENT = {".py": "#", ".sh": "#", ".yml": "#", ".yaml": "#", ".toml": "#", ".sql": "--"}


def strip_notes(code: str, suffix: str) -> str:
    code = re.sub(r"\s*[◀①-⑳].*$", "", code)
    marker = COMMENT.get(suffix, "//")
    return re.split(r"\s" + re.escape(marker) + r"(?:\s|$)", code, maxsplit=1)[0]


def names(text: str) -> set[str]:
    return {n for n in NAME.findall(text) if n not in COMMON}


def repo_root(start: Path) -> Path:
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], cwd=start, capture_output=True, text=True, check=True
    )
    return Path(out.stdout.strip())


def check_page(page: Path, root: Path) -> list[str]:
    problems: list[str] = []
    text = page.read_text(encoding="utf-8")

    for rel, body in SNIPPET.findall(text):
        source = root / rel
        if not source.is_file():
            problems.append(f"{page.name}: snippet file not found: {rel}")
            continue
        real = source.read_text(encoding="utf-8").splitlines()
        body = html.unescape(re.sub(r"<[^>]+>", "", body))
        last = 0
        for shown in body.splitlines():
            m = NUMBERED.match(shown)
            if not m:
                continue
            no, code = int(m.group(1)), strip_notes(m.group(2), source.suffix)
            where = f"{page.name}: {rel}:{no}"
            if no <= last:
                problems.append(f"{where}: line numbers must go up (after {last})")
            last = no
            if no > len(real):
                problems.append(f"{where}: file has only {len(real)} lines")
                continue
            wanted = names(code)
            if wanted and not wanted & names(real[no - 1]):
                problems.append(
                    f"{where}: shown line shares no names with the source\n"
                    f"    shown:  {code.strip()}\n"
                    f"    source: {real[no - 1].strip()}"
                )

    for target in LINK.findall(text):
        if re.match(r"^[a-z]+:", target):  # http:, https:, mailto:
            continue
        if not (page.parent / target).exists():
            problems.append(f"{page.name}: broken link: {target}")

    return problems


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    pages: list[Path] = []
    for arg in sys.argv[1:]:
        p = Path(arg).resolve()
        pages += sorted(p.rglob("*.html")) if p.is_dir() else [p]
    if not pages:
        print("No .html pages found.")
        return 2
    root = repo_root(pages[0].parent)
    problems = [msg for page in pages for msg in check_page(page, root)]
    for msg in problems:
        print(msg)
    print(f"{len(pages)} page(s) checked, {len(problems)} problem(s).")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
