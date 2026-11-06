#!/usr/bin/env python3
"""
Haalt alle achtbanen op uit Wikidata en schrijft ze naar data/achtbanen.json.

GitHub Actions draait dit script automatisch (zie .github/workflows/site.yml).
Je kunt het ook zelf draaien met:  python3 scripts/haal_achtbanen.py
Er zijn geen extra Python-pakketten nodig.

Wikidata-gegevens zijn vrij te gebruiken (CC0). De foto's komen van
Wikimedia Commons; de site toont per foto de maker en de licentie.
"""

import datetime
import json
import os
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UITVOER = pathlib.Path(__file__).resolve().parent.parent / "data" / "achtbanen.json"

REPO = os.environ.get("GITHUB_REPOSITORY", "onbekend")
USER_AGENT = f"AchtbanenSite/1.0 (persoonlijke achtbanensite; https://github.com/{REPO})"

# Wikidata stapt in 2026-2027 over op een nieuwe database (QLever).
# Het script probeert de adressen op volgorde en onthoudt welke werkt.
ADRESSEN = [
    ("Wikidata v2", "https://query-next.wikidata.org/sparql", {}),
    ("Wikidata v1", "https://query.wikidata.org/sparql", {}),
    ("QLever", "https://qlever.dev/api/wikidata", {"format": "json"}),
]
_werkend = []

ACHTBAAN = "wd:Q204832"  # roller coaster
PRETPARK = "wd:Q194195"  # amusement park
TALEN = ["nl", "mul", "en", "de", "fr", "es", "it", "pt", "sv", "pl", "ja", "zh"]

PREFIXEN = """
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX psn: <http://www.wikidata.org/prop/statement/value-normalized/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
"""

# Vraag 1: waar staat de achtbaan, hoe heet het type, foto, coördinaten.
VRAAG_BASIS = PREFIXEN + f"""
SELECT ?item
  (GROUP_CONCAT(STR(?type); separator="|") AS ?types)
  (GROUP_CONCAT(STR(?deel); separator="|") AS ?delen)
  (GROUP_CONCAT(STR(?plek); separator="|") AS ?plekken)
  (SAMPLE(?land) AS ?land1)
  (SAMPLE(?coord) AS ?coord1)
  (SAMPLE(?foto) AS ?foto1)
  (SAMPLE(?rcdb) AS ?rcdb1)
WHERE {{
  ?item wdt:P31/wdt:P279* {ACHTBAAN} .
  OPTIONAL {{ ?item wdt:P31 ?type . }}
  OPTIONAL {{ ?item wdt:P361 ?deel . }}
  OPTIONAL {{ ?item wdt:P276 ?plek . }}
  OPTIONAL {{ ?item wdt:P17 ?land . }}
  OPTIONAL {{ ?item wdt:P625 ?coord . }}
  OPTIONAL {{ ?item wdt:P18 ?foto . }}
  OPTIONAL {{ ?item wdt:P2751 ?rcdb . }}
}}
GROUP BY ?item
"""

# Vraag 2: de cijfers. psn: geeft waarden omgerekend naar meter, m/s en seconden.
VRAAG_CIJFERS = PREFIXEN + f"""
SELECT ?item
  (MAX(?h) AS ?hoogte) (MAX(?v) AS ?snelheid) (MAX(?l) AS ?lengte) (MAX(?d) AS ?duur)
  (GROUP_CONCAT(STR(?open); separator="|") AS ?geopend)
  (GROUP_CONCAT(STR(?start); separator="|") AS ?begin)
  (GROUP_CONCAT(STR(?dicht); separator="|") AS ?gesloten)
  (GROUP_CONCAT(STR(?fab); separator="|") AS ?fabrikanten)
WHERE {{
  ?item wdt:P31/wdt:P279* {ACHTBAAN} .
  OPTIONAL {{ ?item p:P2048/psn:P2048/wikibase:quantityAmount ?h . }}
  OPTIONAL {{ ?item p:P2052/psn:P2052/wikibase:quantityAmount ?v . }}
  OPTIONAL {{ ?item p:P2043/psn:P2043/wikibase:quantityAmount ?l . }}
  OPTIONAL {{ ?item p:P2047/psn:P2047/wikibase:quantityAmount ?d . }}
  OPTIONAL {{ ?item wdt:P1619 ?open . }}
  OPTIONAL {{ ?item wdt:P571 ?start . }}
  OPTIONAL {{ ?item wdt:P576|wdt:P3999 ?dicht . }}
  OPTIONAL {{ ?item wdt:P176 ?fab . }}
}}
GROUP BY ?item
"""


def vraag(sparql):
    """Stuurt een SPARQL-vraag naar het eerste adres dat antwoord geeft."""
    volgorde = _werkend + [a for a in ADRESSEN if a not in _werkend]
    fouten = []
    for adres in volgorde:
        naam, url, extra = adres
        for poging in range(3):
            try:
                body = urllib.parse.urlencode({"query": sparql, **extra}).encode()
                verzoek = urllib.request.Request(url, data=body, headers={
                    "Accept": "application/sparql-results+json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": USER_AGENT,
                })
                with urllib.request.urlopen(verzoek, timeout=180) as antwoord:
                    data = json.load(antwoord)
                rijen = data["results"]["bindings"]
                if adres not in _werkend:
                    _werkend.insert(0, adres)
                    print(f"  ✓ {naam} geeft antwoord")
                return rijen
            except urllib.error.HTTPError as fout:
                if fout.code in (429, 500, 502, 503, 504) and poging < 2:
                    wacht = int(fout.headers.get("Retry-After") or 0) or 15 * (poging + 1)
                    print(f"  {naam}: HTTP {fout.code}, opnieuw over {wacht} s")
                    time.sleep(wacht)
                    continue
                fouten.append(f"{naam}: HTTP {fout.code}")
                break
            except (urllib.error.URLError, TimeoutError, ValueError, KeyError) as fout:
                if poging < 2:
                    time.sleep(10)
                    continue
                fouten.append(f"{naam}: {fout}")
                break
        if adres in _werkend:
            _werkend.remove(adres)
    raise RuntimeError("Geen enkel Wikidata-adres gaf antwoord:\n  " + "\n  ".join(fouten))


def waarde(rij, sleutel):
    v = rij.get(sleutel)
    return v["value"] if v else None


def qid(uri):
    if uri and "/entity/Q" in uri:
        return uri.rsplit("/", 1)[-1]
    return None


def lijst_qids(tekst):
    gezien, uit = set(), []
    for deel in (tekst or "").split("|"):
        q = qid(deel)
        if q and q not in gezien:
            gezien.add(q)
            uit.append(q)
    return uit


def jaren(tekst):
    uit = []
    for deel in (tekst or "").split("|"):
        m = re.match(r"\s*\+?(-?\d{4})", deel)
        if m:
            uit.append(int(m.group(1)))
    return uit


def getal(tekst, factor=1.0, minimaal=0.0, maximaal=1e9, decimalen=0):
    try:
        n = float(tekst) * factor
    except (TypeError, ValueError):
        return None
    if not (minimaal < n < maximaal):
        return None
    n = round(n, decimalen)
    return int(n) if decimalen == 0 else n


def coordinaten(wkt):
    m = re.search(r"Point\(\s*([-\d.eE]+)\s+([-\d.eE]+)\s*\)", wkt or "")
    if not m:
        return None, None
    return round(float(m.group(2)), 5), round(float(m.group(1)), 5)


def bestandsnaam(url):
    if not url or "Special:FilePath/" not in url:
        return None
    return urllib.parse.unquote(url.split("Special:FilePath/", 1)[1])


def in_stukjes(items, grootte):
    for i in range(0, len(items), grootte):
        yield items[i:i + grootte]


def haal_namen(qids):
    """Zoekt per Wikidata-code de beste naam: Nederlands, anders een andere taal."""
    namen = {}
    talen_filter = ", ".join(f'"{t}"' for t in TALEN)
    stukjes = list(in_stukjes(sorted(qids), 400))
    for i, stuk in enumerate(stukjes, 1):
        print(f"  namen {i}/{len(stukjes)}")
        waarden = " ".join(f"wd:{q}" for q in stuk)
        sparql = PREFIXEN + f"""
SELECT ?e ?l WHERE {{
  VALUES ?e {{ {waarden} }}
  ?e rdfs:label ?l .
  FILTER(LANG(?l) IN ({talen_filter}))
}}"""
        for rij in vraag(sparql):
            q = qid(waarde(rij, "e"))
            taal = rij["l"].get("xml:lang", "")
            if q and taal in TALEN:
                namen.setdefault(q, {})[taal] = rij["l"]["value"]
        time.sleep(1)
    beste = {}
    for q, perTaal in namen.items():
        for taal in TALEN:
            if taal in perTaal:
                beste[q] = perTaal[taal]
                break
    return beste


def welke_zijn_parken(qids):
    parken = set()
    for stuk in in_stukjes(sorted(qids), 400):
        waarden = " ".join(f"wd:{q}" for q in stuk)
        sparql = PREFIXEN + f"""
SELECT DISTINCT ?e WHERE {{
  VALUES ?e {{ {waarden} }}
  ?e wdt:P31/wdt:P279* {PRETPARK} .
}}"""
        for rij in vraag(sparql):
            q = qid(waarde(rij, "e"))
            if q:
                parken.add(q)
        time.sleep(1)
    return parken


def eerste_hoofdletter(tekst):
    return tekst[:1].upper() + tekst[1:] if tekst else tekst


def bouw():
    print("1/4 Achtbanen en locaties ophalen…")
    basis = {qid(waarde(r, "item")): r for r in vraag(VRAAG_BASIS)}
    basis.pop(None, None)
    print(f"  {len(basis)} achtbanen gevonden")
    time.sleep(2)

    print("2/4 Hoogte, snelheid, lengte en jaartallen ophalen…")
    cijfers = {qid(waarde(r, "item")): r for r in vraag(VRAAG_CIJFERS)}
    time.sleep(2)

    print("3/4 Uitzoeken welke locaties pretparken zijn…")
    kandidaten = set()
    for r in basis.values():
        kandidaten.update(lijst_qids(waarde(r, "delen")))
        kandidaten.update(lijst_qids(waarde(r, "plekken")))
    parken = welke_zijn_parken(kandidaten)
    print(f"  {len(parken)} parken herkend")

    nodig = set(basis)
    for q, r in basis.items():
        nodig.update(lijst_qids(waarde(r, "types")))
        nodig.update(lijst_qids(waarde(r, "delen")))
        nodig.update(lijst_qids(waarde(r, "plekken")))
        nodig.update(lijst_qids(waarde(r, "land1")))
        nodig.update(lijst_qids(waarde(cijfers.get(q, {}), "fabrikanten")))

    print(f"4/4 Namen ophalen voor {len(nodig)} onderwerpen…")
    naam = haal_namen(nodig)

    dit_jaar = datetime.date.today().year
    achtbanen = []
    for q, r in basis.items():
        if q not in naam:
            continue
        c = cijfers.get(q, {})

        delen = lijst_qids(waarde(r, "delen"))
        plekken = lijst_qids(waarde(r, "plekken"))
        park_id = next((k for k in delen + plekken if k in parken), None)
        park_id = park_id or (plekken[0] if plekken else None) or (delen[0] if delen else None)

        types = [t for t in lijst_qids(waarde(r, "types")) if t != ACHTBAAN.split(":")[1]]
        type_naam = next((naam[t] for t in types if t in naam), "achtbaan")

        fabrikant = next((naam[f] for f in lijst_qids(waarde(c, "fabrikanten")) if f in naam), None)
        geopend = min(jaren(waarde(c, "geopend")) or jaren(waarde(c, "begin")) or [0]) or None
        gesloten_veld = waarde(c, "gesloten")
        gesloten = max(jaren(gesloten_veld) or [0]) or None

        if gesloten_veld:
            status = "gesloten"
        elif geopend and geopend > dit_jaar:
            status = "gepland"
        else:
            status = "open"

        lat, lon = coordinaten(waarde(r, "coord1"))
        rcdb = waarde(r, "rcdb1")

        a = {
            "id": q,
            "naam": naam[q],
            "park": naam.get(park_id) if park_id else None,
            "parkId": park_id,
            "land": naam.get(qid(waarde(r, "land1"))),
            "type": eerste_hoofdletter(type_naam),
            "fabrikant": fabrikant,
            "status": status,
            "geopend": geopend,
            "gesloten": gesloten,
            "hoogte": getal(waarde(c, "hoogte"), maximaal=200, decimalen=1),
            "snelheid": getal(waarde(c, "snelheid"), factor=3.6, maximaal=260),
            "lengte": getal(waarde(c, "lengte"), maximaal=4000),
            "duur": getal(waarde(c, "duur"), minimaal=5, maximaal=900),
            "foto": bestandsnaam(waarde(r, "foto1")),
            "lat": lat,
            "lon": lon,
            "rcdb": rcdb if rcdb and rcdb.isdigit() else None,
        }
        achtbanen.append({k: v for k, v in a.items() if v is not None})

    achtbanen.sort(key=lambda a: a["naam"].casefold())
    return achtbanen


def schrijf(achtbanen):
    UITVOER.parent.mkdir(parents=True, exist_ok=True)
    kop = {
        "bijgewerkt": datetime.date.today().isoformat(),
        "bron": "Wikidata (CC0), foto's via Wikimedia Commons",
        "aantal": len(achtbanen),
    }
    regels = ",\n".join(json.dumps(a, ensure_ascii=False) for a in achtbanen)
    tekst = json.dumps(kop, ensure_ascii=False)[:-1] + ',\n"achtbanen": [\n' + regels + "\n]}\n"
    json.loads(tekst)  # controle: is het geldige JSON?
    UITVOER.write_text(tekst, encoding="utf-8")


def vorig_aantal():
    try:
        return json.loads(UITVOER.read_text(encoding="utf-8")).get("aantal", 0)
    except (OSError, ValueError):
        return 0


def main():
    vorige = vorig_aantal()
    try:
        achtbanen = bouw()
    except Exception as fout:  # noqa: BLE001
        print(f"\n✗ Ophalen mislukt: {fout}")
        if vorige:
            print(f"  De bestaande lijst met {vorige} achtbanen blijft staan.")
            return 0
        return 1

    if vorige and len(achtbanen) < vorige * 0.5:
        print(f"\n✗ Verdacht weinig achtbanen ({len(achtbanen)} tegen {vorige} vorige keer).")
        print("  De bestaande lijst blijft staan.")
        return 0

    schrijf(achtbanen)
    print(f"\n✓ {len(achtbanen)} achtbanen opgeslagen in {UITVOER.relative_to(UITVOER.parent.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
