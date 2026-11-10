#!/usr/bin/env python3
"""
Haalt alle achtbanen op uit Wikidata en OpenStreetMap en schrijft ze naar
data/achtbanen.json.

GitHub Actions draait dit script automatisch (zie .github/workflows/site.yml).
Je kunt het ook zelf draaien met:  python3 scripts/haal_achtbanen.py
Er zijn geen extra Python-pakketten nodig.

Bronnen
- Wikidata: vrij te gebruiken (CC0).
- OpenStreetMap, via de Overpass API: © OpenStreetMap-bijdragers, onder de
  Open Database License (ODbL). Omdat data/achtbanen.json gegevens uit
  OpenStreetMap bevat, valt dat bestand onder de ODbL.
- Foto's: alleen bestandsnamen van Wikimedia Commons, na controle dat het
  bestand er echt staat met een vrije licentie. Volgorde: Wikidata P18, de
  Commons-categorie (P373), de vrije hoofdafbeelding van het Wikipedia-artikel,
  de image- of wikimedia_commons-tag uit OpenStreetMap. De site toont per foto
  de maker en de licentie.
Gegevens of foto's van rcdb.com worden niet gebruikt. Alleen het RCDB-nummer
(uit Wikidata of OpenStreetMap) staat erin, voor een link naar de RCDB-pagina.
"""

import datetime
import html
import http.client
import json
import math
import os
import pathlib
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

import normaliseer as norm
import rapport
import wikipedia as wp

MAP = pathlib.Path(__file__).resolve().parent.parent
UITVOER = MAP / "data" / "achtbanen.json"
DETAILS = MAP / "data" / "details.json"
GEREDEN = MAP / "data" / "gereden.json"
EXTRA = MAP / "data" / "extra.json"
SPLITSEN = MAP / "data" / "splitsen.json"

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

# OpenStreetMap: één grote vraag per run, eerst bij de hoofdserver,
# bij drukte of storing bij een reserve-server.
OVERPASS = [
    ("overpass-api.de", "https://overpass-api.de/api/interpreter"),
    ("private.coffee", "https://overpass.private.coffee/api/interpreter"),
    ("kumi.systems", "https://overpass.kumi.systems/api/interpreter"),
]
# Hoe lang Overpass in totaal mag duren (alle pogingen en servers samen), en per poging.
# Lukt het niet binnen die tijd, dan blijven de OSM-gegevens van de vorige keer staan.
OVERPASS_TOTAAL = int(os.environ.get("OVERPASS_TOTAAL", 25 * 60))
OVERPASS_POGING = 600
VRAAG_OSM = f"""[out:json][timeout:{OVERPASS_POGING}][maxsize:1073741824];
node["attraction"="roller_coaster"];
out body qt;
(way["attraction"="roller_coaster"]; relation["attraction"="roller_coaster"];);
out tags center qt;
node["tourism"="theme_park"];
out body qt;
(way["tourism"="theme_park"]; relation["tourism"="theme_park"];);
out geom qt;
"""

ACHTBAAN = "wd:Q204832"  # roller coaster
PRETPARK = "wd:Q194195"  # amusement park
DIERENTUIN = "wd:Q43501"  # zoo
TALEN = ["nl", "mul", "en", "de", "fr", "es", "it", "pt", "sv", "pl", "ja", "zh"]

KOPPEL_AFSTAND = 300      # meter: zelfde naam en zo dichtbij = dezelfde achtbaan
KOPPEL_AFSTAND_NAAM = 1500  # meter: precies dezelfde naam (Wikidata zet een baan vaak midden in het park)
KOPPEL_AFSTAND_PARK = 3000  # meter: zelfde naam en zelfde park, coördinaten wat onnauwkeurig
LAND_AFSTAND = 25000      # meter: land overnemen van de dichtstbijzijnde bekende achtbaan
PARKPUNT_AFSTAND = 600    # meter: park dat alleen als punt in OSM staat

PREFIXEN = """
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX psn: <http://www.wikidata.org/prop/statement/value-normalized/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX schema: <http://schema.org/>
"""

# Vraag 1: waar staat de achtbaan, hoe heet het type, foto, coördinaten.
VRAAG_BASIS = PREFIXEN + f"""
SELECT ?item
  (GROUP_CONCAT(STR(?type); separator="|") AS ?types)
  (GROUP_CONCAT(STR(?deel); separator="|") AS ?delen)
  (GROUP_CONCAT(STR(?plek); separator="|") AS ?plekken)
  (GROUP_CONCAT(DISTINCT STR(?land); separator="|") AS ?land1)
  (GROUP_CONCAT(DISTINCT STR(?coord); separator="|") AS ?coord1)
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

# Vraag 3: materiaal (staal, hout), staat (open, gesloten), begin en einde van de dienst,
# en de koppeling naar OpenStreetMap die Wikidata zelf kent
VRAAG_EXTRA = PREFIXEN + f"""
SELECT ?item
  (GROUP_CONCAT(DISTINCT STR(?mat); separator="|") AS ?materialen)
  (GROUP_CONCAT(DISTINCT STR(?staat); separator="|") AS ?staten)
  (GROUP_CONCAT(DISTINCT STR(?b); separator="|") AS ?beginnen)
  (GROUP_CONCAT(DISTINCT STR(?e); separator="|") AS ?einden)
  (GROUP_CONCAT(DISTINCT STR(?way); separator="|") AS ?ways)
  (GROUP_CONCAT(DISTINCT STR(?node); separator="|") AS ?nodes)
WHERE {{
  ?item wdt:P31/wdt:P279* {ACHTBAAN} .
  OPTIONAL {{ ?item wdt:P186 ?mat . }}
  OPTIONAL {{ ?item wdt:P5817 ?staat . }}
  OPTIONAL {{ ?item wdt:P580|wdt:P729 ?b . }}
  OPTIONAL {{ ?item wdt:P582|wdt:P730 ?e . }}
  OPTIONAL {{ ?item wdt:P10689 ?way . }}
  OPTIONAL {{ ?item wdt:P11693 ?node . }}
}}
GROUP BY ?item
"""

# Vraag 4: in welk park stond de baan wanneer? Voor banen die verhuisd zijn.
VRAAG_PLEKKEN = PREFIXEN + f"""
SELECT ?item ?plek ?begin ?eind WHERE {{
  ?item wdt:P31/wdt:P279* {ACHTBAAN} .
  ?item p:P276|p:P361 ?s .
  ?s ps:P276|ps:P361 ?plek ; wikibase:rank ?rang .
  FILTER(?rang != wikibase:DeprecatedRank)
  OPTIONAL {{ ?s pq:P580 ?begin . }}
  OPTIONAL {{ ?s pq:P582 ?eind . }}
}}
"""

# Landcodes (NL, DE, ...) voor OSM-objecten met addr:country
VRAAG_LANDCODES = PREFIXEN + """
SELECT ?land ?iso WHERE {
  ?land wdt:P297 ?iso .
  FILTER NOT EXISTS { ?land wdt:P576 ?einde . }
}
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


def vraag_overpass():
    """Eén grote Overpass-vraag. Bij drukte (429, 504) even wachten en opnieuw,
    bij een storing de volgende server. Alles samen nooit langer dan OVERPASS_TOTAAL."""
    body = urllib.parse.urlencode({"data": VRAAG_OSM}).encode()
    fouten = []
    begin = time.monotonic()
    over = lambda: OVERPASS_TOTAAL - (time.monotonic() - begin)  # noqa: E731
    for naam, url in OVERPASS:
        for poging in range(3):
            if over() < 120:
                fouten.append(f"tijd op na {round((time.monotonic() - begin) / 60)} minuten")
                raise RuntimeError("Overpass gaf niet op tijd antwoord:\n  " + "\n  ".join(fouten))
            print(f"  Overpass ({naam}): vraag verstuurd, poging {poging + 1}…")
            try:
                verzoek = urllib.request.Request(url, data=body, headers={
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": USER_AGENT,
                })
                with urllib.request.urlopen(verzoek, timeout=min(OVERPASS_POGING + 60, over())) as antwoord:
                    data = json.load(antwoord)
                # Overpass meldt een time-out of geheugenfout soms in een 200-antwoord
                opmerking = str(data.get("remark") or "")
                if "error" in opmerking.lower():
                    raise ValueError(opmerking.strip())
                elementen = data.get("elements") or []
                if not any(e.get("tags", {}).get("attraction") == "roller_coaster" for e in elementen):
                    raise ValueError("antwoord zonder achtbanen")
                print(f"  ✓ Overpass ({naam}): {len(elementen)} objecten")
                return elementen
            except urllib.error.HTTPError as fout:
                if fout.code in (429, 502, 503, 504) and poging < 2:
                    wacht = min(int(fout.headers.get("Retry-After") or 0) or 60 * (poging + 1), 180)
                    print(f"  Overpass ({naam}): HTTP {fout.code}, het is druk; opnieuw over {wacht} s")
                    time.sleep(wacht)
                    continue
                fouten.append(f"{naam}: HTTP {fout.code}")
                break
            except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as fout:
                # Te traag (time-out): meteen de volgende server. Korte storing: één keer opnieuw.
                traag = isinstance(fout, TimeoutError) or "timed out" in str(fout).lower() or "timeout" in str(fout).lower()
                if poging < 1 and not traag:
                    print(f"  Overpass ({naam}): {fout}; opnieuw over 30 s")
                    time.sleep(30)
                    continue
                print(f"  Overpass ({naam}): {fout}; volgende server")
                fouten.append(f"{naam}: {fout}")
                break
    raise RuntimeError("Geen enkele Overpass-server gaf antwoord:\n  " + "\n  ".join(fouten))


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
    """Zoekt per Wikidata-code de beste naam: Nederlands, anders een andere taal.
    Geeft ook alle namen per code terug (om OSM-namen te kunnen vergelijken)."""
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
    return beste, {q: set(perTaal.values()) for q, perTaal in namen.items()}


def welke_zijn_parken(qids, klassen=(PRETPARK,)):
    parken = set()
    for stuk in in_stukjes(sorted(qids), 400):
        waarden = " ".join(f"wd:{q}" for q in stuk)
        sparql = PREFIXEN + f"""
SELECT DISTINCT ?e WHERE {{
  VALUES ?e {{ {waarden} }}
  VALUES ?klasse {{ {" ".join(klassen)} }}
  ?e wdt:P31/wdt:P279* ?klasse .
}}"""
        for rij in vraag(sparql):
            q = qid(waarde(rij, "e"))
            if q:
                parken.add(q)
        time.sleep(1)
    return parken


def haal_landen(qids):
    """Land (P17) van parken die OpenStreetMap aan Wikidata koppelt."""
    landen = {}
    for stuk in in_stukjes(sorted(qids), 400):
        waarden = " ".join(f"wd:{q}" for q in stuk)
        sparql = PREFIXEN + f"""
SELECT ?e ?land WHERE {{
  VALUES ?e {{ {waarden} }}
  ?e wdt:P17 ?land .
}}"""
        for rij in vraag(sparql):
            q, land = qid(waarde(rij, "e")), qid(waarde(rij, "land"))
            if q and land:
                landen.setdefault(q, land)
        time.sleep(1)
    return landen


def eerste_hoofdletter(tekst):
    return tekst[:1].upper() + tekst[1:] if tekst else tekst


def bouw_wikidata():
    print("1/5 Achtbanen en locaties ophalen bij Wikidata…")
    basis = {qid(waarde(r, "item")): r for r in vraag(VRAAG_BASIS)}
    basis.pop(None, None)
    print(f"  {len(basis)} achtbanen gevonden")
    time.sleep(2)

    print("2/5 Hoogte, snelheid, lengte, jaartallen, materiaal en status ophalen…")
    cijfers = {qid(waarde(r, "item")): r for r in vraag(VRAAG_CIJFERS)}
    time.sleep(2)
    try:
        extra = {qid(waarde(r, "item")): r for r in vraag(VRAAG_EXTRA)}
    except RuntimeError as fout:
        print(f"  materiaal en status niet opgehaald: {fout}")
        extra = {}
    time.sleep(2)
    plekken = defaultdict(set)
    try:
        for r in vraag(VRAAG_PLEKKEN):
            q, plek = qid(waarde(r, "item")), qid(waarde(r, "plek"))
            if q and plek:
                begin, eind = jaren(waarde(r, "begin")), jaren(waarde(r, "eind"))
                plekken[q].add((plek, begin[0] if begin else None, eind[0] if eind else None))
    except RuntimeError as fout:
        print(f"  parken met jaartallen niet opgehaald: {fout}")
    time.sleep(2)

    print("3/5 Uitzoeken welke locaties pretparken zijn…")
    kandidaten = set()
    for r in basis.values():
        kandidaten.update(lijst_qids(waarde(r, "delen")))
        kandidaten.update(lijst_qids(waarde(r, "plekken")))
    for lijst in plekken.values():
        kandidaten.update(p for p, _, _ in lijst)
    parken = welke_zijn_parken(kandidaten)
    print(f"  {len(parken)} parken herkend")

    nodig = set(basis)
    for q, r in basis.items():
        nodig.update(lijst_qids(waarde(r, "types")))
        nodig.update(lijst_qids(waarde(r, "delen")))
        nodig.update(lijst_qids(waarde(r, "plekken")))
        nodig.update(lijst_qids(waarde(r, "land1")))
        nodig.update(lijst_qids(waarde(cijfers.get(q, {}), "fabrikanten")))
        nodig.update(lijst_qids(waarde(extra.get(q, {}), "materialen")))
        nodig.update(lijst_qids(waarde(extra.get(q, {}), "staten")))
    for lijst in plekken.values():
        nodig.update(p for p, _, _ in lijst)
    return basis, cijfers, extra, plekken, parken, nodig


# Velden met een bron: voor elk veld bewaart het script waar de waarde vandaan komt
FEITEN = ("hoogte", "valhoogte", "lengte", "snelheid", "inversies", "duur",
          "geopend", "gesloten", "status", "fabrikant", "model", "type")
GEPLAND = re.compile(r"voorgesteld|proposed|planned|gepland|under construction|in aanbouw|im bau", re.I)


def historie_van(plekken, parken):
    """(huidig park, [vorige parken]) uit de parken met jaartallen, of (None, [])."""
    lijst = sorted({p for p in plekken if p[0] in parken}, key=lambda p: (p[1] or 0, p[2] or 9999))
    if len(lijst) < 2 or not any(b or e for _, b, e in lijst):
        return None, []
    huidig = lijst[-1]
    vorige = [p for p in lijst[:-1] if p[0] != huidig[0]]
    return huidig, vorige


def maak_wikidata_lijst(basis, cijfers, extra, plekken, parken, naam, alle_namen):
    dit_jaar = datetime.date.today().year
    achtbanen = []
    for q, r in basis.items():
        if q not in naam:
            continue
        c, x = cijfers.get(q, {}), extra.get(q, {})

        delen = lijst_qids(waarde(r, "delen"))
        plekken_q = lijst_qids(waarde(r, "plekken"))
        # Verhuisd? Dan telt het park waar de baan het laatst kwam.
        huidig, vorige = historie_van(plekken.get(q, set()), parken)
        park_id = huidig[0] if huidig else next((k for k in delen + plekken_q if k in parken), None)
        park_zeker = park_id is not None
        park_id = park_id or (plekken_q[0] if plekken_q else None) or (delen[0] if delen else None)

        types = [t for t in lijst_qids(waarde(r, "types")) if t != ACHTBAAN.split(":")[1]]
        labels = [naam[t] for t in types if t in naam]
        materialen = [naam[m] for m in lijst_qids(waarde(x, "materialen")) if m in naam]
        staten = [naam[s] for s in lijst_qids(waarde(x, "staten")) if s in naam]
        model = next((m for m in (norm.model_uit_label(l) for l in labels) if m), None)

        geopend = min(jaren(waarde(c, "geopend")) or jaren(waarde(c, "begin")) or jaren(waarde(x, "beginnen")) or [0]) or None
        einden = jaren(waarde(c, "gesloten")) + jaren(waarde(x, "einden")) + ([huidig[2]] if huidig and huidig[2] else [])
        gesloten = max(einden or [0]) or None
        status = next((s for s in (wp.status_van(t) for t in staten) if s), None)
        if not status:
            if gesloten:
                status = "gesloten"
            elif geopend and geopend > dit_jaar:
                status = "gepland"
            elif any(GEPLAND.search(l) for l in labels):
                status = "gepland"

        park_naam = naam.get(park_id) if park_id else None
        schone_naam, bijna = norm.naam(naam[q], park_naam)
        if bijna and not status:
            status = "gepland"
        # Een verhuisde baan heeft soms meer landen en plekken: allemaal bewaren, en straks
        # kiezen wat bij het park past (plek_bij_park). Tot die tijd: een vaste keus.
        punten = sorted({p for p in (coordinaten(w) for w in (waarde(r, "coord1") or "").split("|")) if p[0] is not None})
        lat, lon = punten[0] if punten else (None, None)
        landen = sorted({l for l in (norm.land(naam.get(x)) for x in lijst_qids(waarde(r, "land1"))) if l})
        rcdb = waarde(r, "rcdb1")
        fabrikant = next((naam[f] for f in lijst_qids(waarde(c, "fabrikanten")) if f in naam), None)

        a = {
            "id": q,
            "naam": schone_naam,
            "park": park_naam,
            "parkId": park_id,
            "land": landen[0] if landen else None,
            "_landen": landen if len(landen) > 1 else None,
            "_punten": punten if len(punten) > 1 else None,
            "foto": bestandsnaam(waarde(r, "foto1")),
            "lat": lat,
            "lon": lon,
            "rcdb": rcdb if rcdb and rcdb.isdigit() else None,
            # Alleen voor het samenvoegen en kiezen, komt niet in het bestand
            "_namen": alle_namen.get(q, set()) | {naam[q], schone_naam},
            "_park_zeker": park_zeker,
            "_osm_wd": {f"osm-way-{w}" for w in (waarde(x, "ways") or "").split("|") if w.strip().isdigit()}
                       | {f"osm-node-{n}" for n in (waarde(x, "nodes") or "").split("|") if n.strip().isdigit()},
            "_w": {"wd": {k: v for k, v in {
                "hoogte": waarde(c, "hoogte"),
                "snelheid": float(waarde(c, "snelheid")) * 3.6 if waarde(c, "snelheid") else None,
                "lengte": waarde(c, "lengte"),
                "duur": waarde(c, "duur"),
                "geopend": geopend,
                "gesloten": gesloten,
                "status": status,
                "fabrikant": fabrikant,
                "model": model,
                "type": " | ".join(labels + materialen) or None,
            }.items() if v is not None}},
        }
        if vorige:
            a["_vorige"] = [{"park": naam.get(p), "parkId": p, "van": b, "tot": e} for p, b, e in vorige]
        achtbanen.append({k: v for k, v in a.items() if v is not None})
    return achtbanen


# ---------------------------------------------------------------------------
# OpenStreetMap
# ---------------------------------------------------------------------------

QID = re.compile(r"Q[1-9]\d*")
LATIJN = re.compile(r"[A-Za-zÀ-ɏ]")
ALGEMEEN = {
    "achtbaan", "rollercoaster", "roller", "coaster", "achterbahn", "montagnes", "russes",
    "montana", "rusa", "the", "de", "het", "der", "die", "das", "la", "le", "les", "el",
    "and", "und", "en", "et", "y",
}
OSM_TYPES = {
    "steel": "Stalen achtbaan", "wooden": "Houten achtbaan", "wood": "Houten achtbaan",
    "hybrid": "Hybride achtbaan", "inverted": "Omgekeerde achtbaan", "flying": "Vliegende achtbaan",
    "spinning": "Draaiende achtbaan", "wild_mouse": "Wilde muis", "bobsled": "Bobsleebaan",
    "mine_train": "Mijntreinachtbaan", "family": "Familieachtbaan", "kiddie": "Kinderachtbaan",
    "junior": "Kinderachtbaan", "launched": "Lanceerachtbaan", "water": "Waterachtbaan",
    "suspended": "Hangende achtbaan", "dive": "Duikachtbaan", "wing": "Wing coaster",
    "boomerang": "Boomerang", "shuttle": "Shuttleachtbaan", "powered": "Aangedreven achtbaan",
    "alpine": "Alpine coaster", "mountain": "Alpine coaster", "4th_dimension": "4D-achtbaan",
}


# OpenStreetMap gebruikt attraction=roller_coaster soms ook voor dingen die geen
# achtbaan zijn. Deze regels gelden alleen voor objecten die niet aan Wikidata
# gekoppeld zijn.
STATION = re.compile(r"\b(station|stazione|estaci[oó]n|bahnhof)\b|(berg|tal)station", re.I)
GEEN_ACHTBAAN = [
    ("zomerrodelbaan", re.compile(
        r"alpine?[\s-]*coaster|mountain[\s-]*coaster|coaster[\s-]*alpin|sommerrodel|rodelbahn|\brodel"
        r"|(summer|alpine?|mountain)[\s-]*toboggan|toboggan[\s-]*(alpin|d.?[ée]t[ée])|\bluge\b"
        r"|bob\s+su\s+rotaia|pista\s+de\s+bob|tatrabob|alpine\s+slide|alpin\s*bob|alpenbob", re.I)),
    ("waterattractie", re.compile(
        r"wildwasser|wild[\s-]*water(?![\s-]*coaster)|rapids\b|rafting|\bflume|log[\s-]*ride|rutsche"
        r"|water[\s-]*slides?|waterslide|glijbaan|wildwaterbaan|boomstam|водн", re.I)),
    ("andere attractie", re.compile(
        r"tyrolienne|zip[\s-]*line|go[\s-]*kart|\bkart\b|karussell|carousel|carrousel|riesenrad"
        r"|ferris|grande roue|traktor|tractor|oldtimer|autoscooter|bumper|spielplatz|playground|speeltuin"
        r"|\b4-?d\b|dark[\s-]*ride|geisterbahn|\breise\b|zauberreise|kirche|church|[ée]glise|test track", re.I)),
]
# Een VR-versie van een bestaande baan is geen aparte achtbaan
VR = re.compile(r"coastiality|virtual\s*line|virtual reality|\bvr\b|\bxr(\s*ride)?\b|xrライド", re.I)


def geen_achtbaan(naam, tags):
    """Reden waarom een OSM-object geen achtbaan is, of None."""
    for reden, patroon in GEEN_ACHTBAAN:
        if patroon.search(naam or ""):
            return reden
    soort = (tags.get("roller_coaster:type") or "").lower()
    if soort in ("alpine", "mountain", "summer_toboggan", "alpine_coaster"):
        return "zomerrodelbaan"
    return None


def is_station(naam, tags):
    return tags.get("roller_coaster") in ("station", "queue", "platform") or bool(STATION.search(naam or ""))


def zonder_station(naam):
    kaal = re.sub(r"\s+", " ", STATION.sub(" ", naam or "")).strip(" -–:,")
    return kaal if kaal and kaal != naam else None


def osm_id(el):
    return f"osm-{el['type']}-{el['id']}"


def osm_pad(el_id):
    """osm-way-123 -> way/123 (voor een link naar openstreetmap.org)"""
    _, soort, nummer = el_id.split("-", 2)
    return f"{soort}/{nummer}"


def osm_plek(el):
    if "lat" in el and "lon" in el:
        return el["lat"], el["lon"]
    c = el.get("center")
    if c:
        return c["lat"], c["lon"]
    b = el.get("bounds")
    if b:
        return (b["minlat"] + b["maxlat"]) / 2, (b["minlon"] + b["maxlon"]) / 2
    return None, None


def leesbare_naam(t):
    """Nederlandse naam als die er is; anders de gewone naam, of de Engelse
    als de gewone naam geen Latijns schrift gebruikt (bijvoorbeeld Japans)."""
    if t.get("name:nl"):
        return t["name:nl"].strip()
    naam = (t.get("name") or "").strip()
    if naam and (LATIJN.search(naam) or not t.get("name:en")):
        return naam
    return (t.get("name:en") or naam or "").strip() or None


def naam_varianten(t):
    uit = []
    for k in ("name", "name:nl", "name:en", "name:de", "name:fr", "int_name",
              "official_name", "alt_name", "old_name", "short_name"):
        for deel in (t.get(k) or "").split(";"):
            if deel.strip():
                uit.append(deel.strip())
    return uit


def naam_sleutels(naam):
    """Vergelijkbare vorm van een naam: "F.L.Y." en "Fly" worden allebei "fly"."""
    s = unicodedata.normalize("NFKD", str(naam)).casefold()
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\([^)]*\)", " ", s).replace("&", " ")
    woorden = re.findall(r"\w+", s)
    vol = "".join(woorden)
    los = "".join(w for w in woorden if w not in ALGEMEEN)
    return {k for k in (vol, los) if len(k) >= 2}


def volle_sleutel(naam):
    """Alleen de volledige vorm (zonder het weglaten van woorden als "coaster")."""
    s = unicodedata.normalize("NFKD", str(naam)).casefold()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(re.findall(r"\w+", re.sub(r"\([^)]*\)", " ", s).replace("&", " ")))


def afstand(lat1, lon1, lat2, lon2):
    """Afstand in meter."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(min(1.0, a)))


def meters(tekst):
    """height=30, 30 m, 30,5 of 98 ft -> meters"""
    m = re.match(r"\s*([\d.,]+)\s*(m|meter|metres?|ft|feet|')?\s*$", str(tekst or ""), re.I)
    if not m:
        return None
    try:
        n = float(m.group(1).replace(",", "."))
    except ValueError:
        return None
    if (m.group(2) or "").lower() in ("ft", "feet", "'"):
        n *= 0.3048
    return n


def jaar_uit(tekst):
    m = re.match(r"\s*(\d{4})", str(tekst or ""))
    return int(m.group(1)) if m else None


def binnen(x, y, lijnen):
    """Ligt punt (lon, lat) binnen het vlak? Even-oneven-regel over alle randen,
    zodat ook multipolygonen met losse stukken buitenrand goed gaan."""
    binnenin = False
    for lijn in lijnen:
        for (x1, y1), (x2, y2) in zip(lijn, lijn[1:]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                binnenin = not binnenin
    return binnenin


class Raster:
    """Eenvoudige ruimtelijke index: vakjes van 0,25 graad."""
    STAP = 0.25

    def __init__(self):
        self.vakken = defaultdict(list)

    def vak(self, lat, lon):
        return math.floor(lat / self.STAP), math.floor(lon / self.STAP)

    def zet_punt(self, item, lat, lon):
        self.vakken[self.vak(lat, lon)].append(item)

    def zet_vlak(self, item, minlat, minlon, maxlat, maxlon):
        a, b = self.vak(minlat, minlon)
        c, d = self.vak(maxlat, maxlon)
        for i in range(a, c + 1):
            for j in range(b, d + 1):
                self.vakken[(i, j)].append(item)

    def hier(self, lat, lon):
        return self.vakken.get(self.vak(lat, lon), [])

    def rond(self, lat, lon, ring=1):
        i, j = self.vak(lat, lon)
        for di in range(-ring, ring + 1):
            for dj in range(-ring, ring + 1):
                yield from self.vakken.get((i + di, j + dj), [])


class Parken:
    """Pretparken uit OpenStreetMap (tourism=theme_park)."""

    def __init__(self, elementen):
        self.vlakken, self.punten = Raster(), Raster()
        self.aantal = 0
        for el in elementen:
            t = el.get("tags", {})
            if t.get("tourism") != "theme_park" or t.get("attraction") == "roller_coaster":
                continue
            q = (t.get("wikidata") or "").strip()
            park = {"id": osm_id(el), "naam": leesbare_naam(t), "qid": q if QID.fullmatch(q) else None,
                    "iso": (t.get("addr:country") or "").strip().upper() or None}
            if not park["naam"] and not park["qid"]:
                continue
            if el["type"] == "node":
                park["lat"], park["lon"] = el["lat"], el["lon"]
                self.punten.zet_punt(park, el["lat"], el["lon"])
                self.aantal += 1
                continue
            if el["type"] == "way":
                stukken = [el.get("geometry") or []]
            elif t.get("type") in ("multipolygon", "boundary"):
                stukken = [m.get("geometry") or [] for m in el.get("members", []) if m.get("type") == "way"]
            else:
                continue
            lijnen = []
            for stuk in stukken:
                punten = [(p["lon"], p["lat"]) for p in stuk if p]
                if len(punten) >= 2:
                    lijnen.append(punten)
            if not lijnen:
                continue
            if el["type"] == "way" and lijnen[0][0] != lijnen[0][-1]:
                lijnen[0].append(lijnen[0][0])
            xs = [x for lijn in lijnen for x, _ in lijn]
            ys = [y for lijn in lijnen for _, y in lijn]
            if max(xs) - min(xs) > 0.5 or max(ys) - min(ys) > 0.5:
                continue  # geen pretpark van 50 km breed; waarschijnlijk een fout
            park.update(lijnen=lijnen, bbox=(min(xs), min(ys), max(xs), max(ys)),
                        oppervlak=(max(xs) - min(xs)) * (max(ys) - min(ys)))
            self.vlakken.zet_vlak(park, min(ys), min(xs), max(ys), max(xs))
            self.aantal += 1

    def zoek(self, lat, lon):
        """Het parkgebied waar het punt in ligt, anders een parkpunt vlakbij. Liggen er
        gebieden in elkaar (bijvoorbeeld een themagebied dat ook als park is getekend),
        dan gaat een gebied met een Wikidata-koppeling voor, en daarna het kleinste."""
        beste = None
        for p in self.vlakken.hier(lat, lon):
            x0, y0, x1, y1 = p["bbox"]
            if x0 <= lon <= x1 and y0 <= lat <= y1 and binnen(lon, lat, p["lijnen"]):
                sleutel = (p["qid"] is None, p["oppervlak"])
                if beste is None or sleutel < (beste["qid"] is None, beste["oppervlak"]):
                    beste = p
        if beste:
            return beste
        dichtst = None
        for p in self.punten.rond(lat, lon):
            d = afstand(lat, lon, p["lat"], p["lon"])
            if d <= PARKPUNT_AFSTAND and (dichtst is None or d < dichtst[0]):
                dichtst = (d, p)
        return dichtst[1] if dichtst else None


def lees_osm_banen(elementen, parken, tel):
    banen = []
    for el in elementen:
        t = el.get("tags", {})
        if t.get("attraction") != "roller_coaster":
            continue
        tel["osm_objecten"] += 1
        lat, lon = osm_plek(el)
        if lat is None:
            tel["osm_zonder_plek"] += 1
            continue
        q = (t.get("wikidata") or "").strip()
        naam = leesbare_naam(t)
        varianten = naam_varianten(t)
        station = is_station(naam, t)
        if station:
            # "Cobra Station" mag samengaan met de baan "Cobra"
            varianten += [k for k in (zonder_station(n) for n in varianten) if k]
        geen = geen_achtbaan(naam, t)
        banen.append({
            "id": osm_id(el), "type": el["type"], "nummer": el["id"], "tags": t,
            "naam": naam, "varianten": varianten,
            "lat": lat, "lon": lon, "q": q if QID.fullmatch(q) else None,
            "park": parken.zoek(lat, lon),
            "station": station, "vr": bool(VR.search(naam or "")),
            # Alpine coasters (zomerrodelbanen op rails) blijven, met een eigen type
            "alpine": geen == "zomerrodelbaan",
            "geen": None if geen == "zomerrodelbaan" else geen,
        })
    return banen


def zelfde_park(o, a):
    p = o["park"]
    if not p:
        return False
    if p["qid"] and p["qid"] == a.get("parkId"):
        return True
    return bool(p["naam"] and a.get("park") and naam_sleutels(p["naam"]) & naam_sleutels(a["park"]))


def keuze_score(o, vorige_ids):
    """Welk OSM-object geeft de id van een groep: bij voorkeur de id die er al was,
    dan geen station, dan het spoor (roller_coaster=track), dan een way, dan het laagste nummer."""
    return (
        o["id"] not in vorige_ids,
        o["station"],
        o["tags"].get("roller_coaster") != "track",
        {"way": 0, "relation": 1, "node": 2}[o["type"]],
        o["nummer"],
    )


def osm_waarden(groep):
    """Gegevens uit de tags van een groep OSM-objecten (eerste object gaat voor)."""
    uit = {}
    for o in groep:
        t = o["tags"]
        uit.setdefault("hoogte", None)
        if uit["hoogte"] is None:
            h = meters(t.get("height"))
            uit["hoogte"] = round(h, 1) if h and 0 < h < 200 else None
        if not uit.get("lengte"):
            n = meters(t.get("length") or t.get("roller_coaster:length"))
            uit["lengte"] = int(round(n)) if n and 0 < n < 4000 else None
        if not uit.get("rcdb"):
            r = re.sub(r"\D", "", t.get("rcdb_id") or t.get("rcdb") or "")
            uit["rcdb"] = r or None
        if not uit.get("geopend"):
            uit["geopend"] = jaar_uit(t.get("opening_date") or t.get("start_date"))
        if not uit.get("fabrikant"):
            uit["fabrikant"] = (t.get("manufacturer") or "").strip() or None
        if not uit.get("type"):
            soort = (t.get("roller_coaster:type") or t.get("roller_coaster:material") or "").strip().lower()
            uit["type"] = "Alpine coaster" if o.get("alpine") else OSM_TYPES.get(soort.replace(" ", "_").replace("-", "_"))
        if not uit.get("iso"):
            uit["iso"] = (t.get("addr:country") or "").strip().upper() or None
    return uit


class Unie:
    def __init__(self, n):
        self.ouder = list(range(n))

    def wortel(self, i):
        while self.ouder[i] != i:
            self.ouder[i] = self.ouder[self.ouder[i]]
            i = self.ouder[i]
        return i

    def voeg(self, i, j):
        self.ouder[self.wortel(i)] = self.wortel(j)


TAG_AFSTAND = 5000  # meter: verder weg dan dit is een wikidata-tag waarschijnlijk fout
WEGGELATEN = []  # (reden, naam, park, id), voor de uitleg met ACHTBANEN_UITLEG=1


def deelt_woord(a, b):
    """Hebben twee namen een betekenisvol woord gemeen (zoals "Winja's")?"""
    w = lambda s: {x for x in re.findall(r"\w+", unicodedata.normalize("NFKD", s).casefold()) if len(x) >= 3} - ALGEMEEN  # noqa: E731
    return bool(w(a) & w(b))


def voeg_osm_samen(wd, osm, vorige_lijst, park_naam, land_van, tel, niet_achtbaan=frozenset(), park_qs=frozenset()):
    """Koppelt OSM-objecten aan Wikidata, voegt dubbelen samen en maakt van de
    rest nieuwe achtbanen. Objecten die geen achtbaan zijn, vallen weg.
    Geeft (nieuwe achtbanen, {osm-id: achtbaan-id}, VR-objecten)."""
    dit_jaar = datetime.date.today().year
    per_q = {a["id"]: a for a in wd}
    vorige_ids = {a["id"] for a in vorige_lijst}
    naar_doel = {}

    # OSM-banen van de vorige keer, om hun id te kunnen hergebruiken als een
    # mapper het spoor opnieuw heeft ingetekend (en het dus een nieuw nummer kreeg)
    vorige_osm = defaultdict(list)
    for a in vorige_lijst:
        if a["id"].startswith("osm-") and a.get("lat") is not None:
            for k in naam_sleutels(a["naam"]):
                vorige_osm[k].append(a)
    gebruikt = {o["id"] for o in osm} & vorige_ids

    # 0. De wikidata-tag: wijst hij naar een park, dan is dat een vergissing (negeren).
    #    Wijst hij naar een item dat niet in de achtbanenlijst staat (vaak een baan met een
    #    bouwmodel als type, zoals een Vekoma Boomerang), dan blijft het een OSM-baan, met
    #    dat item erbij voor de Wikipedia-tekst.
    for o in osm:
        if o["q"] in park_qs:
            o["q"] = None

    # 1a. Via de OSM-code die Wikidata zelf bij de baan noemt (P10689, P11693)
    per_osm = {i: a for a in wd for i in a.get("_osm_wd", ())}
    for o in osm:
        a = per_osm.get(o["id"])
        if a:
            a.setdefault("_osm", []).append(o)
            naar_doel[o["id"]] = a["id"]
            tel["osm_via_wikidata"] += 1

    # 1b. Via de wikidata-tag, als het object niet ver van de Wikidata-plek ligt.
    #     Bij een verhuisde baan klopt de plek in Wikidata vaak nog niet: dan geen controle.
    for o in osm:
        a = per_q.get(o["q"])
        if not a or o["id"] in naar_doel:
            continue
        if a.get("lat") is not None and not a.get("_vorige") and afstand(o["lat"], o["lon"], a["lat"], a["lon"]) > TAG_AFSTAND:
            tel["osm_tag_te_ver"] += 1
            continue
        a.setdefault("_osm", []).append(o)
        naar_doel[o["id"]] = a["id"]
        tel["osm_via_tag"] += 1

    # 2. Op naam en afstand (of naam en hetzelfde park)
    index = defaultdict(list)
    for a in wd:
        for n in a["_namen"]:
            for k in naam_sleutels(n):
                index[k].append(a)
    for o in osm:
        if o["id"] in naar_doel or not o["naam"] or o["geen"] or o["vr"]:
            continue
        kandidaten = {id(a): a for n in o["varianten"] for k in naam_sleutels(n) for a in index.get(k, [])}
        o_vol = {volle_sleutel(n) for n in o["varianten"]}
        beste = None
        for a in kandidaten.values():
            zp = zelfde_park(o, a)
            if a.get("lat") is not None:
                d = afstand(o["lat"], o["lon"], a["lat"], a["lon"])
                if d <= KOPPEL_AFSTAND:
                    score = d
                elif zp and d <= KOPPEL_AFSTAND_PARK:
                    score = KOPPEL_AFSTAND + d
                elif d <= KOPPEL_AFSTAND_NAAM and o_vol & {volle_sleutel(n) for n in a["_namen"]}:
                    score = KOPPEL_AFSTAND + d
                else:
                    continue
            elif zp:
                score = 10 * KOPPEL_AFSTAND_PARK
            else:
                continue
            if beste is None or score < beste[0]:
                beste = (score, a)
        if beste:
            a = beste[1]
            a.setdefault("_osm", []).append(o)
            naar_doel[o["id"]] = a["id"]
            tel["osm_via_naam"] += 1

    # Wikidata-achtbanen aanvullen met wat OSM weet
    for a in wd:
        groep = sorted(a.pop("_osm", []), key=lambda o: keuze_score(o, vorige_ids))
        if not groep:
            continue
        eerste = groep[0]
        a["osm"] = osm_pad(eerste["id"])
        a["_osm_ids"] = [o["id"] for o in groep]
        a["_osm_fotos"] = osm_fotos(groep)
        if a.get("lat") is None or a.get("_vorige"):
            a["lat"], a["lon"] = round(eerste["lat"], 5), round(eerste["lon"], 5)
            tel["wd_plek_uit_osm"] += 1
        p = eerste["park"]
        if p and not a.get("_park_zeker"):
            a["park"] = park_naam(p)
            a["parkId"] = p["qid"] or p["id"]
            a["_park_bron"] = "osm"
            tel["wd_park_uit_osm"] += 1
        w = osm_waarden(groep)
        a["_w"]["osm"] = {k: w[k] for k in ("hoogte", "lengte", "geopend", "fabrikant", "type") if w.get(k) is not None}
        if a.get("rcdb") is None and w.get("rcdb"):
            a["rcdb"] = w["rcdb"]
        if not a.get("land"):
            land = norm.land(land_van(eerste, w.get("iso")))
            if land:
                a["land"] = land
                a["_land_bron"] = "osm"
        # Twee of meer OSM-sporen met elk een eigen naam bij één Wikidata-baan
        # (zoals "Winja's Fear" en "Winja's Force"): voorstel om te splitsen
        eigen = {volle_sleutel(n) for n in a["_namen"]}
        sporen = {}
        for o in groep:
            if o["naam"] and not o["station"] and not o["vr"] and volle_sleutel(o["naam"]) not in eigen:
                sporen.setdefault(volle_sleutel(o["naam"]), o["naam"])
        if len(sporen) >= 2 and all(deelt_woord(n, a["naam"]) for n in sporen.values()):
            a["_sporen"] = sorted(sporen.values(), key=str.casefold)

    # 3. De rest: wat geen achtbaan is eruit, dan dubbelen binnen OSM samenvoegen
    rest = [o for o in osm if o["id"] not in naar_doel]
    tel["osm_zonder_naam"] = sum(1 for o in rest if not o["naam"])
    rest = [o for o in rest if o["naam"]]
    for o in rest:
        if o["geen"]:
            tel[f"osm_geen_{o['geen']}"] += 1
            WEGGELATEN.append((o["geen"], o["naam"], o["park"] and o["park"]["naam"], o["id"]))
    vr = [o for o in rest if o["vr"] and not o["geen"]]
    rest = [o for o in rest if not o["geen"] and not o["vr"]]
    unie = Unie(len(rest))
    per_sleutel = defaultdict(list)
    for i, o in enumerate(rest):
        for k in {k for n in o["varianten"] or [o["naam"]] for k in naam_sleutels(n)}:
            per_sleutel[k].append(i)
    for leden in per_sleutel.values():
        for x in range(len(leden)):
            for y in range(x + 1, len(leden)):
                o1, o2 = rest[leden[x]], rest[leden[y]]
                p1, p2 = o1["park"], o2["park"]
                if (afstand(o1["lat"], o1["lon"], o2["lat"], o2["lon"]) <= KOPPEL_AFSTAND
                        or (p1 and p2 and p1["id"] == p2["id"])):
                    unie.voeg(leden[x], leden[y])
    groepen = defaultdict(list)
    for i, o in enumerate(rest):
        groepen[unie.wortel(i)].append(o)

    nieuw = []
    for groep in groepen.values():
        groep.sort(key=lambda o: keuze_score(o, vorige_ids))
        banen = [o for o in groep if not o["station"]]
        if not banen:
            # Alleen een station: vaak staat de baan in OSM alleen zo ("Velociraptor Station",
            # of een station met de naam van de baan). Dan telt het als de baan, zonder "Station".
            # Een kaal "Bergstation" of "Talstation" is geen achtbaan.
            kaal = [o for o in groep if not STATION.search(o["naam"]) or zonder_station(o["naam"])]
            if not kaal:
                tel["osm_alleen_station"] += len(groep)
                WEGGELATEN.append(("los station", groep[0]["naam"], groep[0]["park"] and groep[0]["park"]["naam"], groep[0]["id"]))
                continue
            banen = [dict(o, naam=zonder_station(o["naam"]) or o["naam"]) for o in kaal]
        tel["osm_dubbel_binnen_osm"] += len(groep) - 1
        eerste, baan = groep[0], banen[0]
        w = osm_waarden(groep)
        p = baan["park"] or eerste["park"]
        bewijs = w.get("rcdb") or any(o.get("alpine") for o in groep) or any(
            o["tags"].get("roller_coaster") == "track" or o["tags"].get(k)
            for o in groep for k in ("roller_coaster:type", "manufacturer", "height", "length", "opening_date", "start_date"))
        if not p and not bewijs:
            # Niet in een pretpark en niets wat op een achtbaan wijst (geen spoor, type,
            # fabrikant, hoogte, jaar of RCDB-nummer): meestal iets anders.
            # (Staat hij in Wikidata, dan blijft hij gewoon.)
            tel["osm_buiten_park"] += len(groep)
            WEGGELATEN.append(("buiten een pretpark", baan["naam"], None, baan["id"]))
            continue
        nieuwe_id = eerste["id"]
        if nieuwe_id not in vorige_ids:
            for k in naam_sleutels(baan["naam"]):
                oud = next((v for v in vorige_osm.get(k, []) if v["id"] not in gebruikt
                            and afstand(baan["lat"], baan["lon"], v["lat"], v["lon"]) <= KOPPEL_AFSTAND), None)
                if oud:
                    nieuwe_id = oud["id"]
                    gebruikt.add(nieuwe_id)
                    tel["osm_id_hergebruikt"] += 1
                    break
        geopend = w.get("geopend")
        pnaam = park_naam(p) if p else None
        schone_naam, bijna = norm.naam(baan["naam"], pnaam)
        a = {
            "id": nieuwe_id,
            "naam": schone_naam,
            "park": pnaam,
            "parkId": (p["qid"] or p["id"]) if p else None,
            "land": norm.land(land_van(baan, w.get("iso"))),
            "_w": {"osm": {k: v for k, v in {
                "type": w.get("type"), "fabrikant": w.get("fabrikant"), "geopend": geopend,
                "hoogte": w.get("hoogte"), "lengte": w.get("lengte"),
                "status": "gepland" if bijna or (geopend and geopend > dit_jaar) else None,
            }.items() if v is not None}},
            "lat": round(baan["lat"], 5),
            "lon": round(baan["lon"], 5),
            "rcdb": w.get("rcdb"),
            "wikidata": next((o["q"] for o in groep if o["q"] and o["q"] not in per_q), None),
            "_osm_ids": [o["id"] for o in groep],
            "_osm_fotos": osm_fotos(groep),
            "_namen": {n for o in groep for n in o["varianten"]} | {baan["naam"]},
        }
        nieuw.append({k: v for k, v in a.items() if v is not None})
        for o in groep:
            naar_doel[o["id"]] = a["id"]
    for o in vr:
        p = o["park"]
        o["parkId"] = (p["qid"] or p["id"]) if p else None
    return nieuw, naar_doel, vr


def kern_van_vr(naam):
    """Naam zonder het VR-deel: 'EuroSat Coastiality' wordt 'EuroSat'."""
    return re.sub(r"\s+", " ", VR.sub(" ", naam or "")).strip(" -–—:,")


def voeg_vr_samen(vr, alle, tel):
    """Een VR-versie hoort bij de echte baan in hetzelfde park. Geeft {vr-id: baan-id};
    VR-versies zonder bijpassende baan vallen weg."""
    per_park = defaultdict(list)
    for a in alle:
        per_park[a.get("parkId")].append(a)
    uit = {}
    for item in vr:
        kern = volle_sleutel(kern_van_vr(item["naam"]))
        doel = None
        if len(kern) >= 4:
            kandidaten = per_park.get(item.get("parkId"), []) if item.get("parkId") else []
            if not kandidaten and item.get("lat") is not None:
                kandidaten = [a for a in alle if a.get("lat") is not None
                              and afstand(item["lat"], item["lon"], a["lat"], a["lon"]) <= KOPPEL_AFSTAND_NAAM]
            passend = []
            for a in kandidaten:
                k = volle_sleutel(a["naam"])
                if a["id"] != item["id"] and not VR.search(a["naam"]) and len(k) >= 4 and (k.startswith(kern) or kern.startswith(k)):
                    passend.append(a)
            passend.sort(key=lambda a: (a.get("status") != "open", len(a["naam"])))
            doel = passend[0] if passend else None
        if doel:
            uit[item["id"]] = doel["id"]
            tel["vr_samengevoegd"] += 1
            print(f"  VR-versie {item['naam']} ({item['id']}) hoort bij {doel['naam']} ({doel['id']})")
        else:
            tel["vr_weg"] += 1
            WEGGELATEN.append(("VR-versie zonder echte baan", item["naam"], item.get("park") if isinstance(item.get("park"), str) else None, item["id"]))
            print(f"  VR-versie {item['naam']} ({item['id']}) zonder bijpassende baan: weggelaten")
    return uit


def zoek_dubbel_extra(alle, extra, tel):
    """Staat een achtbaan uit extra.json inmiddels in Wikidata of OSM? Dan wordt de
    regel in extra.json een verwijzing naar die achtbaan (je ritten blijven gelden)."""
    index = defaultdict(list)
    for a in alle:
        for n in a.get("_namen") or {a["naam"]}:
            for k in naam_sleutels(n):
                index[k].append(a)
    aliassen = {}
    for x in extra:
        if not x.get("id") or not x.get("naam"):
            continue
        for a in {id(a): a for k in naam_sleutels(x["naam"]) for a in index.get(k, [])}.values():
            dichtbij = (x.get("lat") is not None and a.get("lat") is not None
                        and afstand(x["lat"], x["lon"], a["lat"], a["lon"]) <= KOPPEL_AFSTAND)
            zelfde = bool(x.get("park") and a.get("park") and naam_sleutels(x["park"]) & naam_sleutels(a["park"]))
            if dichtbij or zelfde:
                aliassen[x["id"]] = a["id"]
                tel["dubbel_met_extra"] += 1
                print(f"  extra.json: {x['id']} ({x['naam']}) staat nu ook in de bronnen als {a['id']}")
                break
    return aliassen


# ---------------------------------------------------------------------------
# Wikipedia: het informatieblok van het artikel (Engels, Nederlands, Duits)
# ---------------------------------------------------------------------------

WP_TALEN = ("en", "nl", "de")


def oude_waarden(a, bron):
    """De waarden van de vorige keer die uit deze bron kwamen (als die bron nu niet lukt)."""
    if a.get("bron"):
        return {v: a[v] for v, b in a["bron"].items() if b == bron and v in FEITEN and a.get(v) is not None}
    if bron != "osm":
        return {}
    # Ouder bestand zonder bronnen: alleen wat niet de standaardwaarde is
    uit = {v: a.get(v) for v in ("hoogte", "lengte", "geopend", "fabrikant", "type", "status") if a.get(v) is not None}
    if uit.get("type") == "Achtbaan":
        del uit["type"]
    if uit.get("status") == "open":
        del uit["status"]
    return uit


def lees_wikipedia(alle, artikelen, vorige_per_id, tel):
    """Zet per baan de waarden uit het informatieblok in a['_w']['wp:<taal>']. Per taal
    één verzoek per 50 artikelen, en alleen het begin van het artikel (daar staat het blok)."""
    print("Wikipedia: informatieblokken lezen…")
    per_taal = defaultdict(lambda: defaultdict(list))
    for a in alle:
        titels = (artikelen or {}).get(a["id"], {})
        links = {t: titels[t] for t in WP_TALEN if titels.get(t)}
        if links:
            a["wp"] = links
        for taal, titel in links.items():
            per_taal[taal][titel].append(a)
    gelukt = set()
    for taal in WP_TALEN:
        titels = per_taal.get(taal, {})
        if artikelen is None:
            break
        try:
            for i, stuk in enumerate(in_stukjes(sorted(titels), 50), 1):
                data = mediawiki(f"https://{taal}.wikipedia.org/w/api.php", {
                    "action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                    "rvsection": "0", "redirects": "1", "titles": "|".join(stuk),
                })
                query = data.get("query", {})
                terug = {t: t for t in stuk}
                for soort in ("normalized", "redirects"):
                    for n in query.get(soort, []):
                        terug[n["to"]] = terug.get(n["from"], n["from"])
                for pagina in query.get("pages", []):
                    rev = (pagina.get("revisions") or [{}])[0]
                    tekst = ((rev.get("slots") or {}).get("main") or {}).get("content") or ""
                    for a in titels.get(terug.get(pagina.get("title"), pagina.get("title")), []):
                        info = wp.lees_infobox(tekst, taal, [a.get("park")] if a.get("park") else [])
                        if info:
                            a["_w"][f"wp:{taal}"] = info
                            tel[f"wp_{taal}_infobox"] += 1
                time.sleep(1)
            gelukt.add(taal)
            print(f"  {taal}: {len(titels)} artikelen, {tel[f'wp_{taal}_infobox']} met een informatieblok")
        except Exception as e:  # noqa: BLE001
            print(f"  Wikipedia ({taal}) lukt niet: {e}. De waarden van de vorige keer blijven.")
    for taal in WP_TALEN:
        if taal in gelukt:
            continue
        for a in alle:
            oud = oude_waarden(vorige_per_id.get(a["id"], {}), f"wp:{taal}")
            if oud and "_w" in a:
                a["_w"][f"wp:{taal}"] = oud
                if vorige_per_id[a["id"]].get("wp"):
                    a.setdefault("wp", vorige_per_id[a["id"]]["wp"])


def wp_volgorde(land):
    """Welke Wikipedia eerst: bij een Nederlandse of Belgische baan de Nederlandse, enzovoort."""
    if land in ("Nederland", "België"):
        return ("nl", "en", "de")
    if land in ("Duitsland", "Oostenrijk", "Zwitserland"):
        return ("de", "en", "nl")
    return ("en", "nl", "de")


def maak_park_index(alle):
    """Parknaam -> (naam, parkId), alleen als de naam maar bij één park hoort."""
    index = {}
    for a in alle:
        if a.get("park") and a.get("parkId"):
            k = norm.sleutel(a["park"])
            if k in index and index[k] and index[k][1] != a["parkId"]:
                index[k] = None
            elif k not in index:
                index[k] = (a["park"], a["parkId"])
    return {k: v for k, v in index.items() if v}


def kies_waarden(a, park_index, tel):
    """Per veld de waarde van de eerste bron die er een heeft: Wikidata, dan Wikipedia,
    dan OpenStreetMap. Onmogelijke waarden vallen weg. In a['bron'] staat per veld waar
    de waarde vandaan komt. (Jouw eigen aanvullingen legt de site er nog overheen.)"""
    w = a.pop("_w", None)
    if w is None:
        return  # al eerder gekozen, bijvoorbeeld een baan van de vorige keer
    dit_jaar = datetime.date.today().year
    volgorde = ["wd"] + [f"wp:{t}" for t in wp_volgorde(a.get("land"))] + ["osm"]
    bronnen = [(b, w[b]) for b in volgorde if w.get(b)]
    bron = {}
    for veld in FEITEN:
        a.pop(veld, None)
    a["naam"] = norm.naam(a["naam"], a.get("park"))[0]
    if a.get("land"):
        a["land"] = norm.land(a["land"])

    for veld in ("hoogte", "valhoogte", "lengte", "snelheid", "inversies", "duur"):
        for b, waarden in bronnen:
            if waarden.get(veld) is None:
                continue
            n = norm.getal(veld, waarden[veld])
            if n is None:
                tel[f"afgekeurd_{veld}"] += 1
                continue
            a[veld], bron[veld] = n, b
            break
    for veld in ("geopend", "gesloten"):
        for b, waarden in bronnen:
            j = norm.jaar(veld, waarden.get(veld))
            if j:
                a[veld], bron[veld] = j, b
                break
    for b, waarden in bronnen:
        if waarden.get("status"):
            a["status"], bron["status"] = waarden["status"], b
            break
    else:
        if a.get("gesloten"):
            a["status"], bron["status"] = "gesloten", bron["gesloten"]
        elif a.get("geopend") and a["geopend"] > dit_jaar:
            a["status"], bron["status"] = "gepland", bron["geopend"]
        else:
            a["status"] = "open"
    if a["status"] == "open" and a.get("gesloten"):
        # Een sluiting bij een open baan hoort bij een oude naam of een oud spoor
        a.pop("gesloten")
        bron.pop("gesloten", None)
    for b, waarden in bronnen:
        f = norm.fabrikant(waarden.get("fabrikant"))
        if f:
            a["fabrikant"], bron["fabrikant"] = f, b
            break
    for b, waarden in bronnen:
        m = re.sub(r"\s+", " ", str(waarden.get("model") or "")).strip()
        if m:
            a["model"], bron["model"] = m[:80], b
            break
    teksten = [(b, waarden["type"]) for b, waarden in bronnen if waarden.get("type")]
    teksten += [(b, waarden["model"]) for b, waarden in bronnen if waarden.get("model")]
    a["type"], b = norm.kies_type(teksten)
    if b:
        bron["type"] = b
    for veld in norm.samen_onmogelijk(a):
        a.pop(veld, None)
        bron.pop(veld, None)
        tel[f"afgekeurd_{veld}"] += 1

    # Geen park uit Wikidata of OpenStreetMap? Dan uit Wikipedia: met de code van een bekend
    # park als de naam overeenkomt, anders alleen de naam.
    if not a.get("park"):
        for b, waarden in bronnen:
            if b.startswith("wp:") and waarden.get("park") and len(waarden["park"]) <= 80:
                p = park_index.get(norm.sleutel(waarden["park"]))
                a["park"], a["parkId"] = p if p else (waarden["park"], None)
                if not a["parkId"]:
                    del a["parkId"]
                bron["park"] = b
                tel["park_uit_wikipedia"] += 1
                break
    if a.get("park"):
        bron.setdefault("park", a.pop("_park_bron", None) or ("osm" if str(a.get("parkId", "")).startswith("osm-") else "wd"))
    if a.get("land"):
        bron["land"] = a.pop("_land_bron", None) or ("wd" if "wd" in w else "osm")

    # Vorige parken (verhuisde banen): Wikidata, anders Wikipedia
    vorige = a.pop("_vorige", None)
    if not vorige:
        for b, waarden in bronnen:
            if b.startswith("wp:") and waarden.get("vorigeParken"):
                vorige = []
                for v in waarden["vorigeParken"]:
                    p = park_index.get(norm.sleutel(v["park"]))
                    vorige.append({"park": p[0] if p else v["park"], "parkId": p[1] if p else None, "van": v.get("van"), "tot": v.get("tot")})
                bron["vorigeParken"] = b
                break
    elif "wd" in w:
        bron["vorigeParken"] = "wd"
    if vorige:
        a["vorigeParken"] = [{k: v for k, v in x.items() if v} for x in vorige
                             if x.get("park") and x.get("parkId") != a.get("parkId")] or None
        if not a["vorigeParken"]:
            del a["vorigeParken"]
            bron.pop("vorigeParken", None)
    for b in bron.values():
        tel[f"bron_{b}"] += 1
    a["bron"] = bron


def voeg_parken_samen(alle, tel):
    """Hetzelfde park met twee codes (Wikidata en OpenStreetMap, of twee keer OSM) wordt één
    park: met de Wikidata-code en -naam als die er is. Alleen als de banen dicht bij elkaar
    liggen; 'Disneyland Park' in Anaheim en in Parijs blijven dus twee parken.
    Geeft {oude parkId: nieuwe parkId}, zodat oude links blijven werken."""
    per_park = defaultdict(list)
    for a in alle:
        if a.get("parkId") and a.get("park"):
            per_park[a["parkId"]].append(a)
    info = []
    for pid, banen in per_park.items():
        met = [b for b in banen if b.get("lat") is not None]
        info.append({
            "id": pid, "naam": banen[0]["park"], "n": len(banen),
            "lat": sum(b["lat"] for b in met) / len(met) if met else None,
            "lon": sum(b["lon"] for b in met) / len(met) if met else None,
        })
    per_naam = defaultdict(list)
    for p in info:
        per_naam[norm.sleutel(p["naam"])].append(p)
    vervang = {}
    for lijst in per_naam.values():
        if len(lijst) < 2:
            continue
        lijst.sort(key=lambda p: (not p["id"].startswith("Q"), -p["n"], p["id"]))
        for i, houd in enumerate(lijst):
            if houd["id"] in vervang:
                continue
            for p in lijst[i + 1:]:
                if p["id"] in vervang or p["id"].startswith("Q") or houd["lat"] is None or p["lat"] is None:
                    continue  # twee Wikidata-parken met dezelfde naam blijven apart
                if afstand(houd["lat"], houd["lon"], p["lat"], p["lon"]) <= 3000:
                    vervang[p["id"]] = houd
    for a in alle:
        p = vervang.get(a.get("parkId"))
        if p:
            a["parkId"], a["park"] = p["id"], p["naam"]
            tel["banen_in_samengevoegd_park"] += 1
    for oud in vervang:
        print(f"  park {oud} hoort bij {vervang[oud]['naam']} ({vervang[oud]['id']})")
    tel["parken_samengevoegd"] = len(vervang)
    # Ook elk park één naam: de naam die het vaakst voorkomt
    per_id = defaultdict(lambda: defaultdict(int))
    for a in alle:
        if a.get("parkId") and a.get("park"):
            per_id[a["parkId"]][a["park"]] += 1
    for a in alle:
        namen = per_id.get(a.get("parkId"))
        if namen:
            a["park"] = max(namen.items(), key=lambda x: (x[1], x[0]))[0]
    return {oud: p["id"] for oud, p in vervang.items()}


ALGEMENE_NAAM = {"achtbaan", "rollercoaster", "coaster", "kiddiecoaster", "familycoaster", "kinderachtbaan",
                 "juniorcoaster", "familieachtbaan", "achterbahn", "kinderachterbahn", "minicoaster"}


def plek_bij_park(alle, tel):
    """Land en plek die bij het park passen. Een baan die verhuisd is, heeft in Wikidata vaak
    het oude én het nieuwe land en de oude én de nieuwe plek. Alleen als de meeste andere banen
    van hetzelfde park het eens zijn (minstens twee en meer dan de helft: zelfde land, binnen 15 km):
    - de plek van de baan die het dichtst bij die banen ligt (uit de eigen plekken in Wikidata);
    - het land van het park, als dat een van de eigen landen is, of als de baan zelf in het
      park ligt (dan klopt het land in Wikidata niet).
    Ligt de baan ver weg en noemt hij een ander land, dan kan ook het park fout zijn: dan
    verandert er niets en telt hij als twijfel in het rapport."""
    per_park = defaultdict(list)
    for a in alle:
        if a.get("parkId"):
            per_park[a["parkId"]].append(a)
    for banen in per_park.values():
        if len(banen) < 3:
            continue
        for a in banen:
            anderen = [b for b in banen if b is not a and not b.get("_punten") and not b.get("_landen")]
            # Het park: waar de meeste andere banen liggen (minstens twee, en meer dan de helft)
            plekken = [(b["lat"], b["lon"]) for b in anderen if b.get("lat") is not None]
            midden = None
            if len(plekken) >= 2:
                mediaan = lambda ps: (sorted(p[0] for p in ps)[len(ps) // 2], sorted(p[1] for p in ps)[len(ps) // 2])
                m = mediaan(plekken)
                dichtbij = [p for p in plekken if afstand(*p, *m) <= 15_000]
                if len(dichtbij) >= 2 and 2 * len(dichtbij) > len(plekken):
                    midden = mediaan(dichtbij)
            if midden:
                eigen = a.get("_punten") or ([(a["lat"], a["lon"])] if a.get("lat") is not None else [])
                beste = min(eigen, key=lambda p: afstand(*p, *midden), default=None)
                nu_ver = a.get("lat") is None or afstand(a["lat"], a["lon"], *midden) > 15_000
                if beste and nu_ver and afstand(*beste, *midden) <= 15_000:
                    a["lat"], a["lon"] = beste
                    tel["plek_bij_park"] += 1
            ver = midden is not None and a.get("lat") is not None and afstand(a["lat"], a["lon"], *midden) > 15_000
            telling = Counter(b["land"] for b in anderen if b.get("land"))
            park_land, n = telling.most_common(1)[0] if telling else (None, 0)
            if n < 2 or 2 * n <= sum(telling.values()):
                tel["plek_twijfel"] += ver
                continue
            if a.get("land") == park_land:
                tel["plek_twijfel"] += ver
                continue
            in_park = midden is not None and a.get("lat") is not None and afstand(a["lat"], a["lon"], *midden) <= 15_000
            if park_land in (a.get("_landen") or []) or in_park:
                if a.get("_land_beslist") and park_land not in (a.get("_landen") or []):
                    continue  # het land van het park in Wikidata gaat voor
                a["land"] = park_land
                a["_land_beslist"] = True
                a.setdefault("bron", {})["land"] = "park"
                tel["land_bij_park"] += 1
            elif a.get("land"):
                tel["plek_twijfel"] += 1
    # Nog meer landen en niets dat beslist: het land van de banen bij de plek van deze baan
    rooster = defaultdict(list)
    for b in alle:
        if b.get("land") and b.get("lat") is not None and not b.get("_landen"):
            rooster[(int(b["lat"] * 2), int(b["lon"] * 2))].append(b)
    for a in alle:
        if a.get("_landen") and not a.get("_land_beslist") and a.get("lat") is not None:
            vak = (int(a["lat"] * 2), int(a["lon"] * 2))
            buren = Counter(b["land"] for di in (-1, 0, 1) for dj in (-1, 0, 1) for b in rooster.get((vak[0] + di, vak[1] + dj), [])
                            if b["land"] in a["_landen"] and afstand(a["lat"], a["lon"], b["lat"], b["lon"]) <= 40_000)
            if buren:
                a["land"] = buren.most_common(1)[0][0]
                tel["land_bij_plek"] += 1
    for a in alle:
        a.pop("_punten", None)
        a.pop("_landen", None)
        a.pop("_land_beslist", None)


def land_uit_plek(alle, tel):
    """Banen zonder land (vooral uit OpenStreetMap): het land van een andere baan in hetzelfde
    park, of anders het land van de banen in de buurt: minstens twee bekende banen binnen 40 km,
    allemaal in hetzelfde land. Zo wordt er bij een grens niets gegokt."""
    met = [a for a in alle if a.get("land")]
    per_park = defaultdict(Counter)
    for a in met:
        if a.get("park"):
            per_park[a.get("parkId") or a["park"]][a["land"]] += 1
    rooster = defaultdict(list)  # vakjes van een halve graad, zodat het snel blijft
    for a in met:
        if a.get("lat") is not None and a.get("lon") is not None:
            rooster[(int(a["lat"] * 2), int(a["lon"] * 2))].append(a)
    for a in alle:
        if a.get("land"):
            continue
        park = per_park.get(a.get("parkId") or a.get("park") or "")
        if park and len(park) == 1:
            a["land"] = next(iter(park))
        elif a.get("lat") is not None and a.get("lon") is not None:
            vak = (int(a["lat"] * 2), int(a["lon"] * 2))
            buren = [b["land"] for di in (-1, 0, 1) for dj in (-1, 0, 1) for b in rooster.get((vak[0] + di, vak[1] + dj), [])
                     if afstand(a["lat"], a["lon"], b["lat"], b["lon"]) <= 40_000]
            if len(buren) < 2 or len(set(buren)) != 1:
                continue  # niemand in de buurt, of maar één baan (die zelf fout kan zijn), of een grens
            a["land"] = buren[0]
        else:
            continue
        a.setdefault("bron", {})["land"] = "plek"
        tel["land_uit_plek"] += 1


def voeg_dubbele_banen_samen(alle, niet, tel):
    """Twee keer dezelfde baan in hetzelfde park (zelfde naam), bijvoorbeeld een Wikidata-item
    en een OSM-object die niet aan elkaar gekoppeld waren, of twee Wikidata-items. De baan
    met de meeste gegevens blijft; de andere wordt een verwijzing (credits blijven gelden).
    Niet samen: banen met een algemene naam, of waarvan de jaartallen niet passen
    (een oude en een nieuwe baan met dezelfde naam)."""
    per = defaultdict(list)
    for a in alle:
        k = norm.sleutel(a["naam"])
        if a.get("parkId") and len(k) >= 4 and k not in ALGEMENE_NAAM and a["id"] not in niet:
            per[(a["parkId"], k)].append(a)

    def botst(x, y):
        if x.get("geopend") and y.get("geopend") and abs(x["geopend"] - y["geopend"]) > 1:
            return True
        if {x.get("status"), y.get("status")} == {"open", "gesloten"}:
            return True
        return False

    weg = {}
    for banen in per.values():
        if len(banen) < 2:
            continue
        banen.sort(key=lambda a: (not a["id"].startswith("Q"), -len([v for v in a.values() if v is not None]),
                                  int(a["id"][1:]) if re.fullmatch(r"Q\d+", a["id"]) else 0))
        houd = banen[0]
        for b in banen[1:]:
            if botst(houd, b):
                continue
            for veld, waarde in b.items():
                if veld != "id" and houd.get(veld) is None and waarde is not None:
                    houd[veld] = waarde
                    if veld in FEITEN and b.get("bron", {}).get(veld):
                        houd.setdefault("bron", {})[veld] = b["bron"][veld]
            weg[b["id"]] = houd["id"]
            print(f"  dubbel: {b['naam']} ({b['id']}) is dezelfde baan als {houd['id']}")
    alle[:] = [a for a in alle if a["id"] not in weg]
    tel["banen_dubbel_samengevoegd"] = len(weg)
    return weg


# ---------------------------------------------------------------------------
# Foto's: alleen vrij gelicenseerde bestanden op Wikimedia Commons
# ---------------------------------------------------------------------------
# Volgorde per achtbaan:
#   1. Wikidata P18
#   2. een geschikte foto uit de Commons-categorie (Wikidata P373)
#   3. de vrij gelicenseerde hoofdafbeelding van het Wikipedia-artikel
#   4. de image- of wikimedia_commons-tag uit OpenStreetMap
#   5. een foto op Commons met de naam van de baan én van het park in de bestandsnaam
# Elk bestand wordt bij Commons gecontroleerd: het moet er echt staan en een vrije
# licentie hebben. Een liggende foto van de baan gaat voor (zie foto_oordeel).
# Bewaard worden de bestandsnaam, de maker en de licentie.
# Je eigen foto (in data/fotos.json) gaat op de site altijd voor.

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIPEDIA_TALEN = ["nl", "en", "de", "fr", "es", "it", "pl", "sv", "pt", "ja", "zh"]


def mediawiki(url, params, pogingen=4):
    """Vraag aan een MediaWiki-API (Commons, Wikipedia), met wachten bij drukte."""
    body = urllib.parse.urlencode({"format": "json", "formatversion": "2", "maxlag": "5", **params}).encode()
    for poging in range(pogingen):
        try:
            verzoek = urllib.request.Request(url, data=body, headers={
                "User-Agent": USER_AGENT, "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            })
            with urllib.request.urlopen(verzoek, timeout=60) as antwoord:
                data = json.load(antwoord)
            fout = data.get("error") or {}
            if fout.get("code") == "maxlag" and poging < pogingen - 1:
                time.sleep(5 * (poging + 1))
                continue
            if fout:
                raise ValueError(fout.get("info") or fout.get("code"))
            return data
        except urllib.error.HTTPError as fout:
            if fout.code in (429, 500, 502, 503, 504) and poging < pogingen - 1:
                time.sleep(int(fout.headers.get("Retry-After") or 0) or 10 * (poging + 1))
                continue
            raise
        except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError):
            if poging < pogingen - 1:
                time.sleep(5 * (poging + 1))
                continue
            raise
    raise RuntimeError(f"{url} gaf geen antwoord")


def nette_bestandsnaam(naam):
    naam = re.split(r"[?#]", naam, maxsplit=1)[0].replace("_", " ").strip()
    return naam[:1].upper() + naam[1:] if naam else None


def commons_bestand(waarde):
    """Bestandsnaam op Commons uit een OSM-tag of link; None als het geen Commons-bestand is
    (een foto op een andere site heeft geen bekende vrije licentie en wordt niet gebruikt)."""
    s = urllib.parse.unquote(str(waarde or "").strip())
    for patroon in (
        r"https?://commons\.(?:m\.)?wikimedia\.org/wiki/(?:File|Image|Bestand|Datei|Fichier):(.+)$",
        r"https?://upload\.wikimedia\.org/wikipedia/commons/(?:thumb/)?[0-9a-f]/[0-9a-f]{2}/([^/]+)",
        r"https?://commons\.wikimedia\.org/wiki/Special:FilePath/(.+)$",
        r"(?:File|Image|Bestand|Datei):(.+)$",
    ):
        m = re.match(patroon, s, re.I)
        if m:
            return nette_bestandsnaam(m.group(1))
    return None


def commons_categorie(waarde):
    s = urllib.parse.unquote(str(waarde or "").strip())
    m = re.match(r"(?:https?://commons\.(?:m\.)?wikimedia\.org/wiki/)?Category:(.+)$", s, re.I)
    return nette_bestandsnaam(m.group(1)) if m else None


def osm_fotos(groep):
    uit = []
    for o in groep:
        for sleutel in ("wikimedia_commons", "image"):
            for deel in (o["tags"].get(sleutel) or "").split(";"):
                bestand, categorie = commons_bestand(deel), commons_categorie(deel)
                if bestand:
                    uit.append(("bestand", bestand))
                elif categorie:
                    uit.append(("categorie", categorie))
    return uit


def haal_wd_fotobronnen(qids):
    """Commons-categorie (P373) en Wikipedia-artikelen van achtbanen zonder P18."""
    categorieen, artikelen = {}, defaultdict(dict)
    wikis = ", ".join(f"<https://{t}.wikipedia.org/>" for t in WIKIPEDIA_TALEN)
    # Twee eenvoudige vragen in plaats van één met UNION: die laatste liep bij
    # Wikidata v1 steeds vast (HTTP 504).
    vragen = [
        "SELECT ?item ?cat WHERE {{ VALUES ?item {{ {w} }} ?item wdt:P373 ?cat . }}",
        "SELECT ?item ?artikel WHERE {{ VALUES ?item {{ {w} }} ?artikel schema:about ?item ; schema:isPartOf ?wiki . "
        "FILTER(?wiki IN (" + wikis.replace("{", "{{").replace("}", "}}") + ")) }}",
    ]
    for stuk in in_stukjes(sorted(qids), 300):
        waarden = " ".join(f"wd:{q}" for q in stuk)
        rijen = []
        for sjabloon in vragen:
            rijen += vraag(PREFIXEN + sjabloon.format(w=waarden))
            time.sleep(1)
        for rij in rijen:
            q = qid(waarde(rij, "item"))
            if not q:
                continue
            if waarde(rij, "cat"):
                categorieen.setdefault(q, waarde(rij, "cat"))
            url = waarde(rij, "artikel")
            if url and "/wiki/" in url:
                taal = urllib.parse.urlparse(url).netloc.split(".")[0]
                artikelen[q][taal] = urllib.parse.unquote(url.split("/wiki/", 1)[1]).replace("_", " ")
        time.sleep(1)
    return categorieen, artikelen


def wikipedia_fotos(artikelen):
    """Hoofdafbeelding van het artikel, alleen als die vrij gelicenseerd is (pilicense=free)."""
    per_taal = defaultdict(lambda: defaultdict(list))
    for q, titels in artikelen.items():
        for taal, titel in titels.items():
            per_taal[taal][titel].append(q)
    gevonden = defaultdict(dict)
    for taal, titels in per_taal.items():
        for stuk in in_stukjes(sorted(titels), 50):
            data = mediawiki(f"https://{taal}.wikipedia.org/w/api.php", {
                "action": "query", "prop": "pageimages", "piprop": "name", "pilicense": "free",
                "redirects": "1", "titles": "|".join(stuk),
            })
            query = data.get("query", {})
            terug = {s: s for s in stuk}
            for soort in ("normalized", "redirects"):
                for n in query.get(soort, []):
                    terug[n["to"]] = terug.get(n["from"], n["from"])
            for pagina in query.get("pages", []):
                if pagina.get("pageimage"):
                    for q in titels.get(terug.get(pagina["title"], pagina["title"]), []):
                        gevonden[q][taal] = nette_bestandsnaam(pagina["pageimage"])
            time.sleep(0.5)
    return {q: [per[t] for t in WIKIPEDIA_TALEN if t in per] for q, per in gevonden.items()}


# Een foto moet een vrije licentie hebben en echt op Commons staan. Daarna:
#   beste keus (2):  een liggende foto van de baan, groot genoeg
#   tweede keus (1): staand, klein, of van de bouw, het station of de trein
#   afgekeurd (0):   logo, plattegrond, bord, ingang, model, schermafbeelding, ...
GEEN_FOTO = {
    "logo", "logos", "logotype", "map", "maps", "kaart", "karte", "plan", "plattegrond", "lageplan", "diagram",
    "schema", "layout", "sign", "signs", "signage", "bord", "schild", "poster", "flyer", "ticket", "lego", "model",
    "modell", "miniature", "miniatuur", "minecraft", "render", "rendering", "icon", "stamp", "coin", "flag",
    "screenshot", "entrance", "entree", "ingang", "eingang", "gate", "souvenir", "badge", "emblem", "wappen", "seal",
    "brochure", "advert", "advertisement", "drawing", "tekening", "zeichnung", "blueprint", "track_layout", "trackmap",
    "food", "restaurant", "snack", "snackbar", "shop", "store", "winkel", "kiosk", "toilet", "toilets", "toiletten",
    "menu", "bench", "plaque", "gedenkplaat", "museum", "exhibit", "tentoonstelling", "statue", "beeld", "selfie",
}
TWEEDE_KEUS = {
    "construction", "bau", "baustelle", "aanbouw", "bouw", "station", "queue", "wachtrij", "warteschlange",
    "train", "trein", "zug", "wagon", "wagen", "car", "cars", "night", "nacht", "pov", "onride", "on-ride",
}
GOEDE_MIME = {"image/jpeg", "image/webp", "image/tiff", "image/png"}  # png: alleen als tweede keus
TWEEDE_ZINNEN = re.compile(r"on[ _-]?ride|point[ _-]of[ _-]view|\bpov\b|overview|aerial|luchtfoto", re.I)
NIET_VRIJ = re.compile(r"non[- ]?free|fair[ _-]?use|all rights reserved", re.I)
FOTO_IIPROP = {"iiprop": "size|mime|extmetadata", "iiextmetadatafilter": "LicenseShortName|License|UsageTerms|NonFree|Artist"}


def platte_tekst(html_tekst):
    t = re.sub(r"<[^>]+>", "", str(html_tekst or ""))
    t = re.sub(r"\s+", " ", html.unescape(t)).strip()
    return t


def foto_info(pagina):
    """Wat we van een Commons-bestand willen weten (uit imageinfo en coordinates)."""
    if pagina.get("missing") or pagina.get("invalid"):
        return None
    ii = (pagina.get("imageinfo") or [{}])[0]
    meta = ii.get("extmetadata") or {}
    licentie = " ".join(str((meta.get(k) or {}).get("value") or "") for k in ("LicenseShortName", "License", "UsageTerms"))
    niet_vrij = str((meta.get("NonFree") or {}).get("value") or "").strip().lower() in ("true", "1", "yes")
    plek = (pagina.get("coordinates") or [{}])[0]
    return {
        "breed": ii.get("width") or 0, "hoog": ii.get("height") or 0, "mime": ii.get("mime") or "",
        "vrij": bool(licentie.strip()) and not niet_vrij and not NIET_VRIJ.search(licentie),
        "licentie": platte_tekst((meta.get("LicenseShortName") or {}).get("value"))[:40],
        "maker": platte_tekst((meta.get("Artist") or {}).get("value"))[:80],
        "lat": plek.get("lat"), "lon": plek.get("lon"),
    }


def foto_oordeel(bestand, info, naam=None):
    """2 = beste keus, 1 = tweede keus, 0 = niet gebruiken. Woorden uit de naam van de baan
    (en het park) tellen niet als afkeurwoord: "Freedom Flyer.jpg" is geen folder."""
    if not info or not info["vrij"] or info["mime"] not in GOEDE_MIME:
        return 0
    eigen = set(re.split(r"[\W_]+", str(naam or "").casefold()))
    woorden_ = set(re.split(r"[\W_]+", bestand.casefold())) - eigen
    if woorden_ & GEEN_FOTO:
        return 0
    b, h = info["breed"], info["hoog"]
    if b < 280 or h < 180:
        return 0
    tweede = (woorden_ & TWEEDE_KEUS or TWEEDE_ZINNEN.search(bestand) or info["mime"] == "image/png"
              or b < 800 or h < 450 or not 1.2 <= b / h <= 2.4)
    return 1 if tweede else 2


def haal_foto_info(bestanden, cache):
    """imageinfo (licentie, maker, grootte) en de plek van de camera, per 50 bestanden."""
    nieuw = sorted(b for b in bestanden if b not in cache)
    for stuk in in_stukjes(nieuw, 50):
        data = mediawiki(COMMONS_API, {
            "action": "query", "prop": "imageinfo|coordinates", **FOTO_IIPROP,
            "titles": "|".join(f"File:{b}" for b in stuk),
        })
        query = data.get("query", {})
        terug = {f"File:{b}": b for b in stuk}
        for n in query.get("normalized", []):
            terug[n["to"]] = terug.get(n["from"])
        for b in stuk:
            cache.setdefault(b, None)
        for pagina in query.get("pages", []):
            b = terug.get(pagina.get("title"))
            if b:
                cache[b] = foto_info(pagina)
        time.sleep(0.5)


def beste_uit_pagina_lijst(paginas, cache, past=lambda titel, info: True, naam=None):
    """De beste foto uit een lijst Commons-pagina's (categorie of zoekresultaat): eerst het
    oordeel, dan een foto met de naam van de baan in de bestandsnaam, dan de grootte."""
    sleutel_naam = volle_sleutel(naam) if naam else ""
    beste = None
    for pagina in paginas:
        titel = pagina.get("title", "").split(":", 1)[-1]
        info = foto_info(pagina)
        if not titel or not info:
            continue
        cache[titel] = info
        oordeel = foto_oordeel(titel, info, naam)
        if oordeel and past(titel, info):
            met_naam = bool(sleutel_naam) and sleutel_naam in volle_sleutel(titel)
            score = (oordeel, met_naam, min(info["breed"] * info["hoog"], 12_000_000), titel)
            if beste is None or score > beste[0]:
                beste = (score, titel)
    return beste[1] if beste else None


def foto_uit_categorie(categorie, cache, naam=None):
    data = mediawiki(COMMONS_API, {
        "action": "query", "generator": "categorymembers", "gcmtitle": f"Category:{categorie}",
        "gcmtype": "file", "gcmlimit": "100", "prop": "imageinfo|coordinates", **FOTO_IIPROP,
    })
    return beste_uit_pagina_lijst(data.get("query", {}).get("pages", []), cache, naam=naam)


PARK_ALGEMEEN = {
    "park", "parc", "parque", "parco", "freizeitpark", "attractiepark", "pretpark", "themepark", "theme",
    "amusement", "resort", "world", "land", "the", "fun", "family", "adventure", "adventures", "kingdom",
    "erlebnispark", "lunapark", "luna", "parks", "flags", "studios", "town", "city", "village", "garden", "gardens",
}
# Namen die bij veel banen voorkomen: daarop zoeken geeft geen zekerheid
ALGEMENE_FOTONAAM = {
    "boomerang", "wackyworm", "bigapple", "kiddiecoaster", "familycoaster", "juniorcoaster", "minicoaster",
    "dragon", "drachen", "rollercoaster", "achtbaan", "achterbahn", "wildmouse", "wildemaus", "crazymouse",
    "tivoli", "zyklon", "jetstar", "galaxi", "looping", "loopingstar", "wildcat", "rollercoasterride", "coaster",
}
ZOEK_TOTAAL = 12 * 60  # seconden: zoeken op Commons stopt daarna, de rest volgende keer


def woorden(tekst):
    s = unicodedata.normalize("NFKD", str(tekst or "")).casefold()
    return re.findall(r"\w+", "".join(c for c in s if not unicodedata.combining(c)))


def foto_via_zoeken(a, cache):
    """Zoekt op Commons naar een foto van deze baan, alleen als het zeker om deze baan gaat:
    de naam van de baan moet in de bestandsnaam staan, én de naam van het park of een
    cameraplek binnen een kilometer. Een cameraplek verder dan twee kilometer weg telt
    niet, ook als de naam klopt."""
    naam = volle_sleutel(a["naam"])
    park = [w for w in woorden(a.get("park")) if len(w) >= 4 and w not in PARK_ALGEMEEN]
    if len(naam) < 4 or naam in ALGEMENE_FOTONAAM or (not park and a.get("lat") is None):
        return None
    zoek = f'intitle:"{a["naam"].replace(chr(34), "")}"' + (f" {park[0]}" if park else "")
    data = mediawiki(COMMONS_API, {
        "action": "query", "generator": "search", "gsrnamespace": "6", "gsrsearch": zoek,
        "gsrlimit": "30", "prop": "imageinfo|coordinates", **FOTO_IIPROP,
    })

    def past(titel, info):
        sleutel = volle_sleutel(titel)
        if naam not in sleutel:
            return False
        if info.get("lat") is not None and a.get("lat") is not None:
            d = afstand(info["lat"], info["lon"], a["lat"], a["lon"])
            if d > 2000:
                return False
            if d <= 1000:
                return True
        return any(w in sleutel for w in park)

    return beste_uit_pagina_lijst(data.get("query", {}).get("pages", []), cache, past, a["naam"])


def zoek_fotos(alle, wd_ids, vorige_per_id, tel, categorieen=None, artikelen=None):
    """Per baan de beste vrije foto. Volgorde: Wikidata P18, de Commons-categorie,
    de hoofdafbeelding van het Wikipedia-artikel, de foto in OpenStreetMap, en als
    laatste zoeken op Commons. Een liggende foto van de baan gaat voor; een staande foto
    of een foto van de bouw alleen als er niets beters is. Je eigen foto (data/fotos.json)
    gaat op de site altijd voor."""
    print("Foto's zoeken…")
    cache = {}
    kandidaten = {a["id"]: [] for a in alle}  # (bron, bestand), in volgorde
    fout = categorieen is None or artikelen is None
    for a in alle:
        if a.get("foto"):
            kandidaten[a["id"]].append(("p18" if a["id"] in wd_ids else "vorige", a["foto"]))
    osm_bestanden = {a["id"]: [w for soort, w in a.get("_osm_fotos", []) if soort == "bestand"] for a in alle}
    namen = {a["id"]: f'{a["naam"]} {a.get("park") or ""}' for a in alle}
    baannaam = {a["id"]: a["naam"] for a in alle}

    def oordeel(aid):
        return max((foto_oordeel(b, cache.get(b), namen[aid]) for _, b in kandidaten[aid] + [("osm", f) for f in osm_bestanden[aid]]), default=0)

    try:
        haal_foto_info({b for lijst in kandidaten.values() for _, b in lijst} | {b for lijst in osm_bestanden.values() for b in lijst}, cache)
    except Exception as e:  # noqa: BLE001
        print(f"  Foto's niet te controleren: {e}")
        fout = True

    # Nog geen liggende foto: de Commons-categorie (uit Wikidata of OSM)

    def uit_categorie(aid, categorie, bron):
        nonlocal fout
        try:
            f = foto_uit_categorie(categorie, cache, baannaam.get(aid))
        except Exception as e:  # noqa: BLE001
            print(f"  categorie {categorie}: {e}")
            fout = True
            return
        if f:
            kandidaten[aid].append((bron, f))
        time.sleep(0.3)

    zoek_cat = [(a["id"], (categorieen or {}).get(a["id"])) for a in alle if oordeel(a["id"]) < 2]
    zoek_cat = [(aid, c) for aid, c in zoek_cat if c]
    print(f"  {len(zoek_cat)} banen zonder liggende foto met een Commons-categorie")
    for i, (aid, categorie) in enumerate(zoek_cat, 1):
        if i % 100 == 0:
            print(f"  categorieën {i}/{len(zoek_cat)}")
        uit_categorie(aid, categorie, "categorie")

    # De hoofdafbeelding van het Wikipedia-artikel
    nodig = {a["id"]: (artikelen or {}).get(a["id"]) for a in alle if oordeel(a["id"]) < 2 and (artikelen or {}).get(a["id"])}
    try:
        gevonden = wikipedia_fotos(nodig)
        haal_foto_info({f for lijst in gevonden.values() for f in lijst}, cache)
        for q, lijst in gevonden.items():
            kandidaten[q].extend(("wikipedia", f) for f in lijst)
    except Exception as e:  # noqa: BLE001
        print(f"  Wikipedia-afbeeldingen niet opgehaald: {e}")
        fout = True

    # De foto in OpenStreetMap, en anders de categorie die OSM noemt
    for a in alle:
        kandidaten[a["id"]].extend(("osm", f) for f in osm_bestanden[a["id"]])
    for a in alle:
        if oordeel(a["id"]) < 1:
            for soort, w in a.get("_osm_fotos", []):
                if soort == "categorie":
                    uit_categorie(a["id"], w, "osm")
                    break

    # Nog niets: Commons doorzoeken, alleen als het zeker om deze baan gaat
    zoeken = [a for a in alle if oordeel(a["id"]) < 1]
    print(f"  Commons doorzoeken voor {len(zoeken)} banen zonder foto…")
    begin = time.monotonic()
    for i, a in enumerate(zoeken, 1):
        if time.monotonic() - begin > ZOEK_TOTAAL:
            print(f"  zoeken gestopt na {i - 1} banen (tijd op); de rest volgt de volgende keer")
            tel["foto_zoeken_niet_af"] = len(zoeken) - (i - 1)
            break
        try:
            f = foto_via_zoeken(a, cache)
        except Exception as e:  # noqa: BLE001
            print(f"  zoeken naar {a['naam']}: {e}")
            fout = True
            continue
        if f:
            kandidaten[a["id"]].append(("zoeken", f))
        if i % 100 == 0:
            print(f"  gezocht {i}/{len(zoeken)}")
        time.sleep(0.2)

    # Kiezen: de eerste beste keus in de volgorde, anders de eerste tweede keus
    for a in alle:
        keuze = None
        for niveau in (2, 1):
            keuze = next(((bron, f) for bron, f in kandidaten[a["id"]] if foto_oordeel(f, cache.get(f), namen[a["id"]]) == niveau), None)
            if keuze:
                break
        oud = vorige_per_id.get(a["id"]) or {}
        if keuze:
            bron, f = keuze
            info = cache[f]
            a["foto"] = f
            a["fotoInfo"] = {k: v for k, v in {"maker": info["maker"] or None, "licentie": info["licentie"] or None, "bron": bron}.items() if v}
            tel[f"foto_{bron}"] += 1
            tel["foto_liggend" if foto_oordeel(f, info, namen[a["id"]]) == 2 else "foto_tweede_keus"] += 1
            continue
        a.pop("foto", None)
        a.pop("fotoInfo", None)
        if fout and oud.get("foto"):
            a["foto"] = oud["foto"]  # iets lukte niet: de foto van de vorige keer blijft
            tel["foto_niet_gecontroleerd"] += 1
            if oud.get("fotoInfo"):
                a["fotoInfo"] = oud["fotoInfo"]
            tel["foto_vorige"] += 1
    tel["foto_afgekeurd"] = sum(1 for b, i in cache.items() if foto_oordeel(b, i) == 0)


# ---------------------------------------------------------------------------
# Alles samen
# ---------------------------------------------------------------------------

def lees_json(pad):
    try:
        tekst = pad.read_text(encoding="utf-8")
        return json.loads(re.sub(r",(\s*[\]}])", r"\1", tekst))
    except (OSError, ValueError):
        return None


def supabase_codes():
    """Codes van alle achtbanen waar iemand (jij of een vriend) een rit op heeft in
    Supabase. Leest met de publieke sleutel uit config.js; die gegevens zijn openbaar.
    Lukt het niet, dan een lege lijst (en dan telt alleen gereden.json)."""
    try:
        tekst = (MAP / "config.js").read_text(encoding="utf-8")
    except OSError:
        return set()
    # Wat er achter .supabase.co staat (zoals /rest/v1/), telt niet mee
    url = re.search(r'supabaseUrl:\s*"\s*(https://[a-z0-9-]+\.supabase\.co)(?:/[^"]*)?\s*"', tekst)
    sleutel = re.search(r'supabaseSleutel:\s*"\s*([^"\s]+)\s*"', tekst)
    if not url or not sleutel:
        return set()
    if sleutel.group(1).startswith("sb_secret_"):
        print("  Let op: in config.js staat een GEHEIME Supabase-sleutel. Haal hem weg en maak een nieuwe!")
        return set()
    codes, van = set(), 0
    try:
        while True:
            adres = f"{url.group(1)}/rest/v1/ritten?select=achtbaan&order=id&limit=1000&offset={van}"
            verzoek = urllib.request.Request(adres, headers={
                "apikey": sleutel.group(1), "Accept": "application/json", "User-Agent": USER_AGENT})
            with urllib.request.urlopen(verzoek, timeout=60) as antwoord:
                rijen = json.load(antwoord)
            codes.update(r["achtbaan"] for r in rijen if isinstance(r, dict) and r.get("achtbaan"))
            if len(rijen) < 1000:
                break
            van += 1000
    except (OSError, ValueError, urllib.error.URLError) as fout:
        print(f"  Supabase niet bereikbaar ({fout}); alleen gereden.json telt voor het bewaren van credits")
        return set()
    print(f"  Supabase: {len(codes)} verschillende achtbanen met ritten")
    return codes


def bouw(vorige, tel):
    vorige_lijst = vorige.get("achtbanen", []) if vorige else []
    vorige_per_id = {a["id"]: a for a in vorige_lijst}
    vorige_ids = set(vorige_per_id)
    extra = (lees_json(EXTRA) or {}).get("achtbanen") or []
    # Banen die jij in losse sporen hebt gesplitst (data/splitsen.json)
    splitsen = {}
    for regel in (lees_json(SPLITSEN) or {}).get("splitsen") or []:
        if isinstance(regel, dict) and regel.get("id") and isinstance(regel.get("sporen"), list) and len(regel["sporen"]) >= 2:
            splitsen[regel["id"]] = [str(n) for n in regel["sporen"]]

    basis, cijfers, wd_extra, wd_plekken, wd_parken, nodig = bouw_wikidata()

    print("4/5 Achtbanen en pretparken ophalen bij OpenStreetMap…")
    try:
        elementen = vraag_overpass()
    except Exception as fout:  # noqa: BLE001
        print(f"  ✗ OpenStreetMap lukt niet: {fout}")
        elementen = None
    parken = Parken(elementen or [])
    osm = lees_osm_banen(elementen or [], parken, tel)
    if elementen is not None:
        print(f"  {tel['osm_objecten']} achtbaanobjecten, {parken.aantal} pretparken")

    # Wikidata-codes uit OSM: land van de parken, en de namen ervan
    osm_park_q = {o["park"]["qid"] for o in osm if o["park"] and o["park"]["qid"]}
    park_land = haal_landen(osm_park_q) if osm_park_q else {}
    iso_land = {}
    try:
        for rij in vraag(VRAAG_LANDCODES):
            q, iso = qid(waarde(rij, "land")), (waarde(rij, "iso") or "").upper()
            if q and iso:
                iso_land.setdefault(iso, q)
    except RuntimeError as fout:
        print(f"  landcodes niet opgehaald: {fout}")

    # Wikidata-codes in OSM-tags die geen achtbaan uit de lijst zijn: is het een park
    # (dan is de tag een vergissing) of iets anders (dan is het object geen achtbaan)?
    vreemd = {o["q"] for o in osm if o["q"] and o["q"] not in basis}
    park_qs, niet_achtbaan = set(wd_parken) | osm_park_q, set()
    if vreemd:
        try:
            parkachtig = welke_zijn_parken(vreemd - park_qs, (PRETPARK, DIERENTUIN))
            park_qs |= parkachtig
            niet_achtbaan = vreemd - park_qs
            print(f"  {len(vreemd)} wikidata-tags wijzen niet naar een baan uit de lijst: {len(vreemd & park_qs)} naar een park (genegeerd), {len(niet_achtbaan)} naar iets anders (blijft OSM-baan)")
        except RuntimeError as fout:
            print(f"  wikidata-tags niet gecontroleerd: {fout}")

    alle_q = nodig | osm_park_q | set(park_land.values()) | set(iso_land.values())
    print(f"5/5 Namen ophalen voor {len(alle_q)} onderwerpen…")
    naam, alle_namen = haal_namen(alle_q)

    wd = maak_wikidata_lijst(basis, cijfers, wd_extra, wd_plekken, wd_parken, naam, alle_namen)
    # Verhuisde banen met meer landen: het land van het park (P17 van het park), als dat erbij zit
    meer = [a for a in wd if a.get("_landen") and str(a.get("parkId") or "").startswith("Q")]
    if meer:
        try:
            landen_van_park = haal_landen({a["parkId"] for a in meer})
        except Exception as fout:  # noqa: BLE001
            print(f"  Landen van parken niet opgehaald: {fout}")
            landen_van_park = {}
        for a in meer:
            land = norm.land(naam.get(landen_van_park.get(a["parkId"])))
            if land and land in a["_landen"]:
                a["land"] = land
                a["_land_beslist"] = True
                tel["land_van_park"] += 1
    for a in wd:
        if a["id"] in splitsen:  # OSM-sporen met deze namen horen bij deze baan
            a["_namen"] = a["_namen"] | set(splitsen[a["id"]])
    # VR-versies uit Wikidata (zoals "XR Ride") apart: die horen bij een echte baan
    wd_vr = [a for a in wd if VR.search(a["naam"]) or VR.search(a.get("type") or "")]
    wd = [a for a in wd if a not in wd_vr]
    tel["wikidata"] = len(wd)

    def park_naam(p):
        return naam.get(p["qid"]) or p["naam"] if p["qid"] else p["naam"]

    # Land: via het park in Wikidata, via addr:country, of van de dichtstbijzijnde
    # bekende achtbaan in de buurt
    met_land = Raster()
    for a in wd:
        if a.get("land") and a.get("lat") is not None:
            met_land.zet_punt(a, a["lat"], a["lon"])

    def land_van(o, iso):
        p = o["park"]
        if p and p["qid"] and park_land.get(p["qid"]) in naam:
            return naam[park_land[p["qid"]]]
        for code in (iso, p and p["iso"]):
            if code and iso_land.get(code) in naam:
                return naam[iso_land[code]]
        dichtst = None
        for a in met_land.rond(o["lat"], o["lon"]):
            d = afstand(o["lat"], o["lon"], a["lat"], a["lon"])
            if d <= LAND_AFSTAND and (dichtst is None or d < dichtst[0]):
                dichtst = (d, a["land"])
        return dichtst[1] if dichtst else None

    if elementen is not None:
        nieuw, naar_doel, osm_vr = voeg_osm_samen(wd, osm, vorige_lijst, park_naam, land_van, tel, niet_achtbaan, park_qs)
    else:
        # OSM niet bereikbaar: de OSM-gegevens van de vorige keer blijven staan,
        # zonder wat volgens de regels hierboven geen achtbaan is
        nieuw, osm_vr, naar_doel = [], [], {}
        for a in vorige_lijst:
            if not a["id"].startswith("osm-"):
                continue
            if VR.search(a["naam"]):
                osm_vr.append(a)
            elif (geen_achtbaan(a["naam"], {}) not in (None, "zomerrodelbaan")
                  or (is_station(a["naam"], {}) and not zonder_station(a["naam"]))):
                tel["osm_geen_achtbaan_vorige_keer"] += 1
            else:
                # De vorige keer is al gekeken of het een achtbaan is (met de tags uit OSM,
                # die er nu niet zijn): wat toen bleef, blijft nu ook.
                a = dict(a)
                a["_w"] = {"osm": oude_waarden(a, "osm")}
                nieuw.append(a)
        for a in wd:
            oud = vorige_per_id.get(a["id"])
            if oud and oud.get("osm"):
                for veld in ("osm", "lat", "lon", "park", "parkId", "land", "rcdb"):
                    if a.get(veld) is None and oud.get(veld) is not None:
                        a[veld] = oud[veld]
                if not a.get("_park_zeker") and oud.get("park"):
                    a["park"], a["parkId"] = oud["park"], oud.get("parkId")
                a["_w"]["osm"] = oude_waarden(oud, "osm")
        tel["osm_vorige_keer"] = len(nieuw)
        print(f"  De {len(nieuw)} achtbanen uit OpenStreetMap van de vorige keer blijven staan.")
    tel["osm_nieuw"] = len(nieuw) if elementen is not None else 0
    alle = wd + nieuw

    # Wikipedia: links naar de artikelen, en het informatieblok van het Engelse,
    # Nederlandse en Duitse artikel
    wd_ids = {a["id"] for a in wd}
    try:
        categorieen, artikelen = haal_wd_fotobronnen(sorted(wd_ids))
    except Exception as e:  # noqa: BLE001
        print(f"  Commons-categorieën en artikelen niet opgehaald: {e}")
        categorieen, artikelen = None, None
    lees_wikipedia(alle, artikelen, vorige_per_id, tel)

    # Per veld de beste waarde kiezen (jouw aanvullingen komen er op de site nog bovenop)
    park_index = maak_park_index(alle)
    for a in alle:
        kies_waarden(a, park_index, tel)
    park_aliassen = voeg_parken_samen(alle, tel)
    dubbel = voeg_dubbele_banen_samen(alle, set(splitsen), tel)
    naar_doel.update(dubbel)
    plek_bij_park(alle, tel)
    land_uit_plek(alle, tel)

    # VR-versies horen bij de echte baan: je rit op een VR-versie telt voor die baan
    vr_doel = voeg_vr_samen(osm_vr + wd_vr, alle, tel)
    naar_doel.update(vr_doel)

    # Voorstellen om een baan te splitsen in losse sporen (zie data/splitsen.json)
    voorstellen = {a["id"]: a["_sporen"] for a in wd if a.get("_sporen") and a["id"] not in splitsen}
    for q, sporen in sorted(voorstellen.items()):
        print(f"  Mogelijk meer sporen: {per_naam(wd, q)} -> {', '.join(sporen)}")
    tel["voorstellen_splitsen"] = len(voorstellen)

    # Ids die er vorige keer waren en nu bij een andere achtbaan horen
    nieuwe_ids = {a["id"] for a in alle}
    aliassen = {}
    for oud, doel in ((vorige or {}).get("aliassen") or {}).items():
        doel = naar_doel.get(doel, doel)
        if oud not in nieuwe_ids and doel in nieuwe_ids:
            aliassen[oud] = doel
    for oud in vorige_ids - nieuwe_ids:
        if oud in naar_doel and naar_doel[oud] in nieuwe_ids:
            aliassen[oud] = naar_doel[oud]
    aliassen.update({k: v for k, v in vr_doel.items() if v in nieuwe_ids})
    aliassen.update({k: v for k, v in dubbel.items() if v in nieuwe_ids})
    aliassen.update(zoek_dubbel_extra(alle, extra, tel))

    # Credits mogen nooit verdwijnen: staat een id uit gereden.json of uit de ritten
    # in Supabase (van jou en je vrienden) nergens meer in, dan blijft de regel van
    # de vorige keer staan.
    extra_ids = {x.get("id") for x in extra}
    spoor_ids = {f"{q}-{n}" for q, namen in splitsen.items() for n in range(1, len(namen) + 1)}
    gereden_ids = [rit.get("id") for rit in (lees_json(GEREDEN) or {}).get("gereden") or [] if isinstance(rit, dict)]
    gereden_ids += sorted(supabase_codes() - set(gereden_ids))
    for i in gereden_ids:
        if not i or i in nieuwe_ids or i in aliassen or i in extra_ids or i in spoor_ids:
            continue
        if i in vorige_per_id:
            alle.append(vorige_per_id[i])
            nieuwe_ids.add(i)
            tel["behouden_voor_gereden"] += 1
            print(f"  {i} ({vorige_per_id[i]['naam']}) staat niet meer in de bronnen, maar iemand heeft hem gereden: blijft staan")
        else:
            print(f"  Let op: {i} uit de ritten is onbekend")

    zoek_fotos(alle, wd_ids, vorige_per_id, tel, categorieen, artikelen)

    for a in alle:
        for k in [k for k in a if k.startswith("_")]:
            del a[k]
    alle.sort(key=lambda a: (a["naam"].casefold(), a["id"]))
    tel["totaal"] = len(alle)
    tel["dubbelen_weggehaald"] = (tel["osm_via_tag"] + tel["osm_via_naam"]
                                  + tel["osm_dubbel_binnen_osm"] + tel["dubbel_met_extra"] + tel["vr_samengevoegd"])
    tel["geen_achtbaan_weggehaald"] = (sum(v for k, v in tel.items() if k.startswith("osm_geen_"))
                                       + tel["osm_alleen_station"] + tel["osm_buiten_park"] + tel["vr_weg"])
    return alle, aliassen, voorstellen, park_aliassen


def per_naam(lijst, q):
    return next((a["naam"] for a in lijst if a["id"] == q), q)


# Velden die de lijst, de filters, de kaartjes en de kaart nodig hebben. De rest (bronnen,
# Wikipedia-links, vorige parken, ...) staat in data/details/, verdeeld over kleine
# bestanden: de attractiepagina haalt alleen het stuk op waar die baan in staat.
LIJSTVELDEN = ("id", "naam", "park", "parkId", "land", "type", "fabrikant", "status", "geopend", "gesloten",
               "hoogte", "snelheid", "lengte", "inversies", "foto", "fotoInfo", "lat", "lon", "vorigeParken")
DETAILMAP = MAP / "data" / "details"
DETAILDELEN = 16


def detaildeel(achtbaan_id):
    """In welk stuk staan de details? (De site rekent precies zo.)"""
    return sum(ord(c) for c in achtbaan_id) % DETAILDELEN


def schrijf(achtbanen, aliassen, tel, voorstellen=None, park_aliassen=None):
    UITVOER.parent.mkdir(parents=True, exist_ok=True)
    kop = {
        "bijgewerkt": datetime.date.today().isoformat(),
        "bron": "Wikidata (CC0), Wikipedia (CC BY-SA, alleen feiten uit het informatieblok) en OpenStreetMap (© OpenStreetMap-bijdragers, ODbL); foto's via Wikimedia Commons",
        "licentie": "Dit bestand bevat gegevens uit OpenStreetMap en valt onder de Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/",
        "aantal": len(achtbanen),
        "telling": {k: v for k, v in sorted(tel.items()) if v},
        "aliassen": dict(sorted(aliassen.items())),
        # Parken die samengevoegd zijn: oude parkcode -> nieuwe, zodat oude links blijven werken
        "parkAliassen": dict(sorted((park_aliassen or {}).items())),
        # Banen waar OpenStreetMap meer sporen met een eigen naam ziet; in beheer kun je ze splitsen
        "splitsvoorstellen": dict(sorted((voorstellen or {}).items())),
        "details": {"map": "data/details", "delen": DETAILDELEN},
    }
    kort, details = [], [dict() for _ in range(DETAILDELEN)]
    for a in achtbanen:
        kort.append({k: a[k] for k in LIJSTVELDEN if a.get(k) is not None})
        d = {k: v for k, v in a.items() if k not in LIJSTVELDEN and v is not None}
        if d:
            details[detaildeel(a["id"])][a["id"]] = d

    regels = ",\n".join(json.dumps(a, ensure_ascii=False, separators=(",", ":")) for a in kort)
    tekst = json.dumps(kop, ensure_ascii=False)[:-1] + ',\n"achtbanen": [\n' + regels + "\n]}\n"
    json.loads(tekst)  # controle: is het geldige JSON?
    DETAILMAP.mkdir(parents=True, exist_ok=True)
    for i, deel in enumerate(details):
        (DETAILMAP / f"{i}.json").write_text(json.dumps(deel, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n", encoding="utf-8")
    if DETAILS.exists():
        DETAILS.unlink()  # het oude details.json in één stuk
    UITVOER.write_text(tekst, encoding="utf-8")
    return len(tekst.encode("utf-8"))


def samenvatting(tel, grootte):
    regels = [
        f"Uit Wikidata:                         {tel['wikidata']:>6}",
        f"Extra uit OpenStreetMap:              {tel['osm_nieuw']:>6}",
        f"Totaal:                               {tel['totaal']:>6}",
        *([f"OSM niet bereikbaar; van de vorige keer: {tel['osm_vorige_keer']:>6}"] if tel["osm_vorige_keer"] else []),
        "",
        f"OSM-objecten opgehaald:               {tel['osm_objecten']:>6}",
        f"  gekoppeld via de wikidata-tag:      {tel['osm_via_tag']:>6}",
        f"  gekoppeld op naam en afstand:       {tel['osm_via_naam']:>6}",
        f"  samengevoegd binnen OSM:            {tel['osm_dubbel_binnen_osm']:>6}",
        f"  zonder naam (overgeslagen):         {tel['osm_zonder_naam']:>6}",
        f"Dubbel met extra.json:                {tel['dubbel_met_extra']:>6}",
        f"VR-versies bij de echte baan gezet:   {tel['vr_samengevoegd']:>6}",
        f"Geen achtbaan, weggelaten:            {tel['geen_achtbaan_weggehaald']:>6}",
        *[f"  {k[9:]:35} {v:>6}" for k, v in sorted(tel.items()) if k.startswith("osm_geen_")],
        f"  los station:                        {tel['osm_alleen_station']:>6}",
        f"  buiten een pretpark (OSM, geen RCDB): {tel['osm_buiten_park']:>4}",
        f"  VR-versie zonder echte baan:        {tel['vr_weg']:>6}",
        f"Voorstellen om te splitsen:           {tel['voorstellen_splitsen']:>6}",
        f"Dubbelen weggehaald (totaal):         {tel['dubbelen_weggehaald']:>6}",
        f"Wikidata-banen met park uit OSM:      {tel['wd_park_uit_osm']:>6}",
        f"Wikidata-banen met plek uit OSM:      {tel['wd_plek_uit_osm']:>6}",
        f"Behouden voor gereden.json:           {tel['behouden_voor_gereden']:>6}",
        f"Met foto:                             {tel['met_foto']:>6} ({tel['met_foto'] / max(1, tel['totaal']):.0%})",
        f"  uit Wikidata P18:                   {tel['foto_p18']:>6}",
        f"  uit de Commons-categorie:           {tel['foto_categorie']:>6}",
        f"  uit het Wikipedia-artikel:          {tel['foto_wikipedia']:>6}",
        f"  uit een OSM-tag:                    {tel['foto_osm']:>6}",
        f"  gevonden op Commons (naam + park):  {tel['foto_zoeken']:>6}",
        f"  van de vorige keer:                 {tel['foto_vorige']:>6}",
        f"  liggende foto van de baan:          {tel['foto_liggend']:>6}",
        f"  tweede keus (staand, bouw, trein):  {tel['foto_tweede_keus']:>6}",
        f"  afgekeurd (niet vrij, logo, kaart): {tel['foto_afgekeurd']:>6}",
        f"Grootte achtbanen.json:               {grootte / 1e6:.2f} MB",
    ]
    tekst = "\n".join(regels)
    print("\n" + tekst)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("### Achtbanen bijgewerkt\n\n```\n" + tekst + "\n```\n")


def lees_vorige():
    """De lijst van de vorige keer, met de details er weer bij."""
    vorige = lees_json(UITVOER)
    if not vorige:
        return vorige
    details = {}
    if isinstance(vorige.get("details"), dict):
        for i in range(int(vorige["details"].get("delen") or 0)):
            details.update(lees_json(DETAILMAP / f"{i}.json") or {})
    elif vorige.get("details"):
        details = lees_json(DETAILS) or {}  # ouder bestand: alles in één details.json
    for a in vorige.get("achtbanen", []):
        a.update(details.get(a["id"], {}))
    return vorige


RAPPORT = MAP / "data" / "rapport.json"


def schrijf_rapport(achtbanen, tel):
    """Kwaliteitsrapport in data/rapport.json en (op GitHub) in de samenvatting van de run."""
    try:
        vorige = json.loads(RAPPORT.read_text(encoding="utf-8")) if RAPPORT.exists() else None
    except ValueError:
        vorige = None
    meldingen = []
    if tel["osm_vorige_keer"]:
        meldingen.append(f"OpenStreetMap was niet bereikbaar. De {tel['osm_vorige_keer']} achtbanen uit OpenStreetMap "
                         "van de vorige keer zijn gebleven.")
    if tel["foto_zoeken_niet_af"]:
        meldingen.append(f"Zoeken naar foto's op Commons stopte na de tijdslimiet; {tel['foto_zoeken_niet_af']} banen "
                         "zonder foto komen de volgende keer aan de beurt.")
    if tel["plek_twijfel"]:
        meldingen.append(f"{tel['plek_twijfel']} banen liggen ver van de andere banen in hun park, of noemen een ander land. "
                         "Misschien klopt het park niet, of de plek in Wikidata (vaak bij verhuisde banen).")
    if tel["foto_niet_gecontroleerd"]:
        meldingen.append(f"Bij {tel['foto_niet_gecontroleerd']} banen lukte het zoeken of controleren van foto's niet; "
                         "de foto van de vorige keer is gebleven.")
    r = rapport.maak_rapport(achtbanen, tel, datetime.date.today().isoformat(), vorige, meldingen)
    rapport.schrijf(r, RAPPORT)
    print(f"\nKwaliteitsrapport: {RAPPORT.relative_to(MAP)}")
    for v in r["velden"].values():
        print(f"  {v['naam'] + ':':<32}{v['procent']:>6.1f} %".replace(".", ","))


def main():
    # Elke regel meteen in het logboek, ook in GitHub Actions
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    vorige = lees_vorige()
    vorig_aantal = (vorige or {}).get("aantal", 0)
    tel = defaultdict(int)
    try:
        achtbanen, aliassen, voorstellen, park_aliassen = bouw(vorige, tel)
    except Exception as fout:  # noqa: BLE001
        print(f"\n✗ Ophalen mislukt: {fout}")
        rapport.meld_mislukt(f"Ophalen mislukt: {fout}. "
                             + (f"De lijst van de vorige keer ({vorig_aantal} achtbanen) blijft staan." if vorig_aantal else ""))
        if vorig_aantal:
            print(f"  De bestaande lijst met {vorig_aantal} achtbanen blijft staan.")
            return 0
        return 1

    if vorig_aantal and len(achtbanen) < vorig_aantal * 0.5:
        print(f"\n✗ Verdacht weinig achtbanen ({len(achtbanen)} tegen {vorig_aantal} vorige keer).")
        print("  De bestaande lijst blijft staan.")
        rapport.meld_mislukt(f"Verdacht weinig achtbanen ({len(achtbanen)} tegen {vorig_aantal} vorige keer). De lijst van de vorige keer blijft staan.")
        return 0

    tel["met_foto"] = sum(1 for a in achtbanen if a.get("foto"))
    # Vorige park-verwijzingen blijven ook gelden
    park_aliassen = {**((vorige or {}).get("parkAliassen") or {}), **park_aliassen}
    grootte = schrijf(achtbanen, aliassen, tel, voorstellen, park_aliassen)
    print(f"\n✓ {len(achtbanen)} achtbanen opgeslagen in {UITVOER.relative_to(MAP)}")
    samenvatting(tel, grootte)
    schrijf_rapport(achtbanen, tel)
    if os.environ.get("ACHTBANEN_UITLEG") == "1":
        print("\nWeggelaten omdat het geen achtbaan is:")
        for reden, naam, park, i in sorted(WEGGELATEN, key=lambda w: (w[0], str(w[1]).casefold())):
            print(f"  [{reden}] {naam}{f' ({park})' if park else ''} {i}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
