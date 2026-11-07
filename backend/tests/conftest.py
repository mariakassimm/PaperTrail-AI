import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def make_pdf(pages: list[str]) -> bytes:
    doc = pymupdf.open()
    for text in pages:
        page = doc.new_page()
        if text:
            page.insert_textbox(pymupdf.Rect(50, 50, 550, 780), text, fontsize=11)
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def settings(tmp_path):
    return Settings(data_dir=tmp_path / "data", max_upload_mb=1)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as c:
        c.app_settings = settings
        yield c


def upload(client, data: bytes, name: str = "paper.pdf"):
    return client.post("/api/v1/documents", files={"file": (name, data, "application/pdf")})


SOLAR = ["Solar panels convert sunlight into electricity. The pump uses forty watts.",
         "Irrigation reduced water consumption by thirty eight percent in field trials."]
COOKING = ["Sourdough bread requires a mature starter, flour, water and salt.",
           "Baking temperature for the loaf is two hundred and thirty degrees."]
