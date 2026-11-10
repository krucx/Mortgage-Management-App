"""Keep source documentation outside the GitHub Pages publishing tree."""

import re
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
DOCUMENTATION = REPO / "Documentation"
PAGES = REPO / "docs"


def test_canonical_domain_docs_and_architecture_records_are_present():
    glossary = DOCUMENTATION / "GLOSSARY.md"
    assert glossary.is_file()
    glossary_text = glossary.read_text()
    assert "## People" in glossary_text
    assert "## Lending" in glossary_text
    assert "**Outstanding**:" in glossary_text
    assert "**Discount**:" in glossary_text
    assert "Principal plus unpaid interest plus its Interest to Date" in glossary_text

    adr_dir = DOCUMENTATION / "adr"
    adrs = sorted(adr_dir.glob("*.md"))
    assert [path.stem[:4] for path in adrs] == [f"{number:04d}" for number in range(1, 20)]
    assert all(path.read_text().strip() for path in adrs)
    assert "The Ledger is derived, not stored" in (
        adr_dir / "0001-ledger-is-derived-not-stored.md"
    ).read_text()
    assert "non-cash" in (
        adr_dir / "0014-discounts-are-non-cash-payment-reductions.md"
    ).read_text()
    assert "Starting Terms can be corrected" in (
        adr_dir / "0015-starting-terms-can-be-corrected.md"
    ).read_text()

    for name in ("domain.md", "issue-tracker.md", "triage-labels.md"):
        assert (DOCUMENTATION / "agents" / name).is_file()
    assert len(list((DOCUMENTATION / "architecture-reviews").glob("review-pass-*/**/*.html"))) == 7
    assert not (REPO / "GLOSSARY.md").exists()


def test_pages_tree_has_no_source_markdown_or_duplicate_reference_trees():
    markdown = [
        path
        for path in PAGES.rglob("*.md")
        if "node_modules" not in path.parts
    ]
    assert not markdown
    for name in ("adr", "agents", "architecture-reviews"):
        assert not (PAGES / name).exists()


def test_pages_links_to_existing_canonical_source_docs():
    links = set()
    for page in PAGES.rglob("*.html"):
        content = page.read_text(errors="ignore")
        links.update(
            link.rstrip("\\")
            for link in re.findall(
                r"https://github\.com/krucx/Mortgage-Management-App/blob/main/(Documentation/[^\s\"<>#)]+)",
                content,
            )
        )

    assert "Documentation/GLOSSARY.md" in links
    assert any(link.startswith("Documentation/adr/") for link in links)
    assert all((REPO / link).is_file() for link in links)
