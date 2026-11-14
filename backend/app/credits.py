"""Créditos: a única autoridade sobre saldo e acesso. O frontend só pergunta e mostra; quem decide é o servidor.

Regras em credit_settings (tabela, não código). Cada gasto trava a linha do usuário (FOR UPDATE), para que dois
pedidos simultâneos não gastem o mesmo crédito. Concessão manual (sem pagamento nesta etapa):

    docker compose run --rm backend python -m app.credits grant --email ana@exemplo.com --amount 5 --note "teste"
    docker compose run --rm backend python -m app.credits balance --email ana@exemplo.com
"""
import argparse

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


def settings(db) -> dict[str, int]:
    return dict(db.execute(text("SELECT key, value FROM credit_settings")).all())


def balance(db, user_id: int) -> int:
    return int(db.execute(text("SELECT coalesce(sum(delta), 0) FROM credit_ledger WHERE user_id = :u"), {"u": user_id}).scalar())


def scope_key(region_id: int | None, uf: str | None) -> str:
    return uf.upper() if uf else f"R{region_id}" if region_id else "BR"


def city_active(db, user_id: int, ibge: int) -> bool:
    return bool(db.execute(
        text("SELECT 1 FROM city_unlocks WHERE user_id = :u AND municipality_ibge = :m AND expires_at > now()"),
        {"u": user_id, "m": ibge},
    ).first())


def search_active(db, user_id: int, key: str) -> bool:
    return bool(db.execute(
        text("SELECT 1 FROM search_unlocks WHERE user_id = :u AND scope_key = :k AND expires_at > now()"),
        {"u": user_id, "k": key},
    ).first())


def no_credits(cost: int, have: int):
    raise HTTPException(402, {"code": "no_credits", "message":
                              f"Você não tem créditos suficientes: isto usa {cost} e restam {have}. "
                              "Peça mais créditos à equipe para continuar."})


def _spend(db, user_id: int, cost: int, reason: str, ibge: int | None = None, key: str | None = None) -> int:
    # Trava o usuário: o saldo lido aqui vale até o commit (sem gasto em dobro em cliques simultâneos).
    db.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})
    have = balance(db, user_id)
    if have < cost:
        no_credits(cost, have)
    if cost:
        db.execute(
            text("INSERT INTO credit_ledger (user_id, delta, reason, municipality_ibge, scope_key) VALUES (:u, :d, :r, :m, :k)"),
            {"u": user_id, "d": -cost, "r": reason, "m": ibge, "k": key},
        )
    return have - cost


def unlock_city(db: Session, user_id: int, ibge: int) -> dict:
    """Libera a cidade por N dias. Já liberada e dentro do prazo: não cobra."""
    cfg = settings(db)
    db.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})
    if city_active(db, user_id, ibge):
        return {"charged": 0, "balance": balance(db, user_id)}
    if not db.execute(text("SELECT 1 FROM city_data_status WHERE municipality_ibge = :m"), {"m": ibge}).first():
        raise HTTPException(409, {"code": "no_data", "message": "Não foi possível encontrar dados de estabelecimentos desta área."})
    left = _spend(db, user_id, cfg["city_unlock_cost"], "city_unlock", ibge=ibge)
    db.execute(
        text(
            "INSERT INTO city_unlocks (user_id, municipality_ibge, unlocked_at, expires_at) "
            "VALUES (:u, :m, now(), now() + make_interval(days => :d)) "
            "ON CONFLICT (user_id, municipality_ibge) DO UPDATE SET unlocked_at = now(), expires_at = EXCLUDED.expires_at"
        ),
        {"u": user_id, "m": ibge, "d": cfg["city_unlock_days"]},
    )
    db.commit()
    return {"charged": cfg["city_unlock_cost"], "balance": left}


def unlock_search(db: Session, user_id: int, key: str) -> dict:
    cfg = settings(db)
    db.execute(text("SELECT 1 FROM users WHERE id = :u FOR UPDATE"), {"u": user_id})
    if search_active(db, user_id, key):
        return {"charged": 0, "balance": balance(db, user_id)}
    left = _spend(db, user_id, cfg["city_search_cost"], "city_search", key=key)
    db.execute(
        text(
            "INSERT INTO search_unlocks (user_id, scope_key, unlocked_at, expires_at) "
            "VALUES (:u, :k, now(), now() + make_interval(days => :d)) "
            "ON CONFLICT (user_id, scope_key) DO UPDATE SET unlocked_at = now(), expires_at = EXCLUDED.expires_at"
        ),
        {"u": user_id, "k": key, "d": cfg["city_search_days"]},
    )
    db.commit()
    return {"charged": cfg["city_search_cost"], "balance": left}


def require_city(db, user_id: int, ibge: int) -> None:
    if not city_active(db, user_id, ibge):
        raise HTTPException(402, {"code": "locked", "message": "Esta cidade ainda não foi liberada na sua conta."})


def require_search(db, user_id: int, key: str) -> None:
    if not search_active(db, user_id, key):
        raise HTTPException(402, {"code": "locked", "message": "Esta busca ainda não foi liberada na sua conta."})


def grant(db, user_id: int, amount: int, note: str | None, reason: str = "grant") -> int:
    db.execute(text("INSERT INTO credit_ledger (user_id, delta, reason, note) VALUES (:u, :d, :r, :n)"),
               {"u": user_id, "d": amount, "r": reason, "n": note})
    return balance(db, user_id)


def main() -> None:
    from app.db import engine

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("grant", help="concede créditos (sem pagamento nesta etapa)")
    g.add_argument("--email", required=True)
    g.add_argument("--amount", type=int, required=True)
    g.add_argument("--note")
    b = sub.add_parser("balance", help="mostra saldo e histórico")
    b.add_argument("--email", required=True)
    args = ap.parse_args()
    with engine.begin() as c:
        uid = c.execute(text("SELECT id FROM users WHERE lower(email) = lower(:e)"), {"e": args.email}).scalar()
        if not uid:
            raise SystemExit(f"Nenhuma conta com o e-mail {args.email}.")
        if args.cmd == "grant":
            if args.amount == 0:
                raise SystemExit("--amount não pode ser 0.")
            print(f"Saldo de {args.email}: {grant(c, uid, args.amount, args.note)} crédito(s).")
        else:
            print(f"Saldo de {args.email}: {balance(c, uid)} crédito(s).")
            for r in c.execute(text("SELECT created_at, delta, reason, municipality_ibge, scope_key, note FROM credit_ledger "
                                    "WHERE user_id = :u ORDER BY id"), {"u": uid}):
                print(f"  {r.created_at:%Y-%m-%d %H:%M}  {r.delta:+d}  {r.reason}  {r.municipality_ibge or r.scope_key or ''}  {r.note or ''}")


if __name__ == "__main__":
    main()
