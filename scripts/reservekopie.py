#!/usr/bin/env python3
"""Supabase controleren en een reservekopie maken van de accounts en credits.

  python3 scripts/reservekopie.py controleer
      Kijkt of de database bereikbaar is. Zo niet (bijvoorbeeld omdat het
      project op pauze staat), dan stopt het script met een fout. In GitHub
      Actions krijg je daar een mail van.

  python3 scripts/reservekopie.py kopie MAP
      Schrijft MAP/reservekopie-JJJJ-MM-DD.json met alle profielen en ritten.
      Zet daarnaast de ritten van de eigenaar (eigenaar in config.js) in
      data/gereden.json, zodat die reservekopie bij blijft.

  python3 scripts/reservekopie.py terugzetten BESTAND.json
      Maakt SQL om de profielen en ritten uit een reservekopie terug te zetten.
      Plak de uitvoer in Supabase: SQL Editor, New query, Run. Wat er al staat,
      blijft staan; er komt niets dubbel.

Het script leest alleen wat toch al openbaar is, met de publieke sleutel uit
config.js. E-mailadressen zitten er dus niet in. De geheime sleutel is niet nodig.
"""
import datetime
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

MAP = pathlib.Path(__file__).resolve().parent.parent
GEREDEN = MAP / "data" / "gereden.json"
USER_AGENT = "AchtbanenSite/1.0 (reservekopie; persoonlijke achtbanensite)"


def instellingen():
    tekst = (MAP / "config.js").read_text(encoding="utf-8")
    url = re.search(r'supabaseUrl:\s*"(https://[a-z0-9-]+\.supabase\.co)/?"', tekst)
    sleutel = re.search(r'supabaseSleutel:\s*"([^"]+)"', tekst)
    eigenaar = re.search(r'eigenaar:\s*"([^"]*)"', tekst)
    if sleutel and sleutel.group(1).startswith("sb_secret_"):
        sys.exit("In config.js staat een GEHEIME sleutel. Haal hem meteen weg en maak in Supabase een nieuwe aan.")
    if not url or not sleutel:
        return None
    return url.group(1), sleutel.group(1), (eigenaar.group(1) if eigenaar else "")


def vraag(cfg, pad):
    url, sleutel, _ = cfg
    verzoek = urllib.request.Request(f"{url}/rest/v1/{pad}", headers={
        "apikey": sleutel, "Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(verzoek, timeout=60) as antwoord:
        return json.load(antwoord)


def alles(cfg, tabel, velden):
    rijen, van = [], 0
    while True:
        deel = vraag(cfg, f"{tabel}?select={velden}&order=id&limit=1000&offset={van}")
        rijen += deel
        if len(deel) < 1000:
            return rijen
        van += 1000


def controleer(cfg):
    try:
        profielen = vraag(cfg, "profielen?select=id&limit=5")
        vraag(cfg, "ritten?select=id&order=id.desc&limit=5")
    except urllib.error.HTTPError as fout:
        sys.exit(f"Supabase geeft fout {fout.code}. Staat het project op pauze? Kijk op https://supabase.com/dashboard "
                 "en kies bij het project Resume project. Zie ook de README (Supabase op pauze).")
    except (urllib.error.URLError, OSError) as fout:
        sys.exit(f"Supabase is niet bereikbaar ({fout}). Staat het project op pauze? Kijk op https://supabase.com/dashboard "
                 "en kies bij het project Resume project. Zie ook de README (Supabase op pauze).")
    print(f"Supabase is bereikbaar ({len(profielen)} of meer profielen gevonden).")


def rit_voor_json(r):
    rit = {"id": r["achtbaan"]}
    if r.get("datum"):
        rit["datum"] = r["datum"]
    if r.get("cijfer") is not None:
        c = float(r["cijfer"])
        rit["cijfer"] = int(c) if c.is_integer() else c
    if r.get("notitie"):
        rit["notitie"] = r["notitie"]
    return rit


def nette_json(uitleg, ritten):
    regels = ",\n".join("    { " + ", ".join(f"{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}" for k, v in r.items()) + " }"
                        for r in ritten)
    return (f'{{\n  "uitleg": {json.dumps(uitleg, ensure_ascii=False)},\n  "gereden": [\n'
            f'{regels}{chr(10) if ritten else ""}  ]\n}}\n')


def kopie(cfg, doelmap):
    profielen = alles(cfg, "profielen", "id,gebruikersnaam,weergavenaam,in_ranglijst")
    ritten = alles(cfg, "ritten", "id,gebruiker,achtbaan,datum,cijfer,notitie")
    nu = datetime.datetime.now(datetime.timezone.utc)
    doel = pathlib.Path(doelmap)
    doel.mkdir(parents=True, exist_ok=True)
    bestand = doel / f"reservekopie-{nu:%Y-%m-%d}.json"
    bestand.write_text(json.dumps({
        "gemaakt": nu.isoformat(timespec="seconds"), "project": cfg[0],
        "uitleg": "Reservekopie van Rubens Achtbanen. Terugzetten: python3 scripts/reservekopie.py terugzetten dit-bestand.json",
        "profielen": profielen, "ritten": ritten,
    }, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Reservekopie: {len(profielen)} profielen en {len(ritten)} ritten in {bestand.name}")

    # Ook de ritten van de eigenaar in data/gereden.json, als die al zijn overgezet
    eigenaar = next((p for p in profielen if p["gebruikersnaam"] == cfg[2]), None)
    mijn = [rit_voor_json(r) for r in ritten if eigenaar and r["gebruiker"] == eigenaar["id"]]
    if not mijn:
        print("De eigenaar heeft (nog) geen ritten in Supabase: data/gereden.json blijft zoals hij is.")
        return
    GEREDEN.write_text(nette_json(
        "Reservekopie van je credits. Wordt elke week bijgewerkt vanuit Supabase; je ritten zelf staan in je account.",
        mijn), encoding="utf-8")
    print(f"data/gereden.json: {len(mijn)} ritten van {eigenaar['weergavenaam']}")


def sql_tekst(w):
    if w is None:
        return "null"
    if isinstance(w, bool):
        return "true" if w else "false"
    if isinstance(w, (int, float)):
        return repr(float(w))
    return "'" + str(w).replace("'", "''") + "'"


def terugzetten(pad):
    kopie = json.loads(pathlib.Path(pad).read_text(encoding="utf-8"))
    uit = [f"-- Terugzetten van de reservekopie van {kopie.get('gemaakt', '?')}.",
           "-- Plak dit in Supabase: SQL Editor, New query, Run.",
           "-- Profielen komen alleen terug voor accounts die nog bestaan; wat er al staat, blijft staan.", ""]
    if kopie.get("profielen"):
        waarden = ",\n  ".join(f"({sql_tekst(p['id'])}, {sql_tekst(p['gebruikersnaam'])}, {sql_tekst(p['weergavenaam'])}, {sql_tekst(p['in_ranglijst'])})"
                               for p in kopie["profielen"])
        uit += ["insert into public.profielen (id, gebruikersnaam, weergavenaam, in_ranglijst)",
                "select v.id::uuid, v.g, v.w, v.r from (values", f"  {waarden}",
                ") as v (id, g, w, r)",
                "where exists (select 1 from auth.users u where u.id = v.id::uuid)",
                "on conflict do nothing;", ""]
    if kopie.get("ritten"):
        waarden = ",\n  ".join(f"({sql_tekst(r['gebruiker'])}, {sql_tekst(r['achtbaan'])}, {sql_tekst(r.get('datum'))}, "
                               f"{sql_tekst(r.get('cijfer'))}::numeric, {sql_tekst(r.get('notitie'))})" for r in kopie["ritten"])
        uit += ["insert into public.ritten (gebruiker, achtbaan, datum, cijfer, notitie)",
                "select v.g::uuid, v.a, v.d, v.c, v.n from (values", f"  {waarden}",
                ") as v (g, a, d, c, n)",
                "where exists (select 1 from public.profielen p where p.id = v.g::uuid)",
                "  and not exists (select 1 from public.ritten r where r.gebruiker = v.g::uuid and r.achtbaan = v.a",
                "    and r.datum is not distinct from v.d and r.cijfer is not distinct from v.c and r.notitie is not distinct from v.n);", ""]
    print("\n".join(uit))


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("controleer", "kopie", "terugzetten"):
        sys.exit(__doc__)
    if sys.argv[1] == "terugzetten":
        return terugzetten(sys.argv[2])
    cfg = instellingen()
    if not cfg:
        print("Supabase staat nog niet in config.js: er is niets te controleren.")
        return
    controleer(cfg)
    if sys.argv[1] == "kopie":
        kopie(cfg, sys.argv[2] if len(sys.argv) > 2 else ".")


if __name__ == "__main__":
    main()
