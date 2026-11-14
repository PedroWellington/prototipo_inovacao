import pytest

from tests.helpers import login_new_user, seed_minimal_catalog

PROFILE = {
    "segment_key": "farmacia",
    "revenue_band": "360k_4_8m",
    "has_hq": True,
    "hq_uf": "pe",
    "hq_municipality_ibge": 2611606,
    "hq_neighborhood_text": "Boa Vista",
    "criteria": [
        {"business_type_key": "hospital", "direction": "attract", "weight": 3},
        {"business_type_key": "clinica", "direction": "attract", "weight": 3},
        {"business_type_key": "farmacia", "direction": "repel", "weight": 3},
    ],
}


@pytest.fixture(autouse=True)
def catalog():
    seed_minimal_catalog()


def test_onboarding_flow(client):
    csrf = login_new_user(client)
    assert client.get("/api/profile").json() == {"profile": None, "criteria": []}
    r = client.put("/api/profile", json=PROFILE, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["profile"]["hq_uf"] == "PE" and body["profile"]["onboarding_completed_at"]
    assert len(body["criteria"]) == 3
    assert client.get("/api/auth/me").json()["onboarding_completed"] is True


@pytest.mark.parametrize(
    "change, message_part",
    [
        ({"criteria": [{"business_type_key": k, "direction": "attract", "weight": 3} for k in ("hospital", "clinica", "escola", "hotel")]}, "No máximo 3"),
        ({"criteria": [{"business_type_key": "farmacia", "direction": "attract", "weight": 3}, {"business_type_key": "farmacia", "direction": "repel", "weight": 3}]}, "só pode aparecer uma vez"),
        ({"criteria": [{"business_type_key": "escritorio", "direction": "attract", "weight": 3}]}, "desconhecido"),
        ({"segment_key": "outro"}, "Descreva o ramo"),
        ({"has_hq": True, "hq_municipality_ibge": None}, "estado e a cidade"),
        ({"hq_uf": "SP"}, "não pertence"),
    ],
)
def test_profile_validation(client, change, message_part):
    csrf = login_new_user(client)
    r = client.put("/api/profile", json={**PROFILE, **change}, headers={"X-CSRF-Token": csrf})
    assert r.status_code == 422
    assert message_part in r.json()["error"]["message"]


def test_weight_limits_and_criteria_update(client):
    csrf = login_new_user(client)
    bad = {"criteria": [{"business_type_key": "hospital", "direction": "attract", "weight": 6}]}
    assert client.put("/api/profile/criteria", json=bad, headers={"X-CSRF-Token": csrf}).status_code == 422
    good = {"criteria": [{"business_type_key": "hospital", "direction": "attract", "weight": 5}]}
    assert client.put("/api/profile/criteria", json=good, headers={"X-CSRF-Token": csrf}).status_code == 200
    assert client.get("/api/profile").json()["criteria"] == good["criteria"]
