# Rubens Achtbanen

Alle achtbanen van de wereld op één site, met een teller van de achtbanen die ik gereden heb.

## Wat staat waar

| Bestand | Wat het doet |
| --- | --- |
| `config.js` | Naam van de site en je GitHub-gegevens. Het enige bestand dat je hoeft aan te passen. |
| `data/gereden.json` | Jouw credits. Hier zet je elke achtbaan die je gereden hebt. |
| `data/extra.json` | Achtbanen die niet in Wikidata staan. |
| `data/achtbanen.json` | Wordt automatisch gemaakt. Niet zelf aanpassen. |
| `fotos/` | Je eigen foto's. |
| `index.html` | De startpagina met teller, kaart en zoeklijst. |
| `achtbaan.html` | De attractiepagina. Toont elke achtbaan via `achtbaan.html?id=Q…`. |
| `scripts/haal_achtbanen.py` | Haalt de achtbanen op bij Wikidata. |
| `.github/workflows/site.yml` | Laat GitHub de lijst ophalen en de site publiceren. |

## Een rit toevoegen

Zet de beheerknop aan door één keer `?beheer=aan` achter het adres van je site te typen. Open daarna een achtbaan en kies **Zet op mijn lijst**. Kopieer de regel, open `data/gereden.json` op GitHub, plak de regel direct onder `"gereden": [` en kies **Commit changes**.

Met de hand kan het ook. Een regel ziet er zo uit:

```json
{ "id": "Q12345", "datum": "2025-07-14", "cijfer": 8.5, "notitie": "Voorste rij", "foto": "fotos/mijn-foto.jpg" },
```

Alleen `id` is verplicht. De code (Q…) staat in het adres van de attractiepagina. Een komma na de laatste regel is geen probleem. Heb je een achtbaan vaker gereden, zet hem er dan gewoon nog een keer in met een andere datum.

## Een achtbaan die niet in de lijst staat

Zet hem in `data/extra.json`, bijvoorbeeld:

```json
{ "id": "x-mijn-kinderachtbaan", "naam": "Kleine Draak", "park": "Speelpark Voorbeeld", "land": "Nederland", "status": "open", "geopend": 2004, "lat": 51.37, "lon": 6.17 },
```

Nog mooier: voeg hem toe aan [Wikidata](https://www.wikidata.org). Dan staat hij er na de volgende maandelijkse update vanzelf in, en heeft iedereen er wat aan.

## Lijst nu meteen bijwerken

Ga naar **Actions**, kies **Site bouwen en publiceren** en klik op **Run workflow**.

## Bronnen

Achtbaangegevens komen uit Wikidata (CC0). Foto's komen van Wikimedia Commons, met maker en licentie onder elke foto. Teksten op de attractiepagina komen van Wikipedia (CC BY-SA). Kaarten van OpenStreetMap.
