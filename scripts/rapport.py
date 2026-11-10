"""Kwaliteitsrapport na elke run van haal_achtbanen.py.

Hoeveel achtbanen hebben een foto, een hoogte, een snelheid, een park, enzovoort?
Het rapport komt in data/rapport.json (de beheerpagina "Ontbrekende gegevens" laat het
zien) en op GitHub ook in de samenvatting van de run (GITHUB_STEP_SUMMARY).
Alleen de standaardbibliotheek."""

import json
import os
from collections import Counter

# (sleutel, naam, telt mee als ...)
VELDEN = [
    ("foto", "Foto", lambda a: bool(a.get("foto"))),
    ("park", "Park", lambda a: bool(a.get("park"))),
    ("land", "Land", lambda a: bool(a.get("land"))),
    ("plek", "Plek op de kaart", lambda a: a.get("lat") is not None and a.get("lon") is not None),
    ("geopend", "Openingsjaar", lambda a: a.get("geopend") is not None),
    ("type", "Type (niet alleen 'Achtbaan')", lambda a: a.get("type") not in (None, "", "Achtbaan")),
    ("fabrikant", "Fabrikant", lambda a: bool(a.get("fabrikant"))),
    ("model", "Model", lambda a: bool(a.get("model"))),
    ("hoogte", "Hoogte", lambda a: a.get("hoogte") is not None),
    ("valhoogte", "Valhoogte", lambda a: a.get("valhoogte") is not None),
    ("lengte", "Lengte", lambda a: a.get("lengte") is not None),
    ("snelheid", "Topsnelheid", lambda a: a.get("snelheid") is not None),
    ("inversies", "Inversies", lambda a: a.get("inversies") is not None),
    ("duur", "Ritduur", lambda a: a.get("duur") is not None),
]

BRON_NAMEN = {
    "eigen": "Eigen aanvullingen", "wd": "Wikidata", "wp:en": "Engelstalige Wikipedia",
    "wp:nl": "Nederlandstalige Wikipedia", "wp:de": "Duitstalige Wikipedia", "osm": "OpenStreetMap",
    "plek": "Afgeleid uit de plek (land)",
}
FOTO_BRONNEN = [
    ("eigen", "eigen foto"), ("p18", "Wikidata (P18)"), ("categorie", "Commons-categorie"),
    ("wikipedia", "Wikipedia-artikel"), ("osm", "OpenStreetMap"), ("zoeken", "gevonden op Commons"),
    ("vorige", "van de vorige keer"),
]


def procent(n, totaal):
    return round(100 * n / totaal, 1) if totaal else 0.0


def maak_rapport(achtbanen, tel, bijgewerkt, vorige=None, meldingen=()):
    """achtbanen: de volledige gegevens (lijst én details), tel: de tellers van de run."""
    totaal = len(achtbanen)
    vorige_velden = (vorige or {}).get("velden", {})
    velden = {}
    for sleutel, naam, telt in VELDEN:
        n = sum(1 for a in achtbanen if telt(a))
        n_open = sum(1 for a in achtbanen if a.get("status") == "open" and telt(a))
        velden[sleutel] = {"naam": naam, "aantal": n, "procent": procent(n, totaal),
                           "procentOpen": procent(n_open, sum(1 for a in achtbanen if a.get("status") == "open"))}
        if sleutel in vorige_velden:
            velden[sleutel]["vorige"] = vorige_velden[sleutel].get("procent")
    bronnen = Counter(code for a in achtbanen for code in (a.get("bron") or {}).values())
    fotos = {
        "liggend": tel.get("foto_liggend", 0),
        "tweedeKeus": tel.get("foto_tweede_keus", 0),
        "perBron": {b: tel.get(f"foto_{b}", 0) for b, _ in FOTO_BRONNEN if tel.get(f"foto_{b}", 0)},
    }
    return {
        "uitleg": "Kwaliteit van de gegevens na de laatste run van scripts/haal_achtbanen.py. "
                  "procent: van alle achtbanen; procentOpen: van de achtbanen die open zijn; vorige: procent van de run daarvoor.",
        "bijgewerkt": bijgewerkt,
        "totaal": totaal,
        "perStatus": dict(Counter(a.get("status") or "onbekend" for a in achtbanen)),
        "landen": len({a["land"] for a in achtbanen if a.get("land")}),
        "parken": len({a.get("parkId") or a.get("park") for a in achtbanen if a.get("park")}),
        "velden": velden,
        "fotos": fotos,
        "bronnen": dict(bronnen.most_common()),
        "meldingen": list(meldingen),
    }


def _nl(x, dec=1):
    return f"{x:,.{dec}f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def markdown(r):
    """Het rapport als Markdown, voor de samenvatting van de run op GitHub."""
    st = r["perStatus"]
    regels = [
        "## Kwaliteit van de gegevens",
        "",
        f"**{_nl(r['totaal'], 0)} achtbanen** ({_nl(st.get('open', 0), 0)} open, {_nl(st.get('gesloten', 0), 0)} gesloten, "
        f"{_nl(st.get('gepland', 0), 0)} op komst) in {r['landen']} landen en {_nl(r['parken'], 0)} parken.",
        "",
        "| Gegeven | Aantal | Van alle banen | Van de open banen | Vorige keer |",
        "|---|---:|---:|---:|---:|",
    ]
    for v in r["velden"].values():
        verschil = ""
        if v.get("vorige") is not None:
            d = round(v["procent"] - v["vorige"], 1)
            verschil = "gelijk" if d == 0 else f"{'+' if d > 0 else '−'}{_nl(abs(d))} %"
        regels.append(f"| {v['naam']} | {_nl(v['aantal'], 0)} | {_nl(v['procent'])} % | {_nl(v['procentOpen'])} % | {verschil} |")
    f = r["fotos"]
    namen = dict(FOTO_BRONNEN)
    regels += [
        "",
        "### Foto's",
        "",
        f"- Liggende foto van de baan zelf: {_nl(f['liggend'], 0)}",
        f"- Tweede keus (staand, bouw, station of treintje): {_nl(f['tweedeKeus'], 0)}",
        "- Waar ze vandaan komen: " + (", ".join(f"{namen.get(b, b)} {_nl(n, 0)}" for b, n in f["perBron"].items()) or "nergens"),
        "",
        "### Bronnen",
        "",
        "| Bron | Gegevens |",
        "|---|---:|",
    ]
    regels += [f"| {BRON_NAMEN.get(b, b)} | {_nl(n, 0)} |" for b, n in r["bronnen"].items()]
    if r["meldingen"]:
        regels += ["", "### Let op", ""] + [f"- {m}" for m in r["meldingen"]]
    return "\n".join(regels) + "\n"


def schrijf(r, pad):
    with open(pad, "w", encoding="utf-8") as f:
        json.dump(r, f, ensure_ascii=False, indent=1)
        f.write("\n")
    samenvatting = os.environ.get("GITHUB_STEP_SUMMARY")
    if samenvatting:
        with open(samenvatting, "a", encoding="utf-8") as f:
            f.write(markdown(r))


def meld_mislukt(tekst):
    """Ging het ophalen mis, dan komt er geen nieuw rapport, maar wel een melding in de samenvatting."""
    samenvatting = os.environ.get("GITHUB_STEP_SUMMARY")
    if samenvatting:
        with open(samenvatting, "a", encoding="utf-8") as f:
            f.write(f"## Kwaliteit van de gegevens\n\n**Let op:** {tekst}\n")
