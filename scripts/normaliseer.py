"""Namen, types, fabrikanten en landen gelijk maken, en onmogelijke waarden eruit filteren.

Elke bron schrijft dingen net anders ("Intamin AG", "Intamin Amusement Rides";
"Volksrepubliek China", "China"; "Steel – Launched", "Lanceerachtbaan"). Hier
wordt dat één vorm, zodat filteren en tellen klopt.
"""
import datetime
import re
import unicodedata


def sleutel(tekst):
    """Vergelijkbare vorm: zonder accenten, hoofdletters en leestekens."""
    s = unicodedata.normalize("NFKD", str(tekst or "")).casefold()
    s = "".join(c for c in s if not unicodedata.combining(c))
    return "".join(re.findall(r"\w+", s))


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------
# Van specifiek naar algemeen. Het eerste type waarvan het patroon past, telt.
# De tekst komt uit Wikidata (type, materiaal), Wikipedia (type, model) en OSM.
TYPES = [
    ("Alpine coaster", r"alpine?[\s-]*(coaster|bob|achtbaan)|mountain[\s-]*coaster|alpenbob|alpenachterbahn|sommerrodel|rodelbahn|zomerrodel|coaster[\s-]*alpin|\bluge\b|summer[\s-]*toboggan|^\s*(alpine|mountain)\s*$"),
    ("Waterachtbaan", r"water[\s-]*(coaster|achtbaan)|wasserachterbahn|waterachtbaan|aqua[\s-]*coaster"),
    ("Wilde muis", r"wild[\s-]*(e[\s-]*)?m(ouse|uis|aus)|wildemuis|crazy[\s-]*mouse|mad[\s-]*mouse|maus[\s-]*achterbahn"),
    ("Draaiende achtbaan", r"spinn(ing|er)|draaiende|drehende|pandemonium|spinning[\s-]*coaster|tollende"),
    ("Bobsleebaan", r"bob[\s-]*sle(d|igh|e)|bobslee|\bbobbahn"),
    ("Mijntreinachtbaan", r"mine[\s-]*train|mijntrein|grubenbahn|minenbahn"),
    ("Vliegende achtbaan", r"flying|vliegende|fliegende|flug"),
    ("Hangende achtbaan", r"suspended(?![\s-]*looping)|hangende(?![\s-]*looping)|swinging|schwingend"),
    ("Omgekeerde achtbaan", r"invert|omgekeerde|suspended[\s-]*looping|\bslc\b|hängend|hangend"),
    ("Wing coaster", r"\bwing\b"),
    ("Duikachtbaan", r"\bdive\b|duikachtbaan|\bduik|dive[\s-]*machine|dive[\s-]*coaster|sturzflug"),
    ("Staande achtbaan", r"stand[\s-]*up|staande|stehend"),
    ("Vloerloze achtbaan", r"floorless|vloerloze|bodenlos"),
    ("4D-achtbaan", r"4th[\s-]*dimension|\b4[\s-]*d\b|vierdimensionale|free[\s-]*spin|zacspin|wing[\s-]*rider"),
    ("Motorachtbaan", r"motor[\s-]*(bike|cycle|fiets|rad)"),
    ("Boomerang", r"boomerang"),
    ("Shuttleachtbaan", r"shuttle"),
    ("Lanceerachtbaan", r"launch|lanceer|accelerator|katapult|catapult|linear[\s-]*induction|\blsm\b|\blim\b|hydraulic|impulse"),
    ("Hypercoaster", r"hyper|giga[\s-]*coaster|strata|mega[\s-]*coaster|megacoaster"),
    ("Kinderachtbaan", r"kidd(ie|y)|kinderachtbaan|kinderachterbahn|wacky[\s-]*worm|big[\s-]*apple|dragon[\s-]*wagon|mini[\s-]*coaster|kinder"),
    ("Familieachtbaan", r"famil|junior[\s-]*coaster|tivoli|roller[\s-]*skater|family[\s-]*coaster"),
    ("Aangedreven achtbaan", r"powered|gemotoriseerd|aangedreven|power[\s-]*coaster|motorisiert"),
    ("Indoorachtbaan", r"indoor|overdekte|enclosed|dark[\s-]*coaster|in[\s-]*the[\s-]*dark|space[\s-]*mountain|im[\s-]*dunkeln"),
    ("Race-achtbaan", r"duel|race[\s-]*(achtbaan|coaster)|racing|m[öo]bius|tweelingachtbaan|twin[\s-]*(track|coaster)"),
    ("Single-rail-achtbaan", r"single[\s-]*rail|raptor[\s-]*track"),
]
MATERIAAL = [
    ("Hybride achtbaan", r"hybrid|hybride|i[\s-]*box|topper[\s-]*track"),
    ("Houten achtbaan", r"\bwood|houten|\bhout\b|\bholz"),
    ("Stalen achtbaan", r"steel|stalen|\bstaal\b|\bstahl|metaal|metal"),
]
TYPES_RE = [(t, re.compile(p, re.I)) for t, p in TYPES]
MATERIAAL_RE = [(t, re.compile(p, re.I)) for t, p in MATERIAAL]
ALLE_TYPES = [t for t, _ in TYPES] + [t for t, _ in MATERIAAL] + ["Achtbaan"]


def soort_uit(tekst):
    """(specifiek type of None, materiaal-type of None) uit een tekst."""
    t = str(tekst or "")
    specifiek = next((naam for naam, p in TYPES_RE if p.search(t)), None)
    materiaal = next((naam for naam, p in MATERIAAL_RE if p.search(t)), None)
    return specifiek, materiaal


def kies_type(teksten_per_bron):
    """teksten_per_bron: [(bron, tekst)] in volgorde van voorrang. Het specifieke type
    komt van de eerste bron die er een noemt; anders het materiaal; anders 'Achtbaan'.
    Geeft (type, bron)."""
    for bron, tekst in teksten_per_bron:
        s, _ = soort_uit(tekst)
        if s:
            return s, bron
    for bron, tekst in teksten_per_bron:
        _, m = soort_uit(tekst)
        if m:
            return m, bron
    return "Achtbaan", None


# Labels uit Wikidata die geen model zijn maar een soort, of iets algemeens
GEEN_MODEL = re.compile(
    r"^(achtbaan|attractie|roller ?coaster|montagnes? russes?.*|achterbahn|voorgesteld bouwwerk|draaimolen|"
    r"stalen achtbaan|houten achtbaan|.*achtbaan|.*coaster type|kermisattractie|pretparkattractie)$", re.I)


def model_uit_label(label):
    """Een Wikidata-type als 'Vekoma Boomerang' of 'Invertigo' is eigenlijk een model."""
    t = re.sub(r"\s*\((roller coaster|achtbaan|achterbahn)\)\s*$", "", str(label or ""), flags=re.I).strip()
    if not t or GEEN_MODEL.match(t):
        return None
    s, m = soort_uit(t)
    if (s or m) and sleutel(t) in {sleutel(x) for x in ALLE_TYPES} | {"stalenachtbaan", "steelrollercoaster", "woodenrollercoaster", "launchedrollercoaster", "invertedrollercoaster", "wildmouse", "kiddiecoaster", "shuttleachtbaan", "hypercoaster", "floorlesscoaster", "wingcoaster", "bobsleeachtbaan", "wildemuisachtbaan", "familyboomerang"}:
        return None
    return t


# ---------------------------------------------------------------------------
# Fabrikanten
# ---------------------------------------------------------------------------
FABRIKANTEN = [
    (r"bolliger|^b\s*&\s*m$|^b&m\b", "Bolliger & Mabillard"),
    (r"vekoma", "Vekoma"),
    (r"intamin", "Intamin"),
    (r"^mack\b|mack rides|heinrich mack", "Mack Rides"),
    (r"gerstlauer", "Gerstlauer"),
    (r"zierer", "Zierer"),
    (r"zamperla", "Zamperla"),
    (r"maurer", "Maurer Rides"),
    (r"schwarzkopf", "Schwarzkopf"),
    (r"arrow dynamics|^arrow( huss)?$", "Arrow Dynamics"),
    (r"arrow development", "Arrow Development"),
    (r"rocky mountain construction|^rmc$", "Rocky Mountain Construction"),
    (r"great coasters|^gci$", "Great Coasters International"),
    (r"gravity group", "The Gravity Group"),
    (r"premier rides", "Premier Rides"),
    (r"^s\s*&\s*s\b|s&s worldwide|s&s power|s&s.*sansei", "S&S Worldwide"),
    (r"custom coasters", "Custom Coasters International"),
    (r"philadelphia toboggan", "Philadelphia Toboggan Coasters"),
    (r"pinfari", "Pinfari"),
    (r"\bsbf\b|sbf[\s-]*visa", "SBF Visa Group"),
    (r"^togo\b", "Togo"),
    (r"chance (rides|morgan)|^chance$", "Chance Rides"),
    (r"d\.?\s*h\.?\s*morgan", "D. H. Morgan Manufacturing"),
    (r"e\s*&\s*f miler", "E&F Miler Industries"),
    (r"sunkid", "Sunkid"),
    (r"wiegand", "Wiegand"),
    (r"preston\s*(&|and)\s*barbieri", "Preston & Barbieri"),
    (r"reverchon", "Reverchon Industries"),
    (r"hopkins", "Hopkins Rides"),
    (r"dinn corp", "Dinn Corporation"),
    (r"giovanola", "Giovanola"),
    (r"golden horse", "Golden Horse"),
    (r"jinma", "Jinma Rides"),
    (r"shibaolai", "Beijing Shibaolai"),
    (r"fabbri", "Fabbri Group"),
    (r"soquet", "Soquet"),
    (r"l\s*&\s*t systems", "L&T Systems"),
    (r"hafema", "Hafema"),
    (r"brandauer", "Brandauer"),
    (r"\beos\b", "EOS Rides"),
    (r"art engineering", "ART Engineering"),
    (r"martin\s*(&|en|and)\s*vleminckx", "Martin & Vleminckx"),
    (r"dynamic structures", "Dynamic Structures"),
    (r"national amusement device", "National Amusement Devices"),
    (r"allan herschell", "Allan Herschell Company"),
    (r"meisho|sanoyas", "Sanoyas Hishino Meisho"),
    (r"senyo", "Senyo Kogyo"),
    (r"sansei", "Sansei Technologies"),
    (r"hoei", "Hoei Sangyo"),
    (r"caripro", "Caripro"),
    (r"kumbak", "Kumbak"),
    (r"skyline attractions", "Skyline Attractions"),
    (r"\babc rides\b", "ABC Rides"),
    (r"\bdal\b", "DAL Amusement Rides"),
    (r"sartori", "Sartori Rides"),
    (r"interpark", "Interpark"),
    (r"\bhuss\b", "Huss Rides"),
    (r"miler coaster", "Miler Coaster Company"),
    (r"o\.?\s*d\.?\s*hopkins", "Hopkins Rides"),
    (r"roller coaster corporation of america", "Roller Coaster Corporation of America"),
]
FABRIKANTEN_RE = [(re.compile(p, re.I), naam) for p, naam in FABRIKANTEN]
# Wat Wikidata soms als fabrikant noemt, maar geen achtbaanbouwer is (eigenaar, ontwerper, aannemer)
GEEN_FABRIKANT = re.compile(
    r"taft broadcasting|six flags|herschend|hensel phelps|british rail|werner stengel|cedar fair|walt disney|"
    r"\bdisney\b|universal (parks|studios)|merlin entertainments|imagineering|stengel engineering|"
    r"^(onbekend|unknown|unbekannt|diverse|various)$", re.I)
RECHTSVORM = re.compile(r"[\s,]+(gmbh(\s*&\s*co\.?\s*kg)?|ag|inc\.?|ltd\.?|llc|b\.?v\.?|s\.?p\.?a\.?|s\.?r\.?l\.?|co\.?|company|corp\.?)$", re.I)


def fabrikant(naam):
    t = re.sub(r"\s+", " ", str(naam or "")).strip(" ,;")
    if not t or GEEN_FABRIKANT.search(t):
        return None
    for p, canoniek in FABRIKANTEN_RE:
        if p.search(t):
            return canoniek
    kaal = RECHTSVORM.sub("", t).strip()
    return kaal or t


# ---------------------------------------------------------------------------
# Landen: altijd de gewone Nederlandse naam
# ---------------------------------------------------------------------------
LANDEN = {
    "volksrepubliekchina": "China", "chinesevolksrepubliek": "China", "peoplesrepublicofchina": "China",
    "verenigdestatenvanamerika": "Verenigde Staten", "unitedstates": "Verenigde Staten", "unitedstatesofamerica": "Verenigde Staten", "vs": "Verenigde Staten",
    "koninkrijkdernederlanden": "Nederland", "netherlands": "Nederland",
    "verenigdkoninkrijkvangrootbrittannienennoordierland": "Verenigd Koninkrijk", "unitedkingdom": "Verenigd Koninkrijk", "grootbrittannie": "Verenigd Koninkrijk",
    "republiekchina": "Taiwan", "republicofchina": "Taiwan",
    "russischefederatie": "Rusland", "russia": "Rusland",
    "republiekkorea": "Zuid-Korea", "southkorea": "Zuid-Korea", "korea": "Zuid-Korea",
    "democratischevolksrepubliekkorea": "Noord-Korea",
    "bondsrepubliekduitsland": "Duitsland", "germany": "Duitsland", "deutschland": "Duitsland",
    "france": "Frankrijk", "belgium": "België", "belgique": "België", "spain": "Spanje", "italy": "Italië",
    "japan": "Japan", "canada": "Canada", "australia": "Australië", "denmark": "Denemarken", "sweden": "Zweden",
    "poland": "Polen", "finland": "Finland", "austria": "Oostenrijk", "switzerland": "Zwitserland", "norway": "Noorwegen",
    "unitedarabemirates": "Verenigde Arabische Emiraten", "saudiarabia": "Saoedi-Arabië", "czechrepublic": "Tsjechië", "tsjechischerepubliek": "Tsjechië",
}


def land(naam):
    t = re.sub(r"\s+", " ", str(naam or "")).strip()
    return LANDEN.get(sleutel(t), t) if t else None


# ---------------------------------------------------------------------------
# Namen
# ---------------------------------------------------------------------------
TOEVOEGING_ALGEMEEN = re.compile(r"^(roller ?coaster|achtbaan|achterbahn|montagnes? russes|coaster|attraction|attractie|ride)$", re.I)
TOEVOEGING_GEPLAND = re.compile(r"^(im bau|in aanbouw|coming soon|under construction|en construction|geplant|gepland)$", re.I)


def naam(tekst, park=None):
    """Nette naam: rechte aanhalingstekens, geen dubbele spaties, en zonder een toevoeging
    tussen haakjes die alleen het park of 'roller coaster' noemt.
    Geeft (naam, gepland) - gepland is True als er '(im Bau)' of zoiets achter stond."""
    t = str(tekst or "")
    t = t.replace("’", "'").replace("‘", "'").replace("‛", "'").replace("`", "'").replace("´", "'")
    t = t.replace("“", '"').replace("”", '"').replace("„", '"')
    t = re.sub(r"\s+", " ", t).strip()
    gepland = False
    m = re.match(r"^(.*\S)\s*\(([^()]*)\)$", t)
    if m:
        binnen = m.group(2).strip()
        if TOEVOEGING_ALGEMEEN.match(binnen):
            t = m.group(1)
        elif TOEVOEGING_GEPLAND.match(binnen):
            t, gepland = m.group(1), True
        elif park and binnen and (sleutel(binnen) in sleutel(park) or sleutel(park) in sleutel(binnen)) and len(sleutel(binnen)) >= 4:
            t = m.group(1)
    return t.strip(), gepland


# ---------------------------------------------------------------------------
# Onmogelijke waarden
# ---------------------------------------------------------------------------
GRENZEN = {
    "hoogte": (1, 200),       # Falcon's Flight is zo'n 195 meter
    "valhoogte": (1, 200),
    "lengte": (10, 5000),     # Falcon's Flight is ruim 4 km
    "snelheid": (5, 260),     # km/u
    "inversies": (0, 14),     # het record is 14
    "duur": (10, 900),        # seconden
}
AFRONDEN = {"hoogte": 1, "valhoogte": 1, "lengte": 0, "snelheid": 0, "inversies": 0, "duur": 0}


def getal(veld, waarde):
    """Afgerond en binnen de grenzen, anders None."""
    try:
        n = float(waarde)
    except (TypeError, ValueError):
        return None
    laag, hoog = GRENZEN[veld]
    if not laag <= n <= hoog:
        return None
    n = round(n, AFRONDEN[veld])
    return int(n) if AFRONDEN[veld] == 0 else n


def jaar(veld, waarde):
    try:
        j = int(waarde)
    except (TypeError, ValueError):
        return None
    dit_jaar = datetime.date.today().year
    hoogst = dit_jaar + 6 if veld == "geopend" else dit_jaar
    return j if 1850 <= j <= hoogst else None


def samen_onmogelijk(a):
    """Velden die samen niet kunnen. Geeft de velden die weg moeten."""
    weg = []
    h, v, l = a.get("hoogte"), a.get("valhoogte"), a.get("lengte")
    if h and v and v > h + 40:
        weg.append("valhoogte")  # een val kan iets onder de grond doorgaan, maar niet 40 meter
    if h and l and l < h * 1.5:
        weg.append("lengte")  # het spoor is altijd langer dan de baan hoog is
    if a.get("geopend") and a.get("gesloten") and a["gesloten"] < a["geopend"]:
        weg.append("gesloten")
    return weg
