"""Generate a small multi-page PDF fixture with known, checkable content.

A synthetic fixture beats a real document for the tests that matter here: we
know exactly which page each sentence is on, so a bbox that lands on the wrong
page is detectable without a human looking at a rendering.
"""

from pathlib import Path

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

OUT = Path(__file__).resolve().parents[1] / "samples" / "sample-agreement.pdf"

PAGES = [
    [
        ("Master Services Agreement", "Title"),
        (
            "This Agreement is entered into on 14 March 2019 between Northwind "
            "Logistics Ltd (the &quot;Supplier&quot;) and Ashcroft Medical Group "
            "(the &quot;Customer&quot;).",
            "BodyText",
        ),
        (
            "1. Term. The initial term of this Agreement is thirty-six (36) months "
            "commencing on the Effective Date.",
            "BodyText",
        ),
    ],
    [
        ("2. Termination", "Heading2"),
        (
            "Either party may terminate this Agreement for convenience upon thirty "
            "(30) days written notice to the other party.",
            "BodyText",
        ),
        (
            "In the event of a material breach, the non-breaching party may "
            "terminate immediately upon written notice.",
            "BodyText",
        ),
    ],
    [
        ("3. Limitation of Liability", "Heading2"),
        (
            "The aggregate liability of the Supplier under this Agreement shall not "
            "exceed two million pounds (GBP 2,000,000).",
            "BodyText",
        ),
        (
            "Nothing in this clause limits liability for death or personal injury "
            "caused by negligence.",
            "BodyText",
        ),
    ],
]


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    styles = getSampleStyleSheet()
    story = []
    for i, page in enumerate(PAGES):
        if i:
            story.append(PageBreak())
        for text, style in page:
            story.append(Paragraph(text, styles[style]))
            story.append(Spacer(1, 12))
    SimpleDocTemplate(str(OUT), pagesize=LETTER).build(story)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
