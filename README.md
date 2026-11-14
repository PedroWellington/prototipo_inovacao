# LOCUS

Explorador de bairros: você define os critérios (o que quer perto e o que não quer perto) e o LOCUS mostra os **bairros que mais combinam com os critérios que você definiu**, com fonte e data de cada dado.

> Em construção. O passo a passo completo fica nesta página ao final das fases.

## Rodar (Windows + PowerShell + Docker Desktop)

```powershell
Copy-Item .env.example .env      # ajuste a senha e as portas, se quiser
docker compose up -d --build
```

- App: http://localhost:8080
- API (docs): http://localhost:8000/api/docs
- Testes: `docker compose run --rm backend pytest`
