"""Money is held as integer paise; this formats it for messages the Lender reads."""


def format_inr(paise: int) -> str:
    """Indian digit grouping, e.g. 10900000 → "₹1,09,000"; paise shown only when present."""
    sign = "-" if paise < 0 else ""
    rupees, rest = divmod(abs(paise), 100)
    digits = str(rupees)
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        head, groups = head[:-2], [head[-2:], *groups]
    grouped = ",".join(part for part in [head, *groups, tail] if part)
    return f"{sign}₹{grouped}" + (f".{rest:02}" if rest else "")
