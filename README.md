# Rubens Achtbanen

Alle achtbanen van de wereld op één site, met een teller van de achtbanen die ik gereden heb.

## Wat staat waar

| Bestand | Wat het doet |
| --- | --- |
| `config.js` | Naam van de site en je GitHub-gegevens. Het enige bestand dat je hoeft aan te passen. |
| `data/gereden.json` | Jouw credits. De site schrijft hier zelf in als je beheer aanzet; met de hand kan ook. |
| `data/extra.json` | Achtbanen die niet in Wikidata of OpenStreetMap staan. |
| `data/achtbanen.json` | Wordt automatisch gemaakt. Niet zelf aanpassen. Valt onder de ODbL (zie Bronnen). |
| `data/details.json` | Bestaat alleen als `achtbanen.json` groter zou worden dan 3 MB. Ook automatisch. |
| `fotos/` | Je eigen foto's. |
| `index.html` | De startpagina met teller, kaart en zoeklijst. |
| `achtbaan.html` | De attractiepagina. Toont elke achtbaan via `achtbaan.html?id=…`. |
| `beheer.html` | Het beheerpaneel. Staat niet in het menu; alleen voor jou. |
| `scripts/haal_achtbanen.py` | Haalt de achtbanen op bij Wikidata en OpenStreetMap, en zoekt foto's. |
| `.github/workflows/site.yml` | Laat GitHub de lijst ophalen en de site publiceren. |

## Beheer: ritten opslaan zonder kopiëren en plakken

Je zet beheer aan met een *fine-grained token* van GitHub. Dat is een soort wachtwoord dat alleen in deze ene repository mag schrijven. Het token blijft in de browser op je eigen apparaat (in `localStorage`). Het komt nooit in de repository en niet in de code. Bezoekers zonder token zien de site zoals altijd, zonder beheerknoppen.

### Token maken (één keer per apparaat)

1. Ga op GitHub naar je profielfoto rechtsboven, **Settings**, helemaal onderaan links **Developer settings**, dan **Personal access tokens**, **Fine-grained tokens** en **Generate new token**. (Op `beheer.html` staat een knop die dit scherm meteen opent.)
2. **Token name**: bijvoorbeeld *Achtbanensite telefoon*. **Expiration**: bijvoorbeeld een jaar.
3. **Resource owner**: je eigen account (RuDeMer).
4. **Repository access**: kies **Only select repositories** en selecteer alleen **RuDeMer/achtbanen**.
5. **Permissions**: zet bij de repository-rechten **Contents** op **Read and write**. GitHub zet er zelf **Metadata: Read-only** bij; dat hoort zo. Verder niets.
6. Klik **Generate token** en kopieer het token (begint met `github_pat_`). GitHub laat het maar één keer zien.
7. Open `https://rudemer.github.io/achtbanen/beheer.html`, plak het token en kies **Token opslaan**. De site controleert meteen of het mag lezen en schrijven, zonder iets te veranderen.

Wil je ook vanaf je telefoon beheren, doe stap 7 daar ook. Nog beter: maak voor elk apparaat een eigen token, dan kun je er één intrekken zonder de andere.

### Token verwijderen

- **Van één apparaat**: kies op `beheer.html` **Token verwijderen**. De beheerknoppen verdwijnen meteen.
- **Helemaal intrekken**: GitHub, **Settings**, **Developer settings**, **Personal access tokens**, **Fine-grained tokens**, klik op het token en kies onderaan **Delete**. Doe dit meteen als je telefoon kwijt is of als je denkt dat iemand anders het token heeft. Verloopt een token, dan maak je gewoon een nieuwe.

Goed om te weten: alle GitHub Pages-sites van één account delen hetzelfde adres (`rudemer.github.io`), en dus ook dezelfde browseropslag. Zet daarom geen code van anderen op een andere Pages-site van dit account, of trek het token in als je dat wel doet.

### Wat je met beheer kunt

- **Zet op mijn lijst** op de pagina van een achtbaan. De datum is niet verplicht: kies *Geen datum*, *Alleen een jaar* of *Volledige datum*. Cijfer, notitie en foto mogen ook leeg blijven.
- **Bewerken** en **Verwijderen** bij elke rit.
- **Afvinken** in het overzicht (zie hieronder).
- **Achtbaan ontbreekt**: een achtbaan toevoegen aan `data/extra.json`.
- **Eigen foto** bij een rit, rechtstreeks vanaf je telefoon.

Alles wordt meteen opgeslagen in de repository. Jij ziet de wijziging direct; bezoekers na een paar minuten, als GitHub de site opnieuw heeft gepubliceerd. Heeft iets anders het bestand net gewijzigd, dan haalt de site het opnieuw op en probeert het nog eens, zodat er niets verloren gaat.

### Afvinkmodus: snel tientallen credits

1. Ga naar **Alle achtbanen** en kies **Afvinken**.
2. Filter op een park, land of zoekwoord. Tik op elke achtbaan die je gereden hebt, of kies **Alles kiezen** voor alles wat je nu ziet.
3. Wissel gerust van filter: je keuze blijft bewaard, ook als je de pagina herlaadt.
4. Vul eventueel een jaar in dat voor allemaal geldt, of laat het leeg.
5. Kies **Opslaan**. Alles gaat in één keer (één commit) naar `gereden.json`.

### Ritten zonder datum

Ritten zonder datum tellen gewoon mee voor de teller, de landen en de parken. Voor de records *Eerste credit* en *Nieuwste credit* telt een achtbaan alleen mee als al je ritten erop een datum hebben. Heeft één rit geen datum, dan weten we niet wanneer je hem voor het eerst reed.

## Een rit met de hand toevoegen

Het kan nog steeds zonder beheer: open `data/gereden.json` op GitHub en zet er een regel in, bijvoorbeeld:

```json
{ "id": "Q12345", "datum": "2025-07-14", "cijfer": 8.5, "notitie": "Voorste rij", "foto": "fotos/mijn-foto.jpg" },
```

Alleen `id` is verplicht. De code staat in het adres van de attractiepagina (`Q…` voor Wikidata, `osm-way-…` voor OpenStreetMap, `x-…` voor je eigen achtbanen). Een datum mag ook alleen een jaar zijn (`"2006"`). Een komma na de laatste regel is geen probleem. Heb je een achtbaan vaker gereden, zet hem er dan nog een keer in.

## Een achtbaan die niet in de lijst staat

Met beheer: zoek hem in het overzicht en kies **Achtbaan ontbreekt**. Of zet hem met de hand in `data/extra.json`:

```json
{ "id": "x-mijn-kinderachtbaan", "naam": "Kleine Draak", "park": "Speelpark Voorbeeld", "land": "Nederland", "status": "open", "geopend": 2004, "lat": 51.37, "lon": 6.17 },
```

Komt dezelfde achtbaan later in Wikidata of OpenStreetMap, dan merkt het script dat (zelfde naam, vlakbij of in hetzelfde park). Je regel in `extra.json` gaat dan verwijzen naar die achtbaan, en je ritten blijven gelden.

Nog mooier: voeg hem toe aan [Wikidata](https://www.wikidata.org) of [OpenStreetMap](https://www.openstreetmap.org). Dan heeft iedereen er wat aan.

## Eigen foto's

Kies bij een rit **Kies een foto**. De browser maakt hem kleiner (maximaal 1600 pixels breed), draait hem goed en haalt de gegevens uit de foto (zoals de plek waar hij gemaakt is). Daarna komt hij in `fotos/`. Je eigen foto gaat altijd voor op de foto van Wikimedia Commons.

## Lijst nu meteen bijwerken

Het script draait elke eerste dag van de maand. Wil je niet wachten: ga naar **Actions**, kies **Site bouwen en publiceren** en klik op **Run workflow**. Onder de run staat een samenvatting met aantallen: hoeveel uit Wikidata, hoeveel extra uit OpenStreetMap, hoeveel dubbelen weggehaald en hoeveel met foto.

## Hoe het script werkt

1. **Wikidata**: alle achtbanen met naam, park, land, cijfers en foto. Het script probeert Wikidata v2, dan v1, dan QLever.
2. **OpenStreetMap**: één grote vraag aan de Overpass API voor alle objecten met `attraction=roller_coaster`, plus de parkgebieden (`tourism=theme_park`). Met een nette User-Agent, twee reserve-servers, en opnieuw proberen bij drukte. Alles samen hooguit 25 minuten; daarna blijven de OSM-gegevens van de vorige keer staan.
3. **Samenvoegen**: een OSM-object hoort bij een Wikidata-achtbaan via de `wikidata`-tag, of op naam plus afstand: 300 meter, of 1,5 km als de naam precies gelijk is (Wikidata zet een baan vaak midden in het park). Het park komt uit het omringende parkgebied; liggen er gebieden in elkaar, dan gaat het gebied met een Wikidata-koppeling voor. Meerdere OSM-objecten van één achtbaan (spoor en station) worden één. Achtbanen die alleen in OSM staan krijgen een vaste code zoals `osm-way-123`.
4. **Foto's**, in deze volgorde: Wikidata P18, een geschikte foto uit de Commons-categorie (P373), de vrij gelicenseerde hoofdafbeelding van het Wikipedia-artikel, de `image`- of `wikimedia_commons`-tag uit OSM. Elke foto wordt bij Commons gecontroleerd: hij moet er echt staan, met een vrije licentie. Alleen de bestandsnaam wordt bewaard; de site toont bij elke foto de maker en de licentie.

Beveiligingen:
- Lukt Wikidata niet, dan blijft de oude lijst staan.
- Lukt alleen OpenStreetMap niet, dan blijven de OSM-gegevens van de vorige keer staan.
- Lukt het zoeken of controleren van foto's niet, dan blijven de eerder goedgekeurde foto's.
- Krijgt een achtbaan een andere code (bijvoorbeeld omdat een OSM-baan nu ook in Wikidata staat), dan blijft de oude code werken.
- Staat een code uit `gereden.json` nergens meer in, dan blijft de oude regel staan, zodat je credit niet verdwijnt.

## Bronnen en licenties

- **Wikidata**: vrij te gebruiken (CC0).
- **OpenStreetMap**: © OpenStreetMap-bijdragers, onder de [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Omdat `data/achtbanen.json` (en `data/details.json`, als die er is) gegevens uit OpenStreetMap bevat, valt dat bestand onder de ODbL. Wie het bestand hergebruikt, moet OpenStreetMap noemen en het onder dezelfde licentie delen.
- **Foto's**: van Wikimedia Commons, alleen met een vrije licentie; maker en licentie staan bij elke foto.
- **Teksten** op de attractiepagina: Wikipedia (CC BY-SA).
- **Kaarten**: © OpenStreetMap.
- **RCDB**: er worden geen gegevens of foto's van rcdb.com overgenomen (auteursrecht en databankenrecht). Alleen een link naar de RCDB-pagina, als het nummer in Wikidata of OpenStreetMap staat.
