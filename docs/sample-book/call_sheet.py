"""The day's Call Sheet as it comes back from whoever made the calls, for shots.mjs to
import: the served book's Excel export with a Call Note written against each row (the
ring's the same as the Lender's own, so the import leaves it out).

    cd backend && uv run python ../docs/sample-book/call_sheet.py <file> [base url]
"""

import sys
from io import BytesIO
from urllib.request import urlopen

from openpyxl import load_workbook

NOTES = {
    "2025-Arjun-GoldRingRuby": "Will pay after Diwali",
    "2026-Arjun-GoldChain": "Bringing the whole amount today",
}

if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit(__doc__)
    base = sys.argv[2] if len(sys.argv) == 3 else "http://127.0.0.1:8765"
    with urlopen(f"{base}/api/call-list/export.xlsx") as response:
        workbook = load_workbook(BytesIO(response.read()))
    sheet = workbook.active
    assert sheet is not None
    headings = [cell.value for cell in sheet[1]]
    name, note = headings.index("Mortgage Name"), headings.index("Call Note")
    for row in sheet.iter_rows(min_row=2):
        row[note].value = NOTES[str(row[name].value)]
    workbook.save(sys.argv[1])
