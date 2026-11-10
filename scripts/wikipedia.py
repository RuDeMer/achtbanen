"""Gegevens uit het informatieblok (infobox) van een Wikipedia-artikel over een achtbaan.

Werkt voor:
  Engels      {{Infobox roller coaster}}  (met {{Infobox roller coaster extend}} per extra park)
  Nederlands  {{Infobox achtbaan}}
  Duits       {{Infobox Achterbahn}}

Alleen feiten worden overgenomen (getallen, jaartallen, namen), geen lopende tekst.
De site noemt bij elk gegeven Wikipedia als bron, met een link naar het artikel
(Wikipedia-tekst valt onder CC BY-SA).

Alles wordt omgerekend naar meter, km/u en seconden.
"""
import html
import re

INFOBOX = re.compile(r"^\s*infobox[\s_]+(roller[\s_]*coaster|rollercoaster|achtbaan|achterbahn)\s*$", re.I)
UITBREIDING = re.compile(r"^\s*infobox[\s_]+roller[\s_]*coaster[\s_]+extend\s*$", re.I)

VOET = 0.3048
MIJL = 1.609344


# ---------------------------------------------------------------------------
# Wikitekst lezen
# ---------------------------------------------------------------------------

def zonder_ruis(t):
    """Commentaar, voetnoten en dergelijke eruit."""
    t = re.sub(r"<!--.*?(?:-->|$)", "", t, flags=re.S)
    t = re.sub(r"<ref\b[^>]*/>", "", t, flags=re.I)
    t = re.sub(r"<ref\b[^>]*>.*?</ref\s*>", "", t, flags=re.I | re.S)
    t = re.sub(r"<(nowiki|math|syntaxhighlight|gallery)\b[^>]*>.*?</\1\s*>", "", t, flags=re.I | re.S)
    return t


def lees_sjabloon(t, i):
    """t[i:] begint met '{{'. Geeft (naam, [(sleutel of None, waarde)], einde) of None."""
    diepte, links, j, begin, delen = 0, 0, i, i + 2, []
    n = len(t)
    while j < n:
        if t.startswith("{{", j):
            diepte += 1
            j += 2
            continue
        if t.startswith("}}", j):
            diepte -= 1
            j += 2
            if diepte == 0:
                delen.append(t[begin:j - 2])
                break
            continue
        if t.startswith("[[", j):
            links += 1
            j += 2
            continue
        if t.startswith("]]", j) and links:
            links -= 1
            j += 2
            continue
        if t[j] == "|" and diepte == 1 and links == 0:
            delen.append(t[begin:j])
            begin = j + 1
        j += 1
    else:
        return None
    naam, params = delen[0].strip(), []
    for deel in delen[1:]:
        sleutel, waarde = splits_param(deel)
        params.append((sleutel, waarde))
    return naam, params, j


def splits_param(deel):
    """'sleutel = waarde' (het eerste '=' buiten geneste sjablonen en links)."""
    diepte = links = 0
    for k, c in enumerate(deel):
        twee = deel[k:k + 2]
        if twee == "{{":
            diepte += 1
        elif twee == "}}":
            diepte -= 1
        elif twee == "[[":
            links += 1
        elif twee == "]]":
            links -= 1
        elif c == "=" and diepte == 0 and links == 0:
            return deel[:k].strip().lower(), deel[k + 1:]
    return None, deel


def sjablonen_in(t):
    """Alle sjablonen op het bovenste niveau van een tekst."""
    uit, i = [], 0
    while True:
        i = t.find("{{", i)
        if i < 0:
            return uit
        s = lees_sjabloon(t, i)
        if not s:
            return uit
        uit.append(s)
        i = s[2]


def vind_infobox(tekst):
    """(naam, [blokken]) van het achtbaan-informatieblok, of None. Het eerste blok heeft
    alle gegevens; extra blokken (Engels: 'extend') zijn andere parken waar de baan stond."""
    tekst = zonder_ruis(tekst or "")
    for m in re.finditer(r"\{\{\s*([^|{}\n]+)", tekst):
        if not INFOBOX.match(m.group(1)):
            continue
        s = lees_sjabloon(tekst, m.start())
        if not s:
            return None
        naam, params, _ = s
        hoofd, extra = {}, []
        for sleutel, waarde in params:
            if sleutel is None:
                continue
            if sleutel == "extend":
                for sub_naam, sub_params, _ in sjablonen_in(waarde):
                    if UITBREIDING.match(sub_naam):
                        extra.append({k: v for k, v in sub_params if k})
                continue
            hoofd.setdefault(sleutel, waarde)  # bij dubbele parameters telt de eerste
        return naam, [hoofd] + extra
    return None


def sjabloon_tekst(inhoud):
    """Een eenvoudig sjabloon (zonder geneste sjablonen) als platte tekst."""
    delen = [d.strip() for d in inhoud.split("|")]
    naam = delen[0].lower().replace("_", " ")
    args = [d for d in delen[1:] if not re.match(r"^\s*[a-z_ ]+\s*=", d, re.I)]
    if naam in ("convert", "cvt", "convert/2", "conv", "val", "einheit"):
        eenheid = next((a for a in args[1:] if not re.fullmatch(r"[\d.,\-–]+|to|and|-", a)), "")
        return f"{args[0]} {eenheid}" if args else ""
    if re.match(r"(start|end|birth|death)[ -]?date|dts|date|datum|opening date|start date and age|end date and age", naam):
        cijfers = [a for a in args if re.fullmatch(r"\d{1,4}", a)]
        return "-".join(cijfers[:3])
    if naam in ("nowrap", "nobr", "small", "big", "nobold", "noitalic", "resize", "abbr", "sic", "ill", "interlanguage link"):
        return args[0] if args else ""
    if naam in ("lang", "lang-de", "sort", "sortname", "hs", "nts", "ntsh"):
        return args[-1] if args else ""
    if naam in ("ubl", "unbulleted list", "plainlist", "flatlist", "hlist", "bulleted list", "br separated entries"):
        return ", ".join(args)
    if naam in ("circa", "c.", "ca", "ca."):
        return "ca. " + " ".join(args)
    if naam in ("ft to m", "ftm"):
        return f"{args[0]} ft" if args else ""
    return ""  # vlaggen, coördinaten, onbekende sjablonen: weg


def schoon(w):
    """Waarde uit een informatieblok als platte tekst."""
    w = zonder_ruis(w or "")
    for _ in range(50):  # van binnen naar buiten
        m = re.search(r"\{\{([^{}]*)\}\}", w)
        if not m:
            break
        w = w[:m.start()] + sjabloon_tekst(m.group(1)) + w[m.end():]
    w = re.sub(r"\[\[\s*(?:file|image|bestand|datei|afbeelding|bild|media)\s*:[^\[\]]*(?:\[\[[^\]]*\]\][^\[\]]*)*\]\]", "", w, flags=re.I)
    w = re.sub(r"\[\[([^|\]]*)\|([^\]]*)\]\]", r"\2", w)
    w = re.sub(r"\[\[([^\]]*)\]\]", r"\1", w)
    w = re.sub(r"\[(?:https?:)?//\S+\s+([^\]]*)\]", r"\1", w)
    w = re.sub(r"\[(?:https?:)?//\S+\]", "", w)
    w = re.sub(r"<br\s*/?\s*>", "\n", w, flags=re.I)
    w = re.sub(r"<[^>]+>", "", w)
    w = w.replace("'''", "").replace("''", "")
    w = html.unescape(w).replace("\xa0", " ").replace(" ", " ").replace(" ", " ")
    return "\n".join(re.sub(r"[ \t]+", " ", r).strip() for r in w.split("\n")).strip()


# ---------------------------------------------------------------------------
# Getallen, eenheden, datums
# ---------------------------------------------------------------------------

EENHEID = re.compile(
    r"\s*(km/h|km/u|kmh|kph|km/st|mph|m/s|ft|feet|foot|'|meters?|metres?|mtr|m\b|km\b|"
    r"seconden|seconde|sekunden|sekunde|seconds?|secs?|sec\b|s\b|minuten|minuut|minutes?|mins?|min\b|minute)", re.I)


def lees_getal(token, taal):
    """'1,214' (en) -> 1214, '7,5' (nl) -> 7.5, '1.056' (de) -> 1056."""
    t = re.sub(r"(?<=\d)[ ](?=\d{3}\b)", "", token)
    if "." in t and "," in t:
        decimaal = "." if t.rfind(".") > t.rfind(",") else ","
        t = t.replace("," if decimaal == "." else ".", "").replace(",", ".")
    elif "," in t:
        stukken = t.split(",")
        if taal == "en" or (len(stukken) > 2):
            t = t.replace(",", "") if all(len(s) == 3 for s in stukken[1:]) else t.replace(",", ".", 1).replace(",", "")
        else:
            t = t.replace(",", ".")
    elif "." in t:
        stukken = t.split(".")
        if taal != "en" and all(len(s) == 3 for s in stukken[1:]):
            t = t.replace(".", "")
        elif len(stukken) > 2:
            t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return None


def getallen(tekst, taal):
    """[(getal, eenheid of None)] in volgorde. Een getal vlak voor '×' (zoals '2 × 810 m')
    of in een bereik als '54-77' telt niet als losse waarde."""
    uit = []
    for m in re.finditer(r"(?<![\w.,])(\d+(?:[.,  ]\d+)*)", tekst or ""):
        na = tekst[m.end():m.end() + 6]
        if re.match(r"\s*[×x*]\s*\d", na, re.I):
            continue
        n = lees_getal(m.group(1).strip(), taal)
        if n is None:
            continue
        e = EENHEID.match(tekst, m.end())
        uit.append((n, e.group(1).lower() if e else None))
    return uit


def meter(tekst, taal, standaard=None):
    for n, e in getallen(tekst, taal):
        if e in ("ft", "feet", "foot", "'"):
            return n * VOET
        if e in ("m", "meter", "meters", "metre", "metres", "mtr"):
            return n
        if e == "km":
            return n * 1000
        if e is None and standaard == "m":
            return n
        if e is None and standaard == "ft":
            return n * VOET
    return None


def kmu(tekst, taal, standaard=None):
    for n, e in getallen(tekst, taal):
        if e in ("km/h", "km/u", "kmh", "kph", "km/st"):
            return n
        if e == "mph":
            return n * MIJL
        if e == "m/s":
            return n * 3.6
        if e is None and standaard == "kmh":
            return n
        if e is None and standaard == "mph":
            return n * MIJL
    return None


def seconden(tekst, taal):
    """'0:28' -> 28, '2 min 30 s' -> 150, '130 seconden' -> 130, '2½ minutes' -> 150."""
    t = (tekst or "").replace("½", ".5").replace("¼", ".25").replace("¾", ".75")
    m = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", t)
    if m:
        if m.group(3):
            return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3))
        return int(m.group(1)) * 60 + int(m.group(2))
    totaal, gevonden = 0.0, False
    for n, e in getallen(t, taal):
        if e and e.startswith("min"):
            totaal += n * 60
            gevonden = True
        elif e and e[0] == "s":
            totaal += n
            gevonden = True
    if gevonden:
        return round(totaal)
    kaal = getallen(t, taal)
    if len(kaal) == 1 and kaal[0][1] is None:
        n = kaal[0][0]
        return round(n * 60) if n < 10 else round(n)  # '2' is twee minuten, '120' seconden
    return None


def heel_getal(tekst, taal):
    t = (tekst or "").strip().lower()
    if re.match(r"^(none|geen|keine|nein|no|0)\b", t):
        return 0
    g = getallen(t, taal)
    return int(g[0][0]) if g and g[0][0] == int(g[0][0]) else None


JAAR = re.compile(r"(?<!\d)(18[5-9]\d|19\d\d|20\d\d)(?!\d)")


def jaren(tekst):
    return [int(j) for j in JAAR.findall(tekst or "")]


STATUS = [
    ("gepland", re.compile(r"under construction|in construction|announced|planned|proposed|in development|in aanbouw|aangekondigd|gepland|voorgesteld|im bau|geplant|in planung", re.I)),
    ("gesloten", re.compile(r"removed|closed|demolished|defunct|sbno|standing but not|not operating|relocated|destroyed|dismantled|"
                            r"gesloten|afgebroken|verwijderd|gesloopt|verplaatst|buiten gebruik|buiten dienst|"
                            r"geschlossen|abgerissen|abgebaut|au(ss|ß)er betrieb|stillgelegt|entfernt", re.I)),
    ("open", re.compile(r"operating|open|in operation|geopend|in gebruik|in bedrijf|operationeel|in betrieb|ge(ö|oe)ffnet", re.I)),
]


def status_van(tekst):
    """De status die als eerste in de tekst staat: 'Operating (closed 2019-2020 for
    refurbishment)' is open."""
    t = schoon(tekst)
    gevonden = [(m.start(), status) for status, patroon in STATUS for m in [patroon.search(t)] if m]
    return min(gevonden)[1] if gevonden else None


# ---------------------------------------------------------------------------
# Het informatieblok per taal
# ---------------------------------------------------------------------------

def _p(blok, *sleutels):
    """Eerste niet-lege parameter (als platte tekst)."""
    for s in sleutels:
        w = blok.get(s)
        if w is not None and schoon(w):
            return schoon(w)
    return None


def naam_sleutel(naam):
    import unicodedata
    s = unicodedata.normalize("NFKD", str(naam or "")).casefold()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(re.findall(r"\w+", s))


def _kies_blok(blokken, park_namen):
    """Het blok van het park waar onze baan staat; anders het enige blok, anders het blok
    dat nog open is."""
    sleutels = {naam_sleutel(p) for p in park_namen if p}
    sleutels.discard("")
    if sleutels:
        for b in blokken:
            loc = naam_sleutel(_p(b, "location", "locatie", "freizeitpark") or "")
            if loc and any(s in loc or loc in s for s in sleutels):
                return b
    if len(blokken) == 1:
        return blokken[0]
    open_ = [b for b in blokken if status_van(b.get("status") or "") == "open"]
    return open_[-1] if len(open_) == 1 else None


def naam_van(tekst):
    """Eerste regel, zonder toelichting tussen haakjes: 'Vekoma\n(renovatie 2018: CSM)' -> 'Vekoma'."""
    if not tekst:
        return None
    t = re.sub(r"\([^)]*\)", "", tekst.split("\n")[0]).strip(" ,;–-")
    return t or None


GEEN_MODEL = re.compile(r"^(custom|custom design|aangepast|maatwerk|uniek|individuell|sonderanfertigung|prototyp[e]?|unique|one[- ]of[- ]a[- ]kind|n/?a|unknown|onbekend|unbekannt|-)$", re.I)


def model_van(tekst):
    t = naam_van(tekst)
    return None if not t or GEEN_MODEL.match(t) else t


def lees_infobox(tekst, taal, park_namen=()):
    """Gegevens uit het informatieblok, of None als er geen achtbaan-informatieblok is.
    park_namen: de naam (of namen) van het park waar onze baan staat, om bij een baan die
    in meer parken heeft gestaan het goede blok te kiezen."""
    gevonden = vind_infobox(tekst)
    if not gevonden:
        return None
    _, blokken = gevonden
    hoofd = blokken[0]
    blok = _kies_blok(blokken, park_namen) if len(blokken) > 1 else hoofd
    uit = {}

    def zet(veld, waarde):
        if waarde is not None and waarde != "":
            uit[veld] = waarde

    if taal == "en":
        zet("hoogte", meter(_p(hoofd, "height_m"), taal, "m") or meter(_p(hoofd, "height_ft"), taal, "ft") or meter(_p(hoofd, "height"), taal))
        zet("valhoogte", meter(_p(hoofd, "drop_m"), taal, "m") or meter(_p(hoofd, "drop_ft"), taal, "ft") or meter(_p(hoofd, "drop"), taal))
        zet("lengte", meter(_p(hoofd, "length_m"), taal, "m") or meter(_p(hoofd, "length_ft"), taal, "ft") or meter(_p(hoofd, "length"), taal))
        zet("snelheid", kmu(_p(hoofd, "speed_km/h", "speed_kmh", "speed_kph"), taal, "kmh") or kmu(_p(hoofd, "speed_mph"), taal, "mph") or kmu(_p(hoofd, "speed"), taal))
        zet("inversies", heel_getal(_p(hoofd, "inversions"), taal))
        zet("duur", seconden(_p(hoofd, "duration"), taal))
        zet("fabrikant", naam_van(_p(hoofd, "manufacturer")))
        zet("model", model_van(_p(hoofd, "model")))
        zet("type", " ".join(x for x in (_p(hoofd, "type"), _p(hoofd, "type2"), _p(hoofd, "type3"), _p(hoofd, "track")) if x) or None)
    elif taal == "nl":
        zet("hoogte", meter(_p(hoofd, "hoogte"), taal, "m"))
        zet("valhoogte", meter(_p(hoofd, "valhoogte", "drop", "val"), taal, "m"))
        zet("lengte", meter(_p(hoofd, "lengte", "baanlengte"), taal, "m"))
        zet("snelheid", kmu(_p(hoofd, "snelheid", "topsnelheid"), taal, "kmh"))
        zet("inversies", heel_getal(_p(hoofd, "inversies"), taal))
        zet("duur", seconden(_p(hoofd, "duur", "ritduur"), taal))
        zet("fabrikant", naam_van(_p(hoofd, "bouwer", "fabrikant")))
        zet("model", model_van(_p(hoofd, "model")))
        zet("type", _p(hoofd, "type"))
    elif taal == "de":
        zet("hoogte", meter(_p(hoofd, "höhe", "hoehe"), taal, "m"))
        zet("valhoogte", meter(_p(hoofd, "abfahrt", "gefälle", "fallhöhe"), taal, "m"))
        zet("lengte", meter(_p(hoofd, "länge", "laenge", "streckenlänge"), taal, "m"))
        zet("snelheid", kmu(_p(hoofd, "geschwindigkeit", "höchstgeschwindigkeit"), taal, "kmh"))
        zet("inversies", heel_getal(_p(hoofd, "inversionen"), taal))
        zet("duur", seconden(_p(hoofd, "fahrzeit", "fahrdauer"), taal))
        zet("fabrikant", naam_van(_p(hoofd, "hersteller")))
        zet("model", model_van(_p(hoofd, "modell")))
        zet("type", " ".join(x for x in (_p(hoofd, "typ"), _p(hoofd, "kategorie"), _p(hoofd, "antriebsart")) if x) or None)
    else:
        return None

    # Opening, sluiting, status en park: uit het blok van ons park
    if blok is not None:
        if taal == "en":
            open_t, dicht_t, status_t, park_t = _p(blok, "opened", "year"), _p(blok, "closed"), _p(blok, "status"), _p(blok, "location")
        elif taal == "nl":
            open_t, dicht_t, status_t, park_t = _p(blok, "opening"), _p(blok, "sluiting") or _p(blok, "afbraak"), _p(blok, "status"), _p(blok, "locatie")
        else:
            open_t, dicht_t, status_t, park_t = _p(blok, "eröffnung", "eroeffnung"), _p(blok, "schließung", "schliessung"), _p(blok, "status"), _p(blok, "freizeitpark")
        zet("geopend", min(jaren(open_t)) if jaren(open_t) else None)
        zet("gesloten", max(jaren(dicht_t)) if jaren(dicht_t) else None)
        status = status_van(status_t or "") if status_t else None
        if not status and uit.get("gesloten"):
            status = "gesloten"
        if status == "open":
            uit.pop("gesloten", None)  # een sluiting bij een open baan hoort bij een oude naam of een oud spoor
        zet("status", status)
        if park_t:
            zet("park", park_t.split("\n")[0].split(",")[0].strip())

    # Vorige parken: de andere blokken (Engels), of 'vorigelocatie' (Nederlands)
    vorige = []
    for b in blokken:
        if b is blok or blok is None:
            continue
        p = _p(b, "location", "locatie", "freizeitpark")
        if p and status_van(b.get("status") or "") != "open":  # een andere baan van hetzelfde model die nog open is, telt niet
            o, d = jaren(_p(b, "opened", "year") or ""), jaren(_p(b, "closed") or "")
            vorige.append({"park": p.split("\n")[0].split(",")[0].strip(), "van": min(o) if o else None, "tot": max(d) if d else None})
    if taal == "nl" and _p(hoofd, "vorigelocatie"):
        for p in re.split(r"\n|;", _p(hoofd, "vorigelocatie")):
            p = re.sub(r"\(.*?\)", "", p).strip(" ,")
            if p:
                vorige.append({"park": p, "van": None, "tot": None})
    if vorige:
        uit["vorigeParken"] = vorige
    return uit
