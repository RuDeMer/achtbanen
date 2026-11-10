"""Tests voor het lezen van Wikipedia-informatieblokken en het gelijkmaken van gegevens.

Draaien: python3 scripts/test_gegevens.py
De voorbeelden hieronder zijn zelf geschreven, in de vorm van echte informatieblokken.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import haal_achtbanen as h  # noqa: E402
import normaliseer as n  # noqa: E402
import wikipedia as w  # noqa: E402

EN = """{{Short description|Test}}
{{Infobox roller coaster
| name = Testbaan <!-- commentaar -->
| image = Testbaan.jpg
| location = Testpark
| status = Removed
| opened = {{Start date|2005|5|21}}
| closed = {{End date|2024|11|10}}
| type = Steel
| type2 = Launched
| manufacturer = [[Intamin]]
| model = [[Accelerator Coaster]]
| height_ft = 456
| drop_ft = 418
| length_ft = 3,118
| speed_mph = 128
| inversions = 0
| duration = 0:28<ref>Bron</ref>
}}
Tekst."""

EN_VERHUISD = """{{Infobox roller coaster
| name = Reiziger
| location = Oud Park
| opened = April 4, 2004 (as Oude Naam)<br>2019
| status = Removed
| closed = January 6, 2019
| extend = {{Infobox roller coaster extend
| location = Nieuw Park
| opened = May 7, 2006
| status = Operating
| closed = April 8, 2018 (as Oude Naam)
}}
{{Infobox roller coaster extend
| location = Ander Park
| status = Operating
| opened = 2022
}}
| type = Steel
| length_ft = 800
| speed_mph = 28
}}"""

NL = """{{Infobox achtbaan
| naam = Testbaan
| locatie = {{NL-VLAG}} [[Testpark]]
| type = [[Stalen achtbaan|stalen]] [[duikachtbaan]]
| model = Custom
| bouwer = [[Bolliger & Mabillard]] <br>(renovatie 2018: iemand anders)
| status = Geopend
| opening = [[1 juli]] [[2015]]
| sluiting = 6 januari 2018 (oude baan)
| vorigelocatie = [[Oud Park]] (1990-2010)
| snelheid = 90 km/u
| lengte = 2 × 810 m
| hoogte = 30 meter<br /><small>(+ 7,5 meter onder de grond)</small>
| inversies = 2
| duur = 2 min
}}"""

DE = """{{Infobox Achterbahn
|BILD = Test.jpg
|FREIZEITPARK = [[Testpark]]
|TYP = [[Stahlachterbahn|Stahl]] – sitzend
|MODELL = Launch Coaster
|KATEGORIE = [[Launched Coaster]]
|HERSTELLER = [[Mack Rides]]
|ERÖFFNUNG = 4. April 2009
|LÄNGE = 1.056
|HÖHE = 38,5
|ABFAHRT = 
|GESCHWINDIGKEIT = 100
|FAHRZEIT = 2:20
|INVERSIONEN = 4
}}"""


class Infobox(unittest.TestCase):
    def test_engels(self):
        i = w.lees_infobox(EN, "en", ["Testpark"])
        self.assertAlmostEqual(i["hoogte"], 456 * 0.3048)
        self.assertAlmostEqual(i["valhoogte"], 418 * 0.3048)
        self.assertAlmostEqual(i["lengte"], 3118 * 0.3048)
        self.assertAlmostEqual(i["snelheid"], 128 * 1.609344)
        self.assertEqual((i["inversies"], i["duur"], i["geopend"], i["gesloten"], i["status"]), (0, 28, 2005, 2024, "gesloten"))
        self.assertEqual((i["fabrikant"], i["model"], i["park"]), ("Intamin", "Accelerator Coaster", "Testpark"))
        self.assertIn("Launched", i["type"])

    def test_engels_verhuisd(self):
        i = w.lees_infobox(EN_VERHUISD, "en", ["Nieuw Park"])
        self.assertEqual((i["park"], i["status"], i["geopend"]), ("Nieuw Park", "open", 2006))
        self.assertNotIn("gesloten", i)  # sluiting hoort bij de oude naam
        self.assertEqual(i["vorigeParken"], [{"park": "Oud Park", "van": 2004, "tot": 2019}])  # Ander Park is nog open: geen vorig park

    def test_nederlands(self):
        i = w.lees_infobox(NL, "nl", ["Testpark"])
        self.assertEqual((i["hoogte"], i["lengte"], i["snelheid"], i["inversies"], i["duur"]), (30, 810, 90, 2, 120))
        self.assertEqual((i["fabrikant"], i["geopend"], i["status"], i["park"]), ("Bolliger & Mabillard", 2015, "open", "Testpark"))
        self.assertNotIn("model", i)  # 'Custom' is geen model
        self.assertNotIn("gesloten", i)
        self.assertEqual(i["vorigeParken"][0]["park"], "Oud Park")

    def test_duits(self):
        i = w.lees_infobox(DE, "de", ["Testpark"])
        self.assertEqual((i["lengte"], i["hoogte"], i["snelheid"], i["duur"], i["inversies"]), (1056, 38.5, 100, 140, 4))
        self.assertEqual((i["fabrikant"], i["model"], i["geopend"]), ("Mack Rides", "Launch Coaster", 2009))
        self.assertNotIn("valhoogte", i)

    def test_geen_informatieblok(self):
        self.assertIsNone(w.lees_infobox("{{Infobox amusement park|name=Park}}", "en"))
        self.assertIsNone(w.lees_infobox("Gewone tekst", "nl"))

    def test_getallen(self):
        self.assertEqual(w.lees_getal("1,214", "en"), 1214)
        self.assertEqual(w.lees_getal("7,5", "nl"), 7.5)
        self.assertEqual(w.lees_getal("1.056", "de"), 1056)
        self.assertEqual(w.lees_getal("2.5", "en"), 2.5)
        self.assertEqual(w.meter("456 ft (139 m)", "en"), 456 * 0.3048)
        self.assertEqual(w.kmu("{{convert|128|mph|km/h}}", "en"), None)  # zonder schoon() geen eenheid
        self.assertAlmostEqual(w.kmu(w.schoon("{{convert|128|mph|km/h}}"), "en"), 128 * 1.609344)

    def test_duur(self):
        for tekst, sec in [("0:28", 28), ("1:32", 92), ("2 min 30 s", 150), ("130 seconden", 130), ("2½ minutes", 150),
                           ("approx. 1 minute 45 seconds", 105), ("ca. 2 Minuten", 120), ("90", 90), ("2", 120)]:
            self.assertEqual(w.seconden(tekst, "en"), sec, tekst)

    def test_status(self):
        for tekst, s in [("Operating", "open"), ("Operating (closed 2019-2020 for refurbishment)", "open"), ("Removed", "gesloten"), ("SBNO", "gesloten"), ("Under construction", "gepland"),
                         ("Geopend", "open"), ("Afgebroken", "gesloten"), ("In Betrieb", "open"), ("Abgerissen", "gesloten"), ("Im Bau", "gepland")]:
            self.assertEqual(w.status_van(tekst), s, tekst)


class Normaliseren(unittest.TestCase):
    def test_types(self):
        self.assertEqual(n.kies_type([("wd", "Stalen achtbaan"), ("wp:en", "Steel Launched")]), ("Lanceerachtbaan", "wp:en"))
        self.assertEqual(n.kies_type([("wd", "Houten achtbaan"), ("wp:en", "Steel")]), ("Houten achtbaan", "wd"))
        self.assertEqual(n.kies_type([("wd", "Attractie")]), ("Achtbaan", None))
        self.assertEqual(n.kies_type([("osm", "alpine")]), ("Alpine coaster", "osm"))
        self.assertEqual(n.soort_uit("Wildemuis-achtbaan")[0], "Wilde muis")
        self.assertEqual(n.soort_uit("Suspended Looping Coaster")[0], "Omgekeerde achtbaan")
        self.assertEqual(n.soort_uit("Hybride race-achtbaan"), ("Race-achtbaan", "Hybride achtbaan"))
        self.assertEqual(n.model_uit_label("Invertigo"), "Invertigo")
        self.assertIsNone(n.model_uit_label("Stalen achtbaan"))
        self.assertIsNone(n.model_uit_label("Attractie"))

    def test_fabrikanten(self):
        for ruw, goed in [("Intamin AG", "Intamin"), ("MACK Rides", "Mack Rides"), ("Vekoma Rides Manufacturing B.V.", "Vekoma"),
                          ("B&M", "Bolliger & Mabillard"), ("Anton Schwarzkopf", "Schwarzkopf"), ("Six Flags", None),
                          ("Werner Stengel", None), ("Onbekende Bouwer GmbH", "Onbekende Bouwer")]:
            self.assertEqual(n.fabrikant(ruw), goed, ruw)

    def test_landen(self):
        self.assertEqual(n.land("Volksrepubliek China"), "China")
        self.assertEqual(n.land("Nederland"), "Nederland")
        self.assertEqual(n.land("United States of America"), "Verenigde Staten")

    def test_namen(self):
        self.assertEqual(n.naam("Rock ’n’ Roller  Coaster"), ("Rock 'n' Roller Coaster", False))
        self.assertEqual(n.naam("Batman: Arkham Asylum (roller coaster)"), ("Batman: Arkham Asylum", False))
        self.assertEqual(n.naam("Space Mountain (Magic Kingdom)", "Magic Kingdom"), ("Space Mountain", False))
        self.assertEqual(n.naam("Wilde Hilde (im Bau)"), ("Wilde Hilde", True))
        self.assertEqual(n.naam('"Веселі гірки"'), ("Веселі гірки", False))
        self.assertEqual(n.naam('Big "Bad" Wolf'), ('Big "Bad" Wolf', False))
        self.assertEqual(n.naam("Wood Coaster (Mountain Flyer)", "Knight Valley"), ("Wood Coaster (Mountain Flyer)", False))

    def test_grenzen(self):
        self.assertEqual(n.getal("hoogte", 138.9888), 139.0)
        self.assertEqual(n.getal("snelheid", 205.99), 206)
        self.assertIsNone(n.getal("hoogte", 456))  # waarschijnlijk voet in plaats van meter
        self.assertIsNone(n.getal("inversies", 30))
        self.assertIsNone(n.jaar("geopend", 1700))
        self.assertEqual(n.samen_onmogelijk({"hoogte": 20, "valhoogte": 80, "lengte": 25}), ["valhoogte", "lengte"])


class Fotos(unittest.TestCase):
    def info(self, breed=4000, hoog=2500, mime="image/jpeg", vrij=True):
        return {"breed": breed, "hoog": hoog, "mime": mime, "vrij": vrij, "licentie": "CC BY-SA 4.0", "maker": "Iemand"}

    def test_oordeel(self):
        self.assertEqual(h.foto_oordeel("Baron 1898 (2015).jpg", self.info()), 2)
        self.assertEqual(h.foto_oordeel("Baron 1898 staand.jpg", self.info(2000, 3000)), 1)  # staand: tweede keus
        self.assertEqual(h.foto_oordeel("Baron 1898 construction 2014.jpg", self.info()), 1)
        self.assertEqual(h.foto_oordeel("Baron 1898 train.jpg", self.info()), 1)
        self.assertEqual(h.foto_oordeel("Efteling logo.jpg", self.info()), 0)
        self.assertEqual(h.foto_oordeel("Baron 1898 entrance sign.jpg", self.info()), 0)
        self.assertEqual(h.foto_oordeel("Food stand near Baron 1898.jpg", self.info()), 0)
        self.assertEqual(h.foto_oordeel("Baron 1898.png", self.info(mime="image/png")), 1)  # png: tweede keus
        self.assertEqual(h.foto_oordeel("Baron 1898.gif", self.info(mime="image/gif")), 0)
        # Woorden uit de naam van de baan zijn geen afkeurwoord
        self.assertEqual(h.foto_oordeel("Ravine Flyer II.jpg", self.info(2560, 1920)), 0)
        self.assertEqual(h.foto_oordeel("Ravine Flyer II.jpg", self.info(2560, 1920), "Ravine Flyer II Waldameer"), 2)
        self.assertEqual(h.foto_oordeel("Icon at Pleasure Beach.jpg", self.info(3024, 3780), "Icon Pleasure Beach Blackpool"), 1)
        self.assertEqual(h.foto_oordeel("Freedom Flyer entrance.jpg", self.info(), "Freedom Flyer"), 0)
        # Klein of vanuit het treintje: alleen als er niets beters is
        self.assertEqual(h.foto_oordeel("Green Dragon.jpg", self.info(300, 184)), 1)
        self.assertEqual(h.foto_oordeel("Green Dragon.jpg", self.info(200, 150)), 0)
        self.assertEqual(h.foto_oordeel("Mine-Cart Madness on-ride view.jpg", self.info()), 1)
        self.assertEqual(h.foto_oordeel("Baron 1898.jpg", self.info(vrij=False)), 0)
        self.assertEqual(h.foto_oordeel("Baron 1898.jpg", None), 0)

    def test_foto_info(self):
        pagina = {"title": "File:X.jpg", "imageinfo": [{"width": 1600, "height": 1200, "mime": "image/jpeg", "extmetadata": {
            "LicenseShortName": {"value": "CC BY 2.0"}, "Artist": {"value": '<a href="//x">Jan &amp; Piet</a>'}}}],
            "coordinates": [{"lat": 51.65, "lon": 5.05}]}
        i = h.foto_info(pagina)
        self.assertEqual((i["maker"], i["licentie"], i["vrij"], i["lat"]), ("Jan & Piet", "CC BY 2.0", True, 51.65))
        niet = {"imageinfo": [{"extmetadata": {"LicenseShortName": {"value": "Fair use"}, "NonFree": {"value": "true"}}}]}
        self.assertFalse(h.foto_info(niet)["vrij"])


class Rapport(unittest.TestCase):
    def test_rapport(self):
        import rapport
        banen = [
            {"id": "Q1", "naam": "A", "status": "open", "land": "Nederland", "park": "P", "foto": "a.jpg", "hoogte": 30,
             "type": "Houten achtbaan", "bron": {"hoogte": "wd", "type": "wp:en"}},
            {"id": "Q2", "naam": "B", "status": "open", "land": "Nederland", "park": "P", "type": "Achtbaan", "bron": {"park": "osm"}},
            {"id": "Q3", "naam": "C", "status": "gesloten", "land": "Duitsland", "hoogte": 12, "lat": 1, "lon": 2},
            {"id": "Q4", "naam": "D", "status": "gepland"},
        ]
        tel = {"foto_liggend": 1, "foto_p18": 1}
        r = rapport.maak_rapport(banen, tel, "2026-11-10", vorige={"velden": {"foto": {"procent": 20.0}}}, meldingen=["OSM weg"])
        self.assertEqual(r["totaal"], 4)
        self.assertEqual(r["velden"]["foto"]["procent"], 25.0)
        self.assertEqual(r["velden"]["foto"]["procentOpen"], 50.0)
        self.assertEqual(r["velden"]["foto"]["vorige"], 20.0)
        self.assertEqual(r["velden"]["hoogte"]["aantal"], 2)
        self.assertEqual(r["velden"]["type"]["aantal"], 1)  # "Achtbaan" telt niet als type
        self.assertEqual(r["velden"]["plek"]["aantal"], 1)
        self.assertEqual((r["landen"], r["parken"]), (2, 1))
        self.assertEqual(r["bronnen"], {"wd": 1, "wp:en": 1, "osm": 1})
        self.assertEqual(r["perStatus"], {"open": 2, "gesloten": 1, "gepland": 1})
        md = rapport.markdown(r)
        self.assertIn("| Foto | 1 | 25,0 % | 50,0 % | +5,0 % |", md)
        self.assertIn("### Let op", md)
        self.assertIn("- OSM weg", md)
        self.assertIn("Wikidata (P18) 1", md)

    def test_samenvatting_op_github(self):
        import os, tempfile, json, rapport
        with tempfile.TemporaryDirectory() as map_:
            samen = os.path.join(map_, "samenvatting.md")
            pad = os.path.join(map_, "rapport.json")
            os.environ["GITHUB_STEP_SUMMARY"] = samen
            try:
                rapport.schrijf(rapport.maak_rapport([{"id": "Q1", "naam": "A", "status": "open"}], {}, "2026-11-10"), pad)
                rapport.meld_mislukt("Wikidata gaf geen antwoord.")
            finally:
                del os.environ["GITHUB_STEP_SUMMARY"]
            self.assertEqual(json.load(open(pad, encoding="utf-8"))["totaal"], 1)
            tekst = open(samen, encoding="utf-8").read()
            self.assertIn("## Kwaliteit van de gegevens", tekst)
            self.assertIn("**Let op:** Wikidata gaf geen antwoord.", tekst)


if __name__ == "__main__":
    unittest.main(verbosity=1)
