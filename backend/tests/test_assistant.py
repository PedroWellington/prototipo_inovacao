"""Assistente de IA: regras de conteúdo, limites, falhas e privacidade. O provedor é simulado (sem rede)."""

import itertools
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


@pytest.fixture(autouse=True)
def no_reserve_by_default(monkeypatch):
    monkeypatch.setattr(config, "AI_FALLBACK_API_KEY", "")  # o .env local não muda os testes


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
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: calls.append(msgs) or "O melhor bairro é a Torre, lucro garantido.")
    csrf = login_new_user(client)
    r = ask(client, csrf, "Qual o melhor bairro?")
    assert r.status_code == 200
    reply = r.json()["reply"]
    assert assistant.violations(reply) == [] and reply == assistant.SAFE_ANSWER
    assert len(calls) == 2  # pediu de novo uma vez antes de cair na resposta segura


def test_second_attempt_is_used_when_clean(client, on, monkeypatch):
    answers = iter(["Recomendo a Torre.", "Os bairros que mais combinam com seus critérios estão em Explorar."])
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: next(answers))
    csrf = login_new_user(client)
    assert ask(client, csrf).json()["reply"].startswith("Os bairros que mais combinam")


def test_context_is_real_and_private(client, on, monkeypatch):
    seen = {}
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: seen.setdefault("msgs", msgs) and "ok")
    csrf = login_new_user(client, email="privado@example.com")
    ask(client, csrf, city=2611606, neighborhood=1)
    blob = json.dumps(seen["msgs"], ensure_ascii=False)
    assert "privado@example.com" not in blob and "senha" not in blob.lower() and "password" not in blob
    ctx = json.loads(seen["msgs"][1]["content"].split("\n", 1)[1])
    # Cidade não liberada para a conta: nenhum número dela entra no contexto.
    assert ctx["cidade_atual"].startswith("A cidade desta tela não está aberta")
    assert {"criterios", "creditos", "cidades_abertas", "fontes"} <= ctx.keys()


def test_daily_limit_message_in_portuguese(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: "ok")
    csrf = login_new_user(client)
    for _ in range(3):
        assert ask(client, csrf).status_code == 200
    r = ask(client, csrf)
    assert r.status_code == 429 and "limite de 3 perguntas por dia" in r.json()["error"]["message"]


def test_question_size_limit(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: "ok")
    csrf = login_new_user(client)
    r = ask(client, csrf, "x" * (config.AI_MAX_CHARS + 1))
    assert r.status_code == 422 and "caracteres" in r.json()["error"]["message"]


def test_ip_limit(client, on, monkeypatch):
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: "ok")
    monkeypatch.setattr(api, "IP_LIMIT", 2)
    monkeypatch.setattr(config, "AI_DAILY_LIMIT", 50)
    csrf = login_new_user(client)
    assert [ask(client, csrf).status_code for _ in range(3)] == [200, 200, 429]


def test_provider_down_is_handled_and_not_counted(client, on, monkeypatch):
    def down(msgs, *a):
        raise assistant.Unavailable("provedor-404")

    monkeypatch.setattr(assistant, "call_model", down)
    csrf = login_new_user(client)
    r = ask(client, csrf)
    assert r.status_code == 503 and r.json()["error"]["message"] == "Assistente indisponível no momento (código: provedor-404)."
    monkeypatch.setattr(assistant, "call_model", lambda msgs, *a: "ok")
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
    ("k", _raise_timeout, "rede-timeout"),
])
def test_error_code_on_screen_and_log_without_secrets(monkeypatch, caplog, key, post, code):
    monkeypatch.setattr(config, "AI_API_KEY", key and "chave-super-secreta")
    monkeypatch.setattr(config, "AI_BASE_URL", "https://provedor.exemplo/v1?key=chave-super-secreta")
    monkeypatch.setattr(config, "AI_MODEL", "modelo-x")
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)
    if post:
        monkeypatch.setattr(assistant.httpx, "post", post)
    with caplog.at_level("WARNING"), pytest.raises(assistant.Unavailable) as e:
        assistant.call_model([{"role": "user", "content": "oi"}])
    assert e.value.code == code
    assert f"código={code} modelo=modelo-x" in caplog.text
    assert "secreta" not in caplog.text + str(e.value) and "corpo" not in caplog.text + str(e.value)


class FakeProvider:
    """Provedor simulado: devolve os status em ordem e anota (provedor, modelo) de cada tentativa."""

    def __init__(self, *statuses):
        self.statuses, self.calls = list(statuses), []

    def __call__(self, url, json=None, headers=None, **kw):
        self.calls.append(("reserva" if "reserva.exemplo" in url else "principal", json["model"]))
        assert headers["Authorization"] == ("Bearer chave-reserva" if "reserva.exemplo" in url else "Bearer chave-principal")
        st = self.statuses.pop(0)
        if st == "timeout":
            raise httpx.ReadTimeout("tempo esgotado")
        if st == "conexao":
            raise httpx.ConnectError("falha em https://principal.exemplo/v1?key=chave-principal")
        return httpx.Response(st, json={"choices": [{"message": {"content": "ok"}}]} if st == 200 else {})


P1, P2, R = ("principal", "modelo-1"), ("principal", "modelo-2"), ("reserva", "modelo-reserva")


@pytest.fixture
def providers(monkeypatch):
    for k, v in {"AI_API_KEY": "chave-principal", "AI_BASE_URL": "https://principal.exemplo/v1", "AI_MODEL": "modelo-1",
                 "AI_FALLBACK_MODEL": "modelo-2", "AI_FALLBACK_API_KEY": "chave-reserva",
                 "AI_FALLBACK_BASE_URL": "https://reserva.exemplo/v1", "AI_FALLBACK_PROVIDER_MODEL": "modelo-reserva"}.items():
        monkeypatch.setattr(config, k, v)
    monkeypatch.setattr(assistant.time, "sleep", lambda s: None)


def run(monkeypatch, *statuses):
    fake = FakeProvider(*statuses)
    monkeypatch.setattr(assistant.httpx, "post", fake)
    return fake


@pytest.mark.parametrize("statuses, calls", [
    ((503, 200), [P1, P1]),  # principal em 503: uma nova tentativa no mesmo modelo
    (("timeout", 502, 200), [P1, P1, P2]),  # depois o segundo modelo do principal
    ((503, 500, 504, 200), [P1, P1, P2, R]),  # e por fim o provedor reserva
    ((429, 200), [P1, R]),  # limite do principal: direto ao reserva, sem repetir
    ((401, 200), [P1, R]),  # configuração errada no principal: não repete nele, tenta o reserva
    (("conexao", 200), [P1, R]),
])
def test_attempt_order(monkeypatch, caplog, providers, statuses, calls):
    fake = run(monkeypatch, *statuses)
    with caplog.at_level("INFO"):
        assert assistant.call_model([{"role": "user", "content": "oi"}]) == "ok"
    assert fake.calls == calls
    assert f"provedor={calls[-1][0]} modelo={calls[-1][1]} tentativas={len(calls)}" in caplog.text


@pytest.mark.parametrize("status", [400, 401, 403, 404, 429])
def test_no_retry_and_reserve_off(monkeypatch, providers, status):
    monkeypatch.setattr(config, "AI_FALLBACK_API_KEY", "")  # reserva desligada
    fake = run(monkeypatch, status, 200)
    with pytest.raises(assistant.Unavailable) as e:
        assistant.call_model([{"role": "user", "content": "oi"}])
    assert fake.calls == [P1] and e.value.code == ("limite" if status == 429 else f"provedor-{status}")


def test_everything_fails_shows_the_last_error(monkeypatch, providers):
    fake = run(monkeypatch, 503, 503, 503, 404)
    with pytest.raises(assistant.Unavailable) as e:
        assistant.call_model([{"role": "user", "content": "oi"}])
    assert fake.calls == [P1, P1, P2, R] and e.value.code == "provedor-404"


def test_network_codes_and_exception_class_in_log(monkeypatch, caplog, providers):
    monkeypatch.setattr(config, "AI_FALLBACK_API_KEY", "")
    run(monkeypatch, "conexao")
    with caplog.at_level("WARNING"), pytest.raises(assistant.Unavailable) as e:
        assistant.call_model([{"role": "user", "content": "oi"}])
    assert e.value.code == "rede-conexao" and "classe=ConnectError" in caplog.text
    assert "chave-principal" not in caplog.text and "principal.exemplo" not in caplog.text


def test_retries_respect_the_total_deadline(monkeypatch, providers):
    monkeypatch.setattr(config, "AI_FALLBACK_API_KEY", "")
    fake = run(monkeypatch, 503, 503, 503)
    clock = itertools.chain([0], itertools.repeat(60))  # depois da 1ª falha o prazo já passou
    monkeypatch.setattr(assistant.time, "monotonic", lambda: next(clock))
    with pytest.raises(assistant.Unavailable):
        assistant.call_model([{"role": "user", "content": "oi"}], deadline=10)
    assert fake.calls == [P1]


def test_one_question_counts_once_in_the_daily_limit(client, on, monkeypatch, providers):
    fake = run(monkeypatch, 503, 503, 503, 200)  # 4 tentativas, 1 pergunta
    csrf = login_new_user(client)
    r = ask(client, csrf)
    assert r.status_code == 200 and len(fake.calls) == 4
    assert r.json()["remaining"] == config.AI_DAILY_LIMIT - 1


def test_503_message_on_screen(client, on, monkeypatch):
    def busy(msgs, *a):
        raise assistant.Unavailable("provedor-503")

    monkeypatch.setattr(assistant, "call_model", busy)
    csrf = login_new_user(client)
    assert ask(client, csrf).json()["error"]["message"] == (
        "Assistente indisponível no momento (código: provedor-503). "
        "O serviço de IA está com muita demanda. Tente de novo em instantes."
    )


def test_requires_session_and_csrf(client, on):
    assert client.post("/api/assistente", json={"message": "oi"}).status_code in (401, 403)
    login_new_user(client)
    assert client.post("/api/assistente", json={"message": "oi"}).status_code == 403


INCOME_SPIN = ["Bairro com poder de compra alto.", "Pessoas dispostas a pagar mais.", "Consumidores com essa renda preferem…",
               "Perfil de consumo premium.", "Perfil compatível com oferta premium.", "Bom poder aquisitivo."]


@pytest.mark.parametrize("text", INCOME_SPIN)
def test_income_interpretation_is_blocked_in_answers(text):
    assert assistant.violations(text)


def test_income_texts_show_only_the_value():
    """Textos gerados de renda (tela, PDF, slides e contexto do assistente): só valor, fonte e data."""
    from app.scoring.rank import income_block

    src = {"name": "IBGE, Censo Demográfico 2022", "url": "", "reference_date": "2022"}
    for approx in (False, True):
        inc = income_block(1500.4, 4, approx, src, "do bairro", {"median": 1250, "source": src})
        assert inc["text"] == "Renda mediana do bairro: R$ 1.500/mês"
        line = assistant.income_line(inc)
        assert assistant.violations(inc["text"] + " " + line + " " + inc["note"]) == []
        assert ("aproximado" in line) is approx and "IBGE, Censo Demográfico 2022" in line
        assert inc["approximate"] is approx  # o aviso "aproximado" continua quando vem de setores
    assert income_block(1250, 2, False, src, "da cidade")["text"] == "Renda mediana da cidade: R$ 1.250/mês"
    assert "comparison" not in income_block(1250, 2, False, src, "da cidade")
    assert "sem interpretar" in assistant.SYSTEM_PROMPT


SRC = {"name": "IBGE, Censo Demográfico 2022", "url": "", "reference_date": "2022"}
CITY_SRC = {"name": "IBGE, Censo 2022, municípios", "url": "", "reference_date": "2022-08"}


@pytest.mark.parametrize("hood, city, expected", [
    (5000, 1250, "300% maior que a da cidade"),  # bairro maior
    (1000, 1250, "20% menor que a da cidade"),  # bairro menor
    (1255, 1250, "igual à da cidade"),  # diferença menor que 1% (0,4%)
    (1238, 1250, "igual à da cidade"),  # -0,96%
    (1263, 1250, "1% maior que a da cidade"),  # 1,04%: já não é igual
    (None, 1250, "sem dado suficiente para comparar"),  # falta o bairro
    (1000, None, "sem dado suficiente para comparar"),  # falta a cidade
])
def test_income_comparison_with_city(hood, city, expected):
    """(bairro ÷ cidade − 1) × 100, arredondado; com o rótulo "calculado a partir de" e a fonte e a data dos dois valores."""
    from app.scoring.rank import NO_DATA, income_block

    inc = income_block(hood, 1, False, SRC, "do bairro", {"median": city, "source": CITY_SRC})
    cmp = inc["comparison"]
    assert cmp["text"] == expected
    assert cmp["available"] is (hood is not None and city is not None)
    line = assistant.income_line(inc)
    assert expected in line
    if cmp["available"]:
        assert cmp["basis"] == "calculado a partir de" and "calculado a partir de: bairro, IBGE, Censo Demográfico 2022, ref. 2022; "             "cidade, IBGE, Censo 2022, municípios, ref. 2022-08" in line
        assert cmp["city_text"] == "Renda mediana da cidade: R$ 1.250/mês"
        same = assistant.income_line(income_block(hood, 1, False, SRC, "do bairro", {"median": city, "source": SRC}))
        assert "calculado a partir de: bairro e cidade, IBGE, Censo Demográfico 2022, ref. 2022" in same  # mesma fonte: uma vez
    if hood is None:
        assert inc["message"] == NO_DATA.format(item="renda")  # nunca estima o valor que falta
    # "maior", "menor" e "igual" desta comparação não disparam a guarda contra interpretação da renda
    assert assistant.violations(line) == []


def test_backend_code_has_no_income_interpretation():
    """Nenhum texto do backend (telas via API, PDF, slides, prompt) volta a interpretar a renda.
    Linhas que só enunciam a regra ("nada de", "nunca") e a própria lista de expressões ficam de fora."""
    import pathlib

    root = pathlib.Path(assistant.__file__).parent
    hits = [f"{p.relative_to(root)}:{i}" for p in root.rglob("*.py") for i, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1)
            if assistant.violations(line) and not line.strip().startswith('r"')
            and not any(k in line.lower() for k in ("nada de", "nunca"))]
    assert hits == []
