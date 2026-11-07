"""Generate sample_data/sample_paper.pdf (a FICTIONAL paper used for demos and evaluation)."""
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

PAGES = [
    [("Title", "SolarDrip: A Low-Cost Solar-Powered Drip Irrigation System for Smallholder Farms"),
     ("Heading2", "Abstract"),
     ("Normal", "This fictional sample paper describes SolarDrip, a drip irrigation system powered by a "
      "small solar panel. We deployed the system on 12 farms over two growing seasons. Compared with "
      "flood irrigation, SolarDrip reduced water use by 38 percent. Tomato yields increased by 21 "
      "percent on the farms that adopted the system.")],
    [("Heading2", "Methods"),
     ("Normal", "Each installation uses a 40 watt submersible pump and a single solar panel. Soil moisture "
      "is measured with capacitive sensors that sample every 15 minutes. A controller built around an "
      "ESP32 microcontroller opens the pump when soil moisture falls below a configured threshold. "
      "The trial covered 12 farms across two seasons, and each farm kept a flood-irrigated control plot.")],
    [("Heading2", "Results and Limitations"),
     ("Normal", "The average cost was 140 US dollars per installation, with an estimated payback period of "
      "14 months. Limitations: the system was only tested on tomato and okra crops, and no data was "
      "collected for saline soils. Results may not generalise to other crops or regions."),
     ("Normal", "This document is synthetic and was generated for software testing; it reports no real study.")],
]


def build(target: Path) -> None:
    styles = getSampleStyleSheet()
    story = []
    for i, page in enumerate(PAGES):
        for style, text in page:
            story += [Paragraph(text, styles[style]), Spacer(1, 10)]
        if i < len(PAGES) - 1:
            story.append(PageBreak())
    SimpleDocTemplate(str(target), pagesize=A4, title="SolarDrip (fictional sample)").build(story)


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "sample_data" / "sample_paper.pdf"
    out.parent.mkdir(exist_ok=True)
    build(out)
    print(f"wrote {out}")
