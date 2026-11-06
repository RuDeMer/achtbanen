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
from collections import defaultdict

MAP = pathlib.Path(__file__).resolve().parent.parent
UITVOER = MAP / "data" / "achtbanen.json"
DETAILS = MAP / "data" / "details.json"
GEREDEN = MAP / "data" / "gereden.json"
EXTRA = MAP / "data" / "extra.json"

# Wordt achtbanen.json groter dan dit, dan gaan velden die alleen de
# attractiepagina gebruikt naar data/details.json.
MAX_GROOTTE = int(os.environ.get("ACHTBANEN_MAX_BYTES", 3_000_000))

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

    print("2/5 Hoogte, snelheid, lengte en jaartallen ophalen…")
    cijfers = {qid(waarde(r, "item")): r for r in vraag(VRAAG_CIJFERS)}
    time.sleep(2)

    print("3/5 Uitzoeken welke locaties pretparken zijn…")
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
    return basis, cijfers, parken, nodig


def maak_wikidata_lijst(basis, cijfers, parken, naam, alle_namen):
    dit_jaar = datetime.date.today().year
    achtbanen = []
    for q, r in basis.items():
        if q not in naam:
            continue
        c = cijfers.get(q, {})

        delen = lijst_qids(waarde(r, "delen"))
        plekken = lijst_qids(waarde(r, "plekken"))
        park_id = next((k for k in delen + plekken if k in parken), None)
        park_zeker = park_id is not None
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
            # Alleen voor het samenvoegen, komt niet in het bestand
            "_namen": alle_namen.get(q, set()) | {naam[q]},
            "_park_zeker": park_zeker,
        }
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
        banen.append({
            "id": osm_id(el), "type": el["type"], "nummer": el["id"], "tags": t,
            "naam": leesbare_naam(t), "varianten": naam_varianten(t),
            "lat": lat, "lon": lon, "q": q if QID.fullmatch(q) else None,
            "park": parken.zoek(lat, lon),
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
    dan het spoor (roller_coaster=track), dan een way, dan het laagste nummer."""
    return (
        o["id"] not in vorige_ids,
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
            uit["type"] = OSM_TYPES.get(soort.replace(" ", "_").replace("-", "_"))
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


def voeg_osm_samen(wd, osm, vorige_lijst, park_naam, land_van, tel):
    """Koppelt OSM-objecten aan Wikidata, voegt dubbelen samen en maakt van de
    rest nieuwe achtbanen. Geeft (nieuwe achtbanen, {osm-id: achtbaan-id})."""
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

    # 1. Via de wikidata-tag
    for o in osm:
        a = per_q.get(o["q"])
        if a:
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
        if o["id"] in naar_doel or not o["naam"]:
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
        if a.get("lat") is None:
            a["lat"], a["lon"] = round(eerste["lat"], 5), round(eerste["lon"], 5)
            tel["wd_plek_uit_osm"] += 1
        p = eerste["park"]
        if p and not a.get("_park_zeker"):
            a["park"] = park_naam(p)
            a["parkId"] = p["qid"] or p["id"]
            tel["wd_park_uit_osm"] += 1
        w = osm_waarden(groep)
        for veld in ("hoogte", "rcdb", "geopend", "fabrikant"):
            if a.get(veld) is None and w.get(veld) is not None:
                a[veld] = w[veld]
        if not a.get("land"):
            land = land_van(eerste, w.get("iso"))
            if land:
                a["land"] = land

    # 3. De rest: dubbelen binnen OSM samenvoegen (zelfde naam, dichtbij of zelfde park)
    rest = [o for o in osm if o["id"] not in naar_doel]
    tel["osm_zonder_naam"] = sum(1 for o in rest if not o["naam"])
    rest = [o for o in rest if o["naam"]]
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
        tel["osm_dubbel_binnen_osm"] += len(groep) - 1
        eerste = groep[0]
        nieuwe_id = eerste["id"]
        if nieuwe_id not in vorige_ids:
            for k in naam_sleutels(eerste["naam"]):
                oud = next((v for v in vorige_osm.get(k, []) if v["id"] not in gebruikt
                            and afstand(eerste["lat"], eerste["lon"], v["lat"], v["lon"]) <= KOPPEL_AFSTAND), None)
                if oud:
                    nieuwe_id = oud["id"]
                    gebruikt.add(nieuwe_id)
                    tel["osm_id_hergebruikt"] += 1
                    break
        w = osm_waarden(groep)
        p = eerste["park"]
        geopend = w.get("geopend")
        a = {
            "id": nieuwe_id,
            "naam": eerste["naam"],
            "park": park_naam(p) if p else None,
            "parkId": (p["qid"] or p["id"]) if p else None,
            "land": land_van(eerste, w.get("iso")),
            "type": w.get("type") or "Achtbaan",
            "fabrikant": w.get("fabrikant"),
            "status": "gepland" if geopend and geopend > dit_jaar else "open",
            "geopend": geopend,
            "hoogte": w.get("hoogte"),
            "lengte": w.get("lengte"),
            "lat": round(eerste["lat"], 5),
            "lon": round(eerste["lon"], 5),
            "rcdb": w.get("rcdb"),
            "_osm_ids": [o["id"] for o in groep],
            "_osm_fotos": osm_fotos(groep),
            "_namen": {n for o in groep for n in o["varianten"]} | {eerste["naam"]},
        }
        nieuw.append({k: v for k, v in a.items() if v is not None})
        for o in groep:
            naar_doel[o["id"]] = a["id"]
    return nieuw, naar_doel


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
# Foto's: alleen vrij gelicenseerde bestanden op Wikimedia Commons
# ---------------------------------------------------------------------------
# Volgorde per achtbaan:
#   1. Wikidata P18
#   2. een geschikte foto uit de Commons-categorie (Wikidata P373)
#   3. de vrij gelicenseerde hoofdafbeelding van het Wikipedia-artikel
#   4. de image- of wikimedia_commons-tag uit OpenStreetMap
# Daarna wordt elk gekozen bestand bij Commons gecontroleerd: het moet er echt
# staan en een vrije licentie hebben. Alleen de bestandsnaam wordt bewaard.
# Je eigen foto (in gereden.json) gaat op de site altijd voor.

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
WIKIPEDIA_TALEN = ["nl", "en", "de", "fr", "es", "it", "pl", "sv", "pt", "ja", "zh"]
GEEN_FOTO = {
    "logo", "map", "kaart", "karte", "plan", "diagram", "schema", "layout", "sign", "signage",
    "poster", "flyer", "ticket", "lego", "model", "modell", "minecraft", "render", "rendering",
    "icon", "stamp", "coin", "flag", "screenshot",
}
NIET_VRIJ = re.compile(r"non[- ]?free|fair[ _-]?use|all rights reserved", re.I)


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


def geschikte_foto(naam, info):
    """Een gewone foto: JPEG, groot genoeg, liggend, en geen logo of plattegrond."""
    breed, hoog = info.get("width") or 0, info.get("height") or 0
    if info.get("mime") != "image/jpeg" or breed < 800 or hoog < 450:
        return False
    if not 1.1 <= breed / hoog <= 2.4:
        return False
    woorden = set(re.split(r"[\W_]+", naam.casefold()))
    return not woorden & GEEN_FOTO


def foto_uit_categorie(categorie):
    data = mediawiki(COMMONS_API, {
        "action": "query", "generator": "categorymembers", "gcmtitle": f"Category:{categorie}",
        "gcmtype": "file", "gcmlimit": "100", "prop": "imageinfo", "iiprop": "size|mime",
    })
    beste = None
    for pagina in data.get("query", {}).get("pages", []):
        naam = pagina.get("title", "").split(":", 1)[-1]
        info = (pagina.get("imageinfo") or [{}])[0]
        if naam and geschikte_foto(naam, info):
            score = (min(info["width"] * info["height"], 12_000_000), naam)
            if beste is None or score > beste[0]:
                beste = (score, naam)
    return beste[1] if beste else None


def haal_wd_fotobronnen(qids):
    """Commons-categorie (P373) en Wikipedia-artikelen van achtbanen zonder P18."""
    categorieen, artikelen = {}, defaultdict(dict)
    wikis = " ".join(f"<https://{t}.wikipedia.org/>" for t in WIKIPEDIA_TALEN)
    for stuk in in_stukjes(sorted(qids), 300):
        waarden = " ".join(f"wd:{q}" for q in stuk)
        sparql = PREFIXEN + f"""
SELECT ?item ?cat ?artikel WHERE {{
  VALUES ?item {{ {waarden} }}
  {{ ?item wdt:P373 ?cat . }}
  UNION
  {{ VALUES ?wiki {{ {wikis} }} ?artikel schema:about ?item ; schema:isPartOf ?wiki . }}
}}"""
        for rij in vraag(sparql):
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


def controleer_licenties(bestanden):
    """Welke bestanden staan echt op Commons, met een vrije licentie?"""
    goed = set()
    for stuk in in_stukjes(sorted(bestanden), 50):
        data = mediawiki(COMMONS_API, {
            "action": "query", "prop": "imageinfo", "iiprop": "extmetadata|mime",
            "iiextmetadatafilter": "LicenseShortName|License|UsageTerms|NonFree",
            "titles": "|".join(f"File:{b}" for b in stuk),
        })
        query = data.get("query", {})
        terug = {f"File:{b}": b for b in stuk}
        for n in query.get("normalized", []):
            terug[n["to"]] = terug.get(n["from"])
        for pagina in query.get("pages", []):
            if pagina.get("missing") or pagina.get("invalid"):
                continue
            info = (pagina.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata") or {}
            licentie = " ".join(str((meta.get(k) or {}).get("value") or "") for k in ("LicenseShortName", "License", "UsageTerms"))
            niet_vrij = str((meta.get("NonFree") or {}).get("value") or "").strip().lower() in ("true", "1", "yes")
            if niet_vrij or not licentie.strip() or NIET_VRIJ.search(licentie):
                continue
            if not str(info.get("mime") or "").startswith("image/"):
                continue
            if terug.get(pagina.get("title")):
                goed.add(terug[pagina["title"]])
        time.sleep(0.5)
    return goed


def zoek_fotos(alle, wd_ids, vorige_per_id, tel):
    print("Foto's zoeken…")
    bronnen = {a["id"]: [] for a in alle}
    for a in alle:
        if a.get("foto"):
            bronnen[a["id"]].append(("p18" if a["id"] in wd_ids else "vorige", a["foto"]))
    fout = False

    zonder = [a["id"] for a in alle if a["id"] in wd_ids and not a.get("foto")]
    try:
        categorieen, artikelen = haal_wd_fotobronnen(zonder) if zonder else ({}, {})
    except Exception as e:  # noqa: BLE001
        print(f"  Commons-categorieën en artikelen niet opgehaald: {e}")
        categorieen, artikelen, fout = {}, {}, True
    print(f"  {len(zonder)} Wikidata-banen zonder P18: {len(categorieen)} met een Commons-categorie, {len(artikelen)} met een Wikipedia-artikel")

    def uit_categorie(aid, categorie, bron):
        nonlocal fout
        try:
            f = foto_uit_categorie(categorie)
        except Exception as e:  # noqa: BLE001
            print(f"  categorie {categorie}: {e}")
            fout = True
            return
        if f:
            bronnen[aid].append((bron, f))
        time.sleep(0.3)

    for i, (aid, categorie) in enumerate(sorted(categorieen.items()), 1):
        if i % 50 == 0:
            print(f"  categorieën {i}/{len(categorieen)}")
        uit_categorie(aid, categorie, "categorie")

    try:
        for q, lijst in wikipedia_fotos(artikelen).items():
            bronnen[q].extend(("wikipedia", f) for f in lijst)
    except Exception as e:  # noqa: BLE001
        print(f"  Wikipedia-afbeeldingen niet opgehaald: {e}")
        fout = True

    for a in alle:
        for soort, w in a.get("_osm_fotos", []):
            if soort == "bestand":
                bronnen[a["id"]].append(("osm", w))
    for a in alle:
        if not bronnen[a["id"]]:
            for soort, w in a.get("_osm_fotos", []):
                if soort == "categorie":
                    uit_categorie(a["id"], w, "osm")
                    break

    alle_bestanden = {f for lijst in bronnen.values() for _, f in lijst}
    try:
        goed = controleer_licenties(alle_bestanden)
        gecontroleerd = True
    except Exception as e:  # noqa: BLE001
        print(f"  Licenties niet te controleren: {e}. Alleen P18 en eerder gecontroleerde foto's blijven.")
        goed, gecontroleerd, fout = set(), False, True
    if gecontroleerd:
        print(f"  {len(goed)} van de {len(alle_bestanden)} bestanden staan op Commons met een vrije licentie")
        tel["foto_afgekeurd"] = len(alle_bestanden) - len(goed)

    for a in alle:
        keuze = None
        for bron, f in bronnen[a["id"]]:
            # Gecontroleerd: alleen vrije bestanden die echt op Commons staan.
            # Niet te controleren: alleen P18 en foto's die eerder al goedgekeurd waren.
            toegestaan = f in goed if gecontroleerd else bron in ("p18", "vorige")
            if toegestaan:
                keuze = (bron, f)
                break
        if keuze:
            a["foto"] = keuze[1]
            tel[f"foto_{keuze[0]}"] += 1
            continue
        a.pop("foto", None)
        oud = (vorige_per_id.get(a["id"]) or {}).get("foto")
        if fout and oud:
            a["foto"] = oud  # iets lukte niet: de foto van de vorige keer blijft
            tel["foto_vorige"] += 1


# ---------------------------------------------------------------------------
# Alles samen
# ---------------------------------------------------------------------------

def lees_json(pad):
    try:
        tekst = pad.read_text(encoding="utf-8")
        return json.loads(re.sub(r",(\s*[\]}])", r"\1", tekst))
    except (OSError, ValueError):
        return None


def bouw(vorige, tel):
    vorige_lijst = vorige.get("achtbanen", []) if vorige else []
    vorige_per_id = {a["id"]: a for a in vorige_lijst}
    vorige_ids = set(vorige_per_id)
    extra = (lees_json(EXTRA) or {}).get("achtbanen") or []

    basis, cijfers, wd_parken, nodig = bouw_wikidata()

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

    alle_q = nodig | osm_park_q | set(park_land.values()) | set(iso_land.values())
    print(f"5/5 Namen ophalen voor {len(alle_q)} onderwerpen…")
    naam, alle_namen = haal_namen(alle_q)

    wd = maak_wikidata_lijst(basis, cijfers, wd_parken, naam, alle_namen)
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
        nieuw, naar_doel = voeg_osm_samen(wd, osm, vorige_lijst, park_naam, land_van, tel)
    else:
        # OSM niet bereikbaar: de OSM-gegevens van de vorige keer blijven staan
        nieuw = [a for a in vorige_lijst if a["id"].startswith("osm-")]
        naar_doel = {}
        for a in wd:
            oud = vorige_per_id.get(a["id"])
            if oud and oud.get("osm"):
                for veld in ("osm", "lat", "lon", "park", "parkId", "land", "hoogte", "rcdb", "geopend", "fabrikant"):
                    if a.get(veld) is None and oud.get(veld) is not None:
                        a[veld] = oud[veld]
                if not a.get("_park_zeker") and oud.get("park"):
                    a["park"], a["parkId"] = oud["park"], oud.get("parkId")
        tel["osm_vorige_keer"] = len(nieuw)
        print(f"  De {len(nieuw)} achtbanen uit OpenStreetMap van de vorige keer blijven staan.")
    tel["osm_nieuw"] = len(nieuw) if elementen is not None else 0
    alle = wd + nieuw

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
    aliassen.update(zoek_dubbel_extra(alle, extra, tel))

    # Je credits mogen nooit verdwijnen: staat een id uit gereden.json nergens
    # meer in, dan blijft de regel van de vorige keer staan.
    extra_ids = {x.get("id") for x in extra}
    for rit in (lees_json(GEREDEN) or {}).get("gereden") or []:
        i = rit.get("id") if isinstance(rit, dict) else None
        if not i or i in nieuwe_ids or i in aliassen or i in extra_ids:
            continue
        if i in vorige_per_id:
            alle.append(vorige_per_id[i])
            nieuwe_ids.add(i)
            tel["behouden_voor_gereden"] += 1
            print(f"  {i} ({vorige_per_id[i]['naam']}) staat niet meer in de bronnen, maar wel in gereden.json: blijft staan")
        else:
            print(f"  Let op: {i} uit gereden.json is onbekend")

    zoek_fotos(alle, {a["id"] for a in wd}, vorige_per_id, tel)

    for a in alle:
        for k in [k for k in a if k.startswith("_")]:
            del a[k]
    alle.sort(key=lambda a: (a["naam"].casefold(), a["id"]))
    tel["totaal"] = len(alle)
    tel["dubbelen_weggehaald"] = (tel["osm_via_tag"] + tel["osm_via_naam"]
                                  + tel["osm_dubbel_binnen_osm"] + tel["dubbel_met_extra"])
    return alle, aliassen


# Velden die alleen de attractiepagina gebruikt; gaan naar details.json als het
# hoofdbestand te groot wordt.
DETAILVELDEN = ("duur", "rcdb", "osm")


def schrijf(achtbanen, aliassen, tel):
    UITVOER.parent.mkdir(parents=True, exist_ok=True)
    kop = {
        "bijgewerkt": datetime.date.today().isoformat(),
        "bron": "Wikidata (CC0) en OpenStreetMap (© OpenStreetMap-bijdragers, ODbL); foto's via Wikimedia Commons",
        "licentie": "Dit bestand bevat gegevens uit OpenStreetMap en valt onder de Open Database License (ODbL) 1.0: https://opendatacommons.org/licenses/odbl/1-0/",
        "aantal": len(achtbanen),
        "telling": {k: v for k, v in sorted(tel.items()) if v},
        "aliassen": dict(sorted(aliassen.items())),
    }

    def tekst_van(kop, lijst):
        regels = ",\n".join(json.dumps(a, ensure_ascii=False) for a in lijst)
        t = json.dumps(kop, ensure_ascii=False)[:-1] + ',\n"achtbanen": [\n' + regels + "\n]}\n"
        json.loads(t)  # controle: is het geldige JSON?
        return t

    tekst = tekst_van(kop, achtbanen)
    if len(tekst.encode("utf-8")) > MAX_GROOTTE:
        details = {}
        kort = []
        for a in achtbanen:
            d = {k: a[k] for k in DETAILVELDEN if k in a}
            if d:
                details[a["id"]] = d
            kort.append({k: v for k, v in a.items() if k not in DETAILVELDEN})
        kop["details"] = "data/details.json"
        tekst = tekst_van(kop, kort)
        DETAILS.write_text(json.dumps(details, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        print(f"  Het bestand werd groter dan {MAX_GROOTTE / 1e6:.1f} MB: {', '.join(DETAILVELDEN)} staan nu in {DETAILS.name}")
    elif DETAILS.exists():
        DETAILS.unlink()
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
        f"Dubbelen weggehaald (totaal):         {tel['dubbelen_weggehaald']:>6}",
        f"Wikidata-banen met park uit OSM:      {tel['wd_park_uit_osm']:>6}",
        f"Wikidata-banen met plek uit OSM:      {tel['wd_plek_uit_osm']:>6}",
        f"Behouden voor gereden.json:           {tel['behouden_voor_gereden']:>6}",
        f"Met foto:                             {tel['met_foto']:>6} ({tel['met_foto'] / max(1, tel['totaal']):.0%})",
        f"  uit Wikidata P18:                   {tel['foto_p18']:>6}",
        f"  uit de Commons-categorie:           {tel['foto_categorie']:>6}",
        f"  uit het Wikipedia-artikel:          {tel['foto_wikipedia']:>6}",
        f"  uit een OSM-tag:                    {tel['foto_osm']:>6}",
        f"  van de vorige keer:                 {tel['foto_vorige']:>6}",
        f"  afgekeurd (niet op Commons/vrij):   {tel['foto_afgekeurd']:>6}",
        f"Grootte achtbanen.json:               {grootte / 1e6:.2f} MB",
    ]
    tekst = "\n".join(regels)
    print("\n" + tekst)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("### Achtbanen bijgewerkt\n\n```\n" + tekst + "\n```\n")


def main():
    # Elke regel meteen in het logboek, ook in GitHub Actions
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(line_buffering=True)
    vorige = lees_json(UITVOER)
    vorig_aantal = (vorige or {}).get("aantal", 0)
    tel = defaultdict(int)
    try:
        achtbanen, aliassen = bouw(vorige, tel)
    except Exception as fout:  # noqa: BLE001
        print(f"\n✗ Ophalen mislukt: {fout}")
        if vorig_aantal:
            print(f"  De bestaande lijst met {vorig_aantal} achtbanen blijft staan.")
            return 0
        return 1

    if vorig_aantal and len(achtbanen) < vorig_aantal * 0.5:
        print(f"\n✗ Verdacht weinig achtbanen ({len(achtbanen)} tegen {vorig_aantal} vorige keer).")
        print("  De bestaande lijst blijft staan.")
        return 0

    tel["met_foto"] = sum(1 for a in achtbanen if a.get("foto"))
    grootte = schrijf(achtbanen, aliassen, tel)
    print(f"\n✓ {len(achtbanen)} achtbanen opgeslagen in {UITVOER.relative_to(MAP)}")
    samenvatting(tel, grootte)
    return 0


if __name__ == "__main__":
    sys.exit(main())
