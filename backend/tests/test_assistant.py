"""Assistente de IA: regras de conteúdo, limites, falhas e privacidade. O provedor é simulado (sem rede)."""

import json

import httpx
import pytest

from app import assistant, config
from app.api import assistant as api
from tests.helpers import login_new_user, seed_minimal_catalog

FORBIDDEN_SAMPLES = [
    "O melhor bairro para você é Boa Viagem.",
    "Com esses critérios o sucesso é garantido.",
    "Ali você terá lucro certo.",
    "Recomendo abrir na Torre.",
    "Essa é a melhor cidade do estado.",
    "É o local ideal para você.",
    "Os dados são 100% precisos.",
    "Você vai lucrar bastante.",
]


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setattr(config, "AI_ASSISTANT_ENABLED", True)
    monkeypatch.setattr(config, "AI_API_KEY", "chave-de-teste")
    monkeypatch.setattr(config, "AI_DAILY_LIMIT", 3)
    api.clear_ip_limits()
    seed_minimal_catalog()


def ask(client, csrf, message="Como a nota é calculada?", **extra):
    return client.post("/api/assistente", json={"message": message, **extra}, headers={"X-CSRF-Token": csrf})


@pytest.mark.parametrize("text", FORBIDDEN_SAMPLES)
def test_forbidden_phrases_are_detected(text):
    assert assistant.violations(text)


def test_allowed_vocabulary_passes():
    ok = "Os bairros que mais combinam com os critérios que você definiu são Torreão (nota 97,4/100) e Paissandu."
    assert assistant.violations(ok) == []


def test_system_prompt_has_the_rules():
    p = assistant.SYSTEM_PROMPT
    for rule in ("Não tenho esse dado", "Nunca invente", "melhor bairro", "garantido", "lucro", "os bairros que mais combinam"):
        assert rule.lower() in p.lower(), rule


def test_reply_never_contains_forbidden_phrases_even_if_the_model_insists(client, on, monkeypatch):
    calls = []
    monkeypatch.setattr(assistant, "call_model", lambda msgs: calls.append(msgs) or "O melhor bairro é a Torre, lucro garantido.")
    csrf = login_new_user(client)
    r = ask(client, csrf, "Qual o melhor bairro?")
    assert r.status_code == 200
    reply = r.json()["reply"]
    assert assistant.violations(reply) == [] and reply == assistant.SAFE_ANSWER
    assert len(calls) == 2  # pediu de novo uma vez antes de cair na resposta segura


def test_second_attempt_is_used_when_clean(client, on, monkeypatch):
    answers = iter(["Recomendo a Torre.", "Os bairros que mais combinam com seus critérios estão em Explorar."])
    monkeypatch.setattr(assistant, "call_model", lambda msgs: next(answers))
    csrf = login_new_user(client)
    assert ask(client, csrf).json()["reply"].startswith("Os bairros que mais combinam")


def test_context_is_real_and_private(client, on, monkeypatch):
    seen = {}
    monkeypatch.setattr(assistant, "call_model", lambda msgs: seen.setdefault("msgs", msgs) and "ok")
    csrf = login_new_user(client, email="privado@example.com")
    ask(client, csrf, city=2611606, neighborhood=1)
    blob = json.dumps(seen["msgs"], ensure_ascii=False)
    assert "privado@example.com" not in blob and "senha" not in blob.lower() and "password" not in blob
    ctx = json.loads(seen["msgs"][1]["content"].split("\n", 1)[1])
    # Cidade não liberada para a conta: nenhum número dela entra no contexto.
    assert ctx["cidade_atual"].startswith("A cidade desta tela não está aberta")
    assert {"criterios", "creditos", "cidades_abertas", "fontes"} <= ctx.keys()


def test_daily_limit_message_in_portuguese(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs: "ok")
    csrf = login_new_user(client)
    for _ in range(3):
        assert ask(client, csrf).status_code == 200
    r = ask(client, csrf)
    assert r.status_code == 429 and "limite de 3 perguntas por dia" in r.json()["error"]["message"]


def test_question_size_limit(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs: "ok")
    csrf = login_new_user(client)
    r = ask(client, csrf, "x" * (config.AI_MAX_CHARS + 1))
    assert r.status_code == 422 and "caracteres" in r.json()["error"]["message"]


def test_ip_limit(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs: "ok")
    monkeypatch.setattr(api, "IP_LIMIT", 2)
    monkeypatch.setattr(config, "AI_DAILY_LIMIT", 50)
    csrf = login_new_user(client)
    assert [ask(client, csrf).status_code for _ in range(3)] == [200, 200, 429]


def test_provider_down_is_handled_and_not_counted(client, on, monkeypatch):
    def down(msgs):
        raise assistant.Unavailable("provedor-404")

    monkeypatch.setattr(assistant, "call_model", down)
    csrf = login_new_user(client)
    r = ask(client, csrf)
    assert r.status_code == 503 and r.json()["error"]["message"] == "Assistente indisponível no momento (código: provedor-404)."
    monkeypatch.setattr(assistant, "call_model", lambda msgs: "ok")
    assert ask(client, csrf).json()["remaining"] == 2  # a falha não gastou a cota


def test_disabled_by_default_and_without_key(client, monkeypatch):
    seed_minimal_catalog()
    csrf = login_new_user(client)
    assert client.get("/api/config").json()["assistant"] is False
    assert ask(client, csrf).status_code == 404
    monkeypatch.setattr(config, "AI_ASSISTANT_ENABLED", True)  # ligado mas sem chave: continua desligado
    monkeypatch.setattr(config, "AI_API_KEY", "")
    assert client.get("/api/config").json()["assistant"] is False and ask(client, csrf).status_code == 404


def test_call_model_uses_configured_provider_without_real_network(monkeypatch):
    """Provedor simulado (httpx.MockTransport): confere URL, modelo e chave usados, sem rede de verdade."""
    seen = {}

    def fake_provider(request):
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"choices": [{"message": {"content": "resposta do provedor simulado"}}]})

    monkeypatch.setattr(config, "AI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")
    monkeypatch.setattr(config, "AI_API_KEY", "chave-gemini-de-teste")
    monkeypatch.setattr(config, "AI_MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(assistant.httpx, "post", lambda url, **kw: httpx.Client(transport=httpx.MockTransport(fake_provider)).post(url, **kw))

    out = assistant.call_model([{"role": "user", "content": "oi"}])

    assert out == "resposta do provedor simulado"
    assert seen["url"] == "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    assert seen["auth"] == "Bearer chave-gemini-de-teste"
    assert seen["body"]["model"] == "gemini-3.8-flash"


def test_call_model_raises_unavailable_on_429(monkeypatch):
    monkeypatch.setattr(config, "AI_API_KEY", "chave-de-teste")
    monkeypatch.setattr(assistant.httpx, "post", lambda url, **kw: httpx.Response(429))
    with pytest.raises(assistant.Unavailable):
        assistant.call_model([{"role": "user", "content": "oi"}])


def _raise_timeout(url, **kw):
    raise httpx.ReadTimeout("tempo esgotado")


@pytest.mark.parametrize("key, post, code", [
    ("", None, "sem-chave"),
    ("k", lambda url, **kw: httpx.Response(400, text="corpo-secreto"), "provedor-400"),
    ("k", lambda url, **kw: httpx.Response(401, text="corpo-secreto"), "provedor-401"),
    ("k", lambda url, **kw: httpx.Response(403, text="corpo-secreto"), "provedor-403"),
    ("k", lambda url, **kw: httpx.Response(404, text="corpo-secreto"), "provedor-404"),
    ("k", lambda url, **kw: httpx.Response(429, text="corpo-secreto"), "limite"),
    ("k", _raise_timeout, "rede"),
])
def test_error_code_on_screen_and_log_without_secrets(monkeypatch, caplog, key, post, code):
    monkeypatch.setattr(config, "AI_API_KEY", key and "chave-super-secreta")
    monkeypatch.setattr(config, "AI_BASE_URL", "https://provedor.exemplo/v1?key=chave-super-secreta")
    monkeypatch.setattr(config, "AI_MODEL", "modelo-x")
    if post:
        monkeypatch.setattr(assistant.httpx, "post", post)
    with caplog.at_level("WARNING"), pytest.raises(assistant.Unavailable) as e:
        assistant.call_model([{"role": "user", "content": "oi"}])
    assert e.value.code == code
    assert f"código={code} modelo=modelo-x" in caplog.text
    assert "secreta" not in caplog.text + str(e.value) and "corpo" not in caplog.text + str(e.value)


def test_requires_session_and_csrf(client, on):
    assert client.post("/api/assistente", json={"message": "oi"}).status_code in (401, 403)
    login_new_user(client)
    assert client.post("/api/assistente", json={"message": "oi"}).status_code == 403
