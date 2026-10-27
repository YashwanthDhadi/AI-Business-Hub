"""
Contract tests: the promises every HTTP route makes, checked through FastAPI's
TestClient. No live server, and no database - authentication and request
validation both happen before a route body runs.

The important one is `test_every_dashboard_route_requires_the_key`, which
ENUMERATES the routes from the app itself. A new route added without the guard
fails this test the moment it exists, instead of waiting for someone to notice.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app

pytestmark = pytest.mark.contract

BUSINESS = "a1b2c3d4-0000-4000-8000-000000000001"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def dashboard_routes() -> list[tuple[str, str]]:
    """
    Every (method, path) under /api/v1/dashboard, read from the OpenAPI
    document rather than app.routes.

    This FastAPI version wraps included routers, so app.routes entries have no
    .path and the list came back empty - a test that silently checked nothing.
    The OpenAPI document is also the contract we actually publish, so it is
    the more honest source.
    """
    found = []
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/api/v1/dashboard"):
            continue
        for method in operations:
            if method.upper() not in {"HEAD", "OPTIONS", "PARAMETERS"}:
                found.append((method.upper(), path))
    return sorted(found)


def fill(path: str) -> str:
    """Replace {placeholders} with a syntactically valid uuid."""
    out = path
    while "{" in out:
        start, end = out.index("{"), out.index("}")
        out = out[:start] + "00000000-0000-4000-8000-000000000000" + out[end + 1 :]
    return out


# ------------------------------------------------------------ the guard


def test_there_are_dashboard_routes_to_check():
    """If this fails the enumeration is broken and the next test proves nothing."""
    assert len(dashboard_routes()) >= 25


@pytest.mark.parametrize("method, path", dashboard_routes())
def test_every_dashboard_route_requires_the_key(client, method, path):
    response = client.request(method, fill(path), params={"business_id": BUSINESS}, json={})
    assert response.status_code == 401, f"{method} {path} answered {response.status_code} with no key"
    assert "X-Dashboard-Key" in response.json()["detail"]


@pytest.mark.parametrize("method, path", dashboard_routes())
def test_a_wrong_key_is_refused_too(client, method, path):
    response = client.request(
        method, fill(path), params={"business_id": BUSINESS}, json={},
        headers={"X-Dashboard-Key": "not-the-key"},
    )
    assert response.status_code == 401


def test_the_public_chat_needs_no_key(client):
    """The public API has no secret to protect - that is the whole design."""
    response = client.post("/api/v1/chat/session", json={"chat_slug": "definitely-not-a-business"})
    assert response.status_code != 401


def test_the_public_pay_page_needs_no_key(client):
    """The random token in the URL is the permission."""
    response = client.get("/api/v1/pay/0123456789abcdef0123456789abcdef")
    assert response.status_code != 401


def test_health_needs_no_key(client):
    assert client.get("/health").status_code == 200


# ------------------------------------------------------- request validation


@pytest.fixture
def keyed():
    """A client that gets past authentication, so validation can be tested."""
    with TestClient(app) as test_client:
        test_client.headers.update({"X-Dashboard-Key": settings.dashboard_api_key})
        yield test_client


@pytest.mark.parametrize(
    "path, payload, why",
    [
        ("/api/v1/dashboard/inventory", {"name": ""}, "an item needs a name"),
        ("/api/v1/dashboard/inventory", {"name": "x", "quantity": -5}, "negative opening stock"),
        ("/api/v1/dashboard/inventory", {"name": "x", "cost_price": -1}, "negative price"),
        ("/api/v1/dashboard/documents", {"title": ""}, "a document needs a title"),
        ("/api/v1/dashboard/communication", {"name": "x", "body": "ab"}, "message too short"),
        ("/api/v1/dashboard/communication", {"body": "long enough"}, "no name"),
        ("/api/v1/dashboard/payments/invoices", {}, "no customer"),
    ],
)
def test_bad_payloads_are_refused_before_anything_happens(keyed, path, payload, why):
    """
    422 from Pydantic, before the route body runs - so nothing reaches the
    database and no half-written row is possible.
    """
    response = keyed.post(path, params={"business_id": BUSINESS}, json=payload)
    assert response.status_code == 422, f"{why}: got {response.status_code}"


@pytest.mark.parametrize("days", [0, -1, 91, 1000])
def test_the_report_window_is_bounded(keyed, days):
    response = keyed.get("/api/v1/dashboard/reports", params={"business_id": BUSINESS, "days": days})
    assert response.status_code == 422


def test_a_missing_business_id_is_refused(keyed):
    """Every dashboard route is scoped to one tenant; there is no default."""
    assert keyed.get("/api/v1/dashboard/inventory").status_code == 422


# ---------------------------------------------------------------- shapes


def test_an_unknown_path_is_404(client):
    assert client.get("/api/v1/dashboard/nothing-here").status_code == 404


def test_errors_are_json_with_a_detail(client):
    body = client.get("/api/v1/dashboard/inventory", params={"business_id": BUSINESS}).json()
    assert isinstance(body, dict) and "detail" in body


def test_no_secret_is_ever_echoed_back(client):
    """A 401 must not helpfully explain what the right key looks like."""
    text = client.get("/api/v1/dashboard/inventory", params={"business_id": BUSINESS}).text
    for secret in (settings.dashboard_api_key, settings.supabase_service_role_key,
                   settings.openrouter_api_key, settings.google_api_key):
        if secret:
            assert secret not in text


def test_the_openapi_document_builds(client):
    """A broken response model breaks /docs, which is how you debug everything else."""
    spec = client.get("/openapi.json")
    assert spec.status_code == 200
    assert spec.json()["info"]["title"] == "AI Business Hub API"
