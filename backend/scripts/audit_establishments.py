"""Auditoria (só desenvolvimento; não é exposto no site): lista os estabelecimentos CONTADOS num bairro para um tipo.

    docker compose run --rm backend python scripts/audit_establishments.py --ibge 2611606 --bairro Iputinga --type hospital
    #  sem --bairro: todos os bairros da cidade;  --all-in-city: inclui os não localizados (contam só na cidade)
O banco guarda só o hash do CNPJ (princípio 9). Para conferir, o script relê os .zip do CNPJ em data/raw, recalcula
o hash e casa com o banco. Mostra CNPJ básico, CNAE, endereço e método de localização. Nunca mostra nome, sócio
nem dado de MEI: CNPJs optantes pelo MEI (Simples.zip) aparecem como "MEI (omitido)".
Saída: tabela no terminal e CSV em data/raw/audit/ (fora do Git).
"""
import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.config import DATA_DIR  # noqa: E402
from app.db import engine  # noqa: E402
from app.etl import cnpj  # noqa: E402
from app.etl.load_city import resolve_month  # noqa: E402

COL_MATRIZ_FILIAL = 3  # 1 = matriz, 2 = filial
SIMPLES_COL_MEI = 4  # "OPÇÃO PELO MEI": S/N


def mei_basicos(month: str, local_path: str | None, wanted: set[str]) -> set[str]:
    """CNPJs básicos (entre os pedidos) que hoje são MEI, pelo arquivo Simples da mesma referência."""
    if not wanted:
        return set()
    out = set()
    for line in cnpj.read_zip_lines(cnpj.fetch(month, local_path, "Simples")):
        basico = line[1:9].decode()
        if basico in wanted:
            row = next(csv.reader([line.decode("latin-1")], delimiter=";"))
            if row[SIMPLES_COL_MEI] == "S":
                out.add(basico)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ibge", type=int, required=True)
    ap.add_argument("--type", required=True, help="business_type_key, ex.: hospital")
    ap.add_argument("--bairro", help="nome do bairro/área (sem acento ou caixa)")
    ap.add_argument("--all-in-city", action="store_true")
    ap.add_argument("--month")
    ap.add_argument("--local-path")
    args = ap.parse_args()
    month = resolve_month(args)

    with engine.connect() as c:
        city = c.execute(text("SELECT name, uf, rfb_code FROM municipalities WHERE ibge = :m"), {"m": args.ibge}).mappings().one()
        cnaes = {r[0] for r in c.execute(text("SELECT cnae FROM business_type_cnae WHERE business_type_key = :t"), {"t": args.type})}
        if not cnaes:
            raise SystemExit(f"Tipo {args.type!r} sem CNAE no catálogo.")
        counted = {
            r.id: r
            for r in c.execute(
                text(
                    """
                    SELECT e.id, e.match_method, e.bairro_raw, n.name AS unit, n.id AS unit_id
                    FROM establishments e LEFT JOIN neighborhoods n ON n.id = e.neighborhood_id
                    WHERE e.municipality_ibge = :m AND e.cnae_main = ANY(:c)
                      AND (CAST(:b AS text) IS NULL OR n.name_normalized = norm_text(:b))
                      AND (:all OR e.neighborhood_id IS NOT NULL)
                    """
                ),
                {"m": args.ibge, "c": list(cnaes), "b": args.bairro, "all": args.all_in_city},
            )
        }
        stored = c.execute(
            text("SELECT n_establishments FROM neighborhood_type_counts t JOIN neighborhoods n ON n.id = t.neighborhood_id "
                 "WHERE n.municipality_ibge = :m AND t.business_type_key = :t AND (CAST(:b AS text) IS NULL OR n.name_normalized = norm_text(:b))"),
            {"m": args.ibge, "t": args.type, "b": args.bairro},
        ).scalars().all()
    if not city["rfb_code"]:
        raise SystemExit("Cidade sem código da Receita: rode a carga antes.")

    paths = [cnpj.fetch(month, args.local_path, f"Estabelecimentos{i}") for i in range(cnpj.N_FILES)]
    found = []
    for _, row in cnpj.matching_rows(paths, {city["uf"].encode()}, {x.encode() for x in cnaes}):
        if row[cnpj.COL_MUNICIPIO] != city["rfb_code"]:
            continue
        h = cnpj.cnpj_hash(row)
        if h in counted:
            found.append((row, counted[h]))
    mei = mei_basicos(month, args.local_path, {r[cnpj.COL_CNPJ_BASICO] for r, _ in found})

    out_rows = []
    for row, db in sorted(found, key=lambda x: (x[1].unit or "~", x[0][cnpj.COL_LOGRADOURO], x[0][cnpj.COL_NUMERO])):
        is_mei = row[cnpj.COL_CNPJ_BASICO] in mei
        address = " ".join(p for p in (row[cnpj.COL_TIPO_LOGRADOURO], row[cnpj.COL_LOGRADOURO]) if p).strip()
        address += f", {row[cnpj.COL_NUMERO]}" if row[cnpj.COL_NUMERO] else ""
        address += f" ({row[cnpj.COL_COMPLEMENTO]})" if row[cnpj.COL_COMPLEMENTO] else ""
        out_rows.append({
            "cnpj_basico": "MEI (omitido)" if is_mei else row[cnpj.COL_CNPJ_BASICO],
            "matriz_filial": {"1": "matriz", "2": "filial"}.get(row[COL_MATRIZ_FILIAL], row[COL_MATRIZ_FILIAL]),
            "cnae": row[cnpj.COL_CNAE_PRINCIPAL],
            "endereco": "MEI (omitido)" if is_mei else address,
            "bairro_no_cnpj": row[cnpj.COL_BAIRRO],
            "cep": "" if is_mei else row[cnpj.COL_CEP],
            "bairro_atribuido": db.unit or "(não localizado)",
            "metodo": db.match_method,
        })

    folder = DATA_DIR / "raw" / "audit"
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{args.ibge}_{args.type}_{(args.bairro or 'todos').replace(' ', '_')}_{month}.csv"
    with open(folder / name, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out_rows[0]) if out_rows else ["cnpj_basico"])
        w.writeheader()
        w.writerows(out_rows)

    print(f"\n{city['name']} ({args.ibge}), tipo {args.type} (CNAE {', '.join(sorted(cnaes))}), "
          f"{'bairro ' + args.bairro if args.bairro else 'todos os bairros'}, CNPJ ref. {month}")
    print(f"Contados no banco: {len(counted)}; reencontrados nos arquivos: {len(found)}; soma em neighborhood_type_counts: {sum(stored)}")
    print("| CNPJ básico | M/F | CNAE | Endereço | Bairro no CNPJ | CEP | Bairro atribuído | Método |")
    print("|---|---|---|---|---|---|---|---|")
    for r in out_rows:
        print("| " + " | ".join(str(v) for v in r.values()) + " |")
    print(f"\nCSV: {folder / name}")
    if len(found) != len(counted):
        print("ATENÇÃO: nem todos os contados foram reencontrados (arquivos de outra referência?).")


if __name__ == "__main__":
    main()
