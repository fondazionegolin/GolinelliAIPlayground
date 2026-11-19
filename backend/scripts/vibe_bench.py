"""Vibe Lab benchmark: build + quality loop on a fixed set of reference briefs, with a scorecard per brief.

Run inside the API container (it needs the model keys and the vibe-qa service):
    docker compose -p dev_golinelli_ai exec -T -w /app api env PYTHONPATH=/app python scripts/vibe_bench.py [brief-id ...]

Every change to a prompt, a model role or the loop should be compared on the same briefs: the numbers, not impressions,
say whether the system got better. Results are appended to /tmp/vibe_bench.jsonl (copy it out to keep the history).
"""
import asyncio
import json
import sys
import time

from app.api.v1.endpoints import coding
from app.services import model_roles, vibe_contract, vibe_pipeline, vibe_qa, vibe_styles

BRIEFS = {
    "camera": ("Scegli la fotocamera", "un sistema intelligente algoritmico che mi guida alla scelta della fotocamera mirrorless giusta, sulla base di un test di personalita', di preferenze artistiche e di scatto, anche con immagini; stila una lista di fotocamere con affinita' e obiettivi da abbinare.", 0),
    "ristoranti": ("Dove mangiamo", "una guida ai ristoranti di una citta' scelta dall'utente: cerca i locali sulla mappa, filtri per cucina e budget, scheda con foto e un assistente AI che consiglia il posto giusto per l'occasione.", 3),
    "storia": ("Storia in 10 minuti", "un tutor di storia per studenti delle medie: linea del tempo interattiva dell'impero romano, quiz con punteggio, e un chatbot che risponde alle domande dello studente con parole semplici.", 4),
    "galleria": ("Galleria AI", "una galleria d'arte immaginaria: l'utente descrive un quadro e l'app genera l'opera, la appende in una sala virtuale, e un critico AI la commenta analizzando l'immagine.", 5),
    "dashboard": ("Studio Plan", "un pianificatore di studio per studenti: calendario settimanale, materie con obiettivi, grafici dei progressi, promemoria e riepilogo settimanale esportabile.", 6),
}


def spec_for(title: str, idea: str, style_index: int) -> str:
    style = vibe_styles.style_options()[style_index % len(vibe_styles.style_options())]["answer"]
    return f"# {title}\n## Obiettivo\n{idea}\n## Stile e contenuti\n{style}\n"


async def bench_one(key: str) -> dict:
    title, idea, style_index = BRIEFS[key]
    spec = spec_for(title, idea, style_index)
    context = f"Titolo progetto: {title}\n\n=== BRIEF DEL PROGETTO ===\nFILE: spec.md\n{spec}\n=== FINE BRIEF ===\n\nRichiesta utente:\n{idea}"
    await model_roles.load_overrides()
    architect, writer = await coding._vibe_team(None, False)
    run = vibe_pipeline.Run(writer, architect)
    token = vibe_pipeline.current.set(run)
    started = time.monotonic()
    out = {"brief": key, "ok": False}
    try:
        files = None
        async for kind, value in coding._parallel_build(context, *architect, writer=writer):
            if kind == "result":
                files = value.get("generated")
        if not files:
            out["error"] = "architect plan unusable"
            return out
        out["build_s"] = round(time.monotonic() - started)
        out["css_before"] = "%d/%d" % (vibe_qa.css_coverage(files)[1], vibe_qa.css_coverage(files)[0])
        first = last = None
        async for kind, value in coding._quality_loop(files, reqs=vibe_contract.extract_requirements(spec), brief=context[:9000], brief_reminder="", writer=writer, architect=architect, run=run):
            if kind == "result":
                last = value
        out.update(ok=True, rounds=[(r["round"], r["overall"], r["defects"]["major"] + r["defects"]["blocker"]) for r in last["rounds"]],
                   final=last["scorecard"], tests=last["tests"], files=len(last["files"]), total_s=round(time.monotonic() - started))
    except Exception as exc:  # a failed brief is a data point, not a crash of the bench
        out["error"] = f"{type(exc).__name__}: {exc}"[:200]
    finally:
        vibe_pipeline.current.reset(token)
    return out


async def main(keys: list[str]) -> None:
    rows = []
    for key in keys:
        print(f"== {key} ...", flush=True)
        row = await bench_one(key)
        rows.append(row)
        with open("/tmp/vibe_bench.jsonl", "a") as handle:
            handle.write(json.dumps({**row, "at": time.strftime("%Y-%m-%d %H:%M")}, ensure_ascii=False) + "\n")
        card = row.get("final") or {}
        print(f"   ok={row['ok']} build={row.get('build_s')}s total={row.get('total_s')}s css {row.get('css_before')} -> {card.get('css_coverage')} "
              f"overall={card.get('overall')} visual={card.get('visual')} flows={card.get('flows')} defects={card.get('defects')} rounds={row.get('rounds')} {row.get('error', '')}", flush=True)
    done = [r for r in rows if r.get("final")]
    if done:
        mean = lambda name: round(sum((r["final"].get(name) or 0) for r in done) / len(done))
        print(f"\nMEDIA su {len(done)} brief: overall={mean('overall')} visual={mean('visual')} flows={mean('flows')} styling={mean('styling')}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or list(BRIEFS)))
