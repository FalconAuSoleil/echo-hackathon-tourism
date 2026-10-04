#!/usr/bin/env python3
"""Construit le dictionnaire de prénoms du nettoyage des données personnelles (SPEC 4.3 étape 3, SPEC 6).

Sortie : packages/core/src/given-names.ts (généré, committé). Outillage de build uniquement (CLAUDE.md) :
l'app n'en a jamais besoin à l'exécution.

Sources (licences dans docs/DATASHEET.md) :
- en : US Census Bureau, 1990 Census first-name files (domaine public, œuvre du gouvernement fédéral) ;
       Wikidata (CC0), personnes de nationalité britannique nées après 1960.
- fr : INSEE, Fichier des prénoms, édition 2023 (nat2022), Licence Ouverte / Etalab 2.0, naissances 1970-2022.
- de : Wikidata (CC0), personnes de nationalité allemande, autrichienne ou suisse nées après 1940.
- es : Wikidata (CC0), personnes de nationalité espagnole, mexicaine ou argentine nées après 1940.
- rw : Wikidata (CC0), personnes de nationalité rwandaise : prénoms ET noms de famille (au Rwanda, le « nom
       de famille » est un nom personnel, souvent en kinyarwanda : Uwimana, Mukamana...).

Ambiguïté (prénom qui est aussi un mot courant : Will, Grace, Rose, Pierre, Dolores, Ernst...) : mesurée sur les
phrases Tatoeba (CC-BY 2.0 FR) de chaque langue. Un prénom est ambigu dans une langue s'il y apparaît souvent
en minuscules (mot courant) ou, en allemand, souvent derrière un article (nom commun : « die Rose »).
Le nettoyage retire un prénom NON ambigu dans toute position (début de phrase, allemand, texte en minuscules) ;
un prénom ambigu n'est retiré que par les règles de contexte existantes.

Usage : .venv/bin/python packages/core/scripts/build_given_names.py   (téléchargements en cache dans datasets/names/)
"""
from __future__ import annotations

import bz2
import csv
import io
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CACHE = ROOT / "datasets" / "names"
OUT = ROOT / "packages" / "core" / "src" / "given-names.ts"
UA = "EchoHackathonBuild/0.1 (offline build tooling; https://github.com/)"

CENSUS = {
    "female": "https://www2.census.gov/topics/genealogy/1990surnames/dist.female.first",
    "male": "https://www2.census.gov/topics/genealogy/1990surnames/dist.male.first",
}
INSEE = "https://www.insee.fr/fr/statistiques/fichier/7633685/nat2022_csv.zip"
TATOEBA = "https://downloads.tatoeba.org/exports/per_language/{l}/{l}_sentences.tsv.bz2"
TATOEBA_LANG = {"en": "eng", "fr": "fra", "de": "deu", "es": "spa"}
WIKIDATA = "https://query.wikidata.org/sparql"

# Combien de prénoms garder par source (les plus fréquents).
TOP = {"census_female": 1000, "census_male": 700, "insee": 1500, "wd_uk": 600, "wd_de": 1000, "wd_es": 900}
COUNTRIES = {"wd_uk": ["Q145"], "wd_de": ["Q183", "Q40", "Q39"], "wd_es": ["Q29", "Q96", "Q414"]}
BORN_AFTER = {"wd_uk": "1960", "wd_de": "1940", "wd_es": "1940"}
RWANDA = "Q1037"

# Articles et contractions allemands : « die Rose », « im Garten » → nom commun.
DE_ARTICLES = {"der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
               "im", "am", "zum", "zur", "vom", "beim", "ins", "ans", "kein", "keine", "meine", "unsere", "diese"}


# Mots des noms affichés qui ne sont pas des noms de personnes (titres, articles, particules).
LABEL_STOP = {"the", "van", "von", "der", "den", "des", "les", "del", "los", "las", "and", "saint", "sainte", "king", "queen",
              "junior", "senior", "general", "sir", "lady", "lord", "mister", "bishop", "father", "pope", "president",
              "minister", "prince", "princess", "doctor", "pastor", "reverend", "mwami", "umwami", "dit", "alias"}


def fold(s: str) -> str:
    """Même repli que packages/core/src/text.ts (minuscules, sans diacritiques, ß → ss)."""
    s = re.sub(r"[‘’ʼ`´]", "'", s).lower().replace("ß", "ss")
    return "".join(ch for ch in unicodedata.normalize("NFKD", s) if not unicodedata.combining(ch))


def fetch(url: str, name: str, data: bytes | None = None, accept: str | None = None) -> bytes:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / name
    if path.exists():
        return path.read_bytes()
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as r:
                body = r.read()
            path.write_bytes(body)
            return body
        except Exception as e:  # noqa: BLE001
            print(f"  {name}: {e} (retry {attempt + 1})", file=sys.stderr)
            time.sleep(5 * (attempt + 1))
    raise SystemExit(f"download failed: {url}")


def sparql(query: str, name: str) -> list[dict[str, str]]:
    body = fetch(WIKIDATA, name, data=urllib.parse.urlencode({"query": query}).encode(), accept="text/csv")
    return list(csv.DictReader(io.StringIO(body.decode("utf-8"))))


def valid(name: str) -> bool:
    # Un mot (ou deux reliés par un tiret), lettres seulement, au moins 3 lettres.
    return bool(re.fullmatch(r"[^\W\d_]{3,}(?:-[^\W\d_]{2,})?", name)) and len(name) <= 24


def title(name: str) -> str:
    return "-".join(p[:1].upper() + p[1:].lower() for p in name.split("-"))


def census() -> list[tuple[str, str]]:
    out = []
    for sex, url in CENSUS.items():
        rows = fetch(url, f"census-{sex}.txt").decode("ascii").splitlines()
        for line in rows[: TOP[f"census_{sex}"]]:
            out.append((title(line.split()[0]), f"census_{sex}"))
    return out


def insee() -> list[tuple[str, str]]:
    z = zipfile.ZipFile(io.BytesIO(fetch(INSEE, "insee-nat2022.zip")))
    text = z.read([n for n in z.namelist() if n.endswith(".csv")][0]).decode("utf-8")
    counts: Counter[str] = Counter()
    for row in csv.DictReader(io.StringIO(text), delimiter=";"):
        name, year = row["preusuel"], row["annais"]
        if name.startswith("_") or not year.isdigit() or int(year) < 1970:
            continue
        counts[title(name)] += int(row["nombre"])
    return [(n, "insee") for n, _ in counts.most_common(TOP["insee"])]


def wikidata_top(key: str) -> list[tuple[str, str]]:
    names: list[tuple[str, str]] = []
    for q in COUNTRIES[key]:
        per = TOP[key] // len(COUNTRIES[key])
        ids = sparql(
            f"""SELECT ?g (COUNT(?p) AS ?c) WHERE {{ ?p wdt:P27 wd:{q}; wdt:P735 ?g; wdt:P569 ?b.
            FILTER(?b > "{BORN_AFTER[key]}-01-01"^^xsd:dateTime) }} GROUP BY ?g ORDER BY DESC(?c) LIMIT {per}""",
            f"wd-{key}-{q}-ids.csv",
        )
        qids = [r["g"].rsplit("/", 1)[-1] for r in ids]
        names += [(n, key) for n in wikidata_labels(qids, f"wd-{key}-{q}")]
    return names


def wikidata_labels(qids: list[str], name: str) -> list[str]:
    out: list[str] = []
    for i in range(0, len(qids), 300):
        chunk = qids[i : i + 300]
        rows = sparql(
            "SELECT ?g ?l WHERE { VALUES ?g { " + " ".join(f"wd:{q}" for q in chunk) + ' } ?g rdfs:label ?l. FILTER(LANG(?l) = "mul" || LANG(?l) = "en") }',
            f"{name}-labels-{i}.csv",
        )
        seen = set()
        for r in rows:
            if r["g"] in seen:
                continue
            seen.add(r["g"])
            out.append(r["l"].strip())
    return out


def rwanda() -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for prop, label in (("P735", "given"), ("P734", "family")):
        rows = sparql(
            f"SELECT DISTINCT ?l WHERE {{ ?p wdt:P27 wd:{RWANDA}; wdt:{prop} ?g. ?g rdfs:label ?l. FILTER(LANG(?l) = \"en\" || LANG(?l) = \"mul\") }}",
            f"wd-rw-{label}.csv",
        )
        out += [(r["l"].strip(), f"wd_rw_{label}") for r in rows]
    # Peu de personnes rwandaises ont un élément « nom de famille » dans Wikidata : on prend aussi chaque mot
    # du nom affiché des personnes de nationalité rwandaise ou burundaise (même système de noms, kirundi proche
    # du kinyarwanda). Chaque mot de ces noms est un prénom ou un nom personnel.
    for q, label in ((RWANDA, "rw"), ("Q967", "bi")):
        rows = sparql(
            f"SELECT DISTINCT ?l WHERE {{ ?p wdt:P27 wd:{q}; wdt:P31 wd:Q5; rdfs:label ?l. FILTER(LANG(?l) = \"en\" || LANG(?l) = \"mul\") }}",
            f"wd-{label}-person-labels.csv",
        )
        out += [(w, f"wd_{label}_person_label") for r in rows for w in r["l"].split() if w[:1].isupper() and fold(w) not in LABEL_STOP]
    return out


def tatoeba_stats(lang: str, keys: set[str]) -> dict[str, list[int]]:
    """Par prénom replié : [minuscule, majuscule hors début de phrase, majuscule derrière un article (de)]."""
    code = TATOEBA_LANG[lang]
    raw = bz2.decompress(fetch(TATOEBA.format(l=code), f"tatoeba-{code}.tsv.bz2")).decode("utf-8")
    stats: dict[str, list[int]] = {}
    word = re.compile(r"[^\W\d_]+(?:-[^\W\d_]+)*")
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) < 3:
            continue
        toks = word.findall(parts[2])
        for i, t in enumerate(toks):
            f = fold(t)
            if f not in keys:
                continue
            s = stats.setdefault(f, [0, 0, 0])
            if t[0].islower():
                s[0] += 1
            elif i > 0:
                s[1] += 1
                if lang == "de" and fold(toks[i - 1]) in DE_ARTICLES:
                    s[2] += 1
    return stats


def ambiguous(lang: str, s: list[int] | None) -> bool:
    if not s:
        return False
    low, cap, art = s
    if low >= 3 and low > 0.25 * cap:  # mot courant (« will », « grace », « pierre » en français)
        return True
    if lang == "de" and art >= 3 and art > 0.2 * cap:  # nom commun allemand (« die Rose »)
        return True
    return False


def capitalized_only(s: list[int] | None) -> bool:
    """Prénom non ambigu mais parfois écrit en minuscules (≥ 10 %) : retiré seulement avec sa majuscule."""
    if not s:
        return False
    low, cap, _ = s
    return low >= 2 and low >= 0.1 * (low + cap)


def main() -> None:
    entries = census() + insee() + wikidata_top("wd_uk") + wikidata_top("wd_de") + wikidata_top("wd_es") + rwanda()
    by_key: dict[str, set[str]] = {}
    for name, src in entries:
        name = unicodedata.normalize("NFC", name)
        if not valid(name):
            continue
        by_key.setdefault(fold(name), set()).add(src)
    keys = set(by_key)
    amb: dict[str, list[str]] = {}
    cap_only: dict[str, list[str]] = {}
    report = {}
    for lang in TATOEBA_LANG:
        st = tatoeba_stats(lang, keys)
        amb[lang] = sorted(k for k in keys if ambiguous(lang, st.get(k)))
        cap_only[lang] = sorted(k for k in keys if not ambiguous(lang, st.get(k)) and capitalized_only(st.get(k)))
        report[lang] = {"ambiguous": len(amb[lang]), "capitalized_only": len(cap_only[lang])}
    # Mots tirés des noms affichés (rw/bi) : écartés s'ils sont ambigus ou parfois en minuscules dans UNE langue.
    label_only = {k for k, v in by_key.items() if all(x.endswith("_person_label") for x in v)}
    dropped = {k for k in label_only if any(k in amb[l] or k in cap_only[l] for l in TATOEBA_LANG)}
    keys -= dropped
    for l in TATOEBA_LANG:
        amb[l] = [k for k in amb[l] if k in keys]
        cap_only[l] = [k for k in cap_only[l] if k in keys]
    report["label_words_dropped"] = sorted(dropped)
    names = sorted(keys)
    src_counts = Counter(s for k, v in by_key.items() if k in keys for s in v)
    print(json.dumps({"names": len(names), "ambiguous": report, "sources": src_counts}, indent=1))
    lines = [
        "// GÉNÉRÉ par packages/core/scripts/build_given_names.py : ne pas modifier à la main.",
        "// Prénoms courants en/fr/de/es et noms rwandais, repliés (minuscules, sans accents). Sources et licences :",
        "// US Census 1990 (domaine public), INSEE Fichier des prénoms (Licence Ouverte 2.0), Wikidata (CC0) ;",
        "// ambiguïté mesurée sur Tatoeba (CC-BY 2.0 FR). Voir docs/DATASHEET.md.",
        "",
        f"/** {len(names)} prénoms repliés, séparés par « | ». */",
        f'export const GIVEN_NAMES_PACKED = "{"|".join(names)}";',
        "",
        "/** Prénoms qui sont aussi des mots courants dans la langue (minuscules fréquentes, ou nom commun en allemand). */",
        "export const AMBIGUOUS_NAMES_PACKED: Record<string, string> = {",
        *[f'  {lang}: "{"|".join(v)}",' for lang, v in amb.items()],
        "};",
        "",
        "/** Prénoms non ambigus mais parfois écrits en minuscules dans la langue : retirés seulement avec leur majuscule. */",
        "export const CAPITALIZED_ONLY_NAMES_PACKED: Record<string, string> = {",
        *[f'  {lang}: "{"|".join(v)}",' for lang, v in cap_only.items()],
        "};",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
