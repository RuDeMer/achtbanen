# Rubens Achtbanen

Alle achtbanen van de wereld op één site, met een teller van de achtbanen die ik gereden heb.

## Wat staat waar

| Bestand | Wat het doet |
| --- | --- |
| `config.js` | Naam van de site, je GitHub-gegevens en de publieke gegevens van Supabase. Het enige bestand dat je hoeft aan te passen. |
| `data/gereden.json` | Jouw credits van vóór de accounts. Met Supabase de reservekopie (zie *Je credits overzetten*); zonder Supabase de echte lijst. |
| `data/fotos.json` | Welke eigen foto bij welke achtbaan hoort. De site schrijft hier zelf in (beheer). |
| `data/extra.json` | Achtbanen die niet in Wikidata of OpenStreetMap staan. |
| `data/splitsen.json` | Banen met meer sporen (zoals Joris en de Draak), die per spoor als eigen achtbaan tellen. |
| `data/verborgen.json` | Wat niet op de site komt, omdat het geen achtbaan is of dubbel staat. |
| `data/achtbanen.json` | Wordt automatisch gemaakt. Niet zelf aanpassen. Valt onder de ODbL (zie Bronnen). |
| `data/details.json` | Bestaat alleen als `achtbanen.json` groter zou worden dan 3 MB. Ook automatisch. |
| `fotos/` | Je eigen foto's. |
| `index.html` | De startpagina met jouw teller, kaart, de ranglijst van vrienden en de zoeklijst. |
| `profiel.html` | Het profiel van een vriend: `profiel.html?wie=gebruikersnaam`. |
| `vergelijk.html` | Twee mensen vergelijken: `vergelijk.html?a=ruben&b=anna`. |
| `assets/delen.png` | Het plaatje dat WhatsApp en andere apps tonen als je een link deelt. |
| `achtbaan.html` | De attractiepagina. Toont elke achtbaan via `achtbaan.html?id=…`. |
| `beheer.html` | Het beheerpaneel. Staat niet in het menu; alleen voor jou. |
| `account.html` | Inloggen met een link per mail, je profiel en uitloggen. |
| `supabase/schema.sql` | De database voor accounts en credits, met de beveiliging. Plak je in Supabase. |
| `supabase/test_beveiliging.sql` | Test of niemand bij de gegevens van een ander kan. Draai je in Supabase. |
| `supabase/mails/` | Nederlandse teksten voor de inlogmail en de uitnodiging. |
| `assets/vendor/supabase.js` | De officiële Supabase-bibliotheek (versie 2.118.0, MIT-licentie). Staat in de repository, zodat de site geen andere server nodig heeft. |
| `scripts/haal_achtbanen.py` | Haalt de achtbanen op bij Wikidata en OpenStreetMap, en zoekt foto's. |
| `.github/workflows/site.yml` | Laat GitHub de lijst ophalen en de site publiceren. |

## Accounts voor vrienden (Supabase)

Met een account vinkt iedere vriend zelf aan welke achtbanen hij of zij gereden heeft. De accounts en credits staan bij [Supabase](https://supabase.com) (gratis). Zolang `supabaseUrl` in `config.js` leeg is, werkt de site zoals vroeger met `data/gereden.json`.

Zo werkt de beveiliging: in `config.js` staat alleen de **publieke sleutel**. Die mag iedereen zien. De database zelf (*row level security*) zorgt dat iedereen profielen en credits kan lezen, maar dat je alleen je eigen gegevens kunt toevoegen, wijzigen of verwijderen. De **geheime sleutel** (`sb_secret_…`, vroeger `service_role`) heb je voor deze site niet nodig. Zet hem nooit in `config.js`, niet in de repository en niet in een bericht aan iemand.

### Stap 1: project aanmaken

1. Ga naar [supabase.com](https://supabase.com) en kies **Start your project**. Inloggen met je GitHub-account is het makkelijkst.
2. Kies **New project**. Gebruik de organisatie die Supabase voor je maakt, met het gratis abonnement (**Free**).
3. **Project name**: bijvoorbeeld `achtbanen`.
4. **Database password**: kies **Generate a password** en bewaar het in je wachtwoordmanager. De site gebruikt het niet, maar je hebt het nodig als je ooit zelf een volledige kopie van de database wilt maken.
5. **Region**: kies een regio in Europa, bijvoorbeeld **Central EU (Frankfurt)**. Zie je alleen een keuze per werelddeel, kies dan **Europe**. De gegevens van je vrienden blijven zo in de EU.
6. Laat de rest staan zoals het is (de **Data API** moet aan staan) en kies **Create new project**. Na een minuut of twee is het project klaar.

### Stap 2: database maken

1. Kies links **SQL Editor** en dan **New query**.
2. Open [`supabase/schema.sql`](supabase/schema.sql), kopieer alles, plak het in het venster en kies **Run**. Je ziet *Success. No rows returned*.
3. Kies weer **New query**, plak [`supabase/test_beveiliging.sql`](supabase/test_beveiliging.sql) en kies **Run**. Onderaan moet staan: **40 van 40 goed**. De test maakt nepgebruikers aan, probeert van alles wat niet mag (de credits van een ander wijzigen, e-mailadressen lezen, rare invoer) en draait daarna alles terug. Er blijft niets achter.

### Stap 3: inloggen per mail instellen

1. **Open registratie uit**: kies links **Authentication**, dan **Sign In / Providers**. Zet **Allow new users to sign up** uit en kies **Save**. Nu kan alleen iemand die jij uitnodigt een account krijgen. Laat bij **Auth Providers** de provider **Email** aan staan.
2. **Adressen**: kies **Authentication**, **URL Configuration**.
   - **Site URL**: `https://rudemer.github.io/achtbanen/`
   - Kies bij **Redirect URLs** **Add URL** en vul in: `https://rudemer.github.io/achtbanen/account.html`. Na het klikken op de inloglink stuurt Supabase je alleen naar adressen uit deze lijst.
3. **Mail versturen (verplicht)**: de ingebouwde mailserver van Supabase stuurt alleen mail naar mensen in jouw Supabase-team, en hooguit een paar per uur. Je vrienden krijgen dus pas mail als je een eigen mailserver (SMTP) instelt. Met Gmail gaat dat zo:
   1. Zet in je Google-account **2-stapsverificatie** aan (Google-account, **Beveiliging**).
   2. Maak een **app-wachtwoord**: zoek in je Google-account op *App-wachtwoorden*, geef het de naam *Supabase* en kopieer de 16 letters.
   3. Kies in Supabase **Authentication**, **Emails**, **SMTP Settings** en zet **Enable custom SMTP** aan. Vul in: **Sender email** je Gmail-adres, **Sender name** *Rubens Achtbanen*, **Host** `smtp.gmail.com`, **Port** `465`, **Username** je Gmail-adres, **Password** het app-wachtwoord. Kies **Save**.

   Liever geen Gmail? Elke SMTP-dienst werkt, bijvoorbeeld [Brevo](https://www.brevo.com) (gratis tot 300 mails per dag). Vul dan hun SMTP-gegevens in.
4. **Nederlandse mails**: kies **Authentication**, **Emails**, **Templates**.
   - Bij **Magic link**: onderwerp *Je inloglink voor Rubens Achtbanen* en als tekst de inhoud van [`supabase/mails/inloglink.html`](supabase/mails/inloglink.html). Daar staat ook een code van 6 cijfers in. Die is handig als een mailprogramma (zoals Outlook van school of werk) de link al opent voordat jij erop tikt; dan is de link al gebruikt, maar werkt de code nog.
   - Bij **Invite user**: onderwerp *Je bent uitgenodigd voor Rubens Achtbanen* en de inhoud van [`supabase/mails/uitnodiging.html`](supabase/mails/uitnodiging.html).

Een inloglink en een uitnodiging werken één keer en een uur lang (*Email OTP Expiration* bij **Sign In / Providers**, **Email**). Iemand kan hooguit één keer per minuut een nieuwe link vragen.

### Stap 4: de site koppelen

1. Kies in Supabase **Project Settings** (het tandwiel), **API Keys**. Kopieer de **Publishable key** (begint met `sb_publishable_`). Staat daar nog niets, kies dan **Create new API Keys**.
2. De **Project URL** staat bij **Project Settings**, **Data API** (of onder de knop **Connect** bovenaan). Hij ziet eruit als `https://abcdefghijkl.supabase.co`.
3. Open `config.js` op GitHub (potloodje) en vul ze in:

   ```js
   supabaseUrl: "https://abcdefghijkl.supabase.co",
   supabaseSleutel: "sb_publishable_…",
   eigenaar: "ruben",
   ```

   Kies **Commit changes**. Na een paar minuten staat er rechtsboven op de site **Inloggen**.

### Stap 5: je eigen account (eerst jij, dan je vrienden)

1. Kies in Supabase **Authentication**, **Users**, **Add user**, **Send invitation**. Vul je eigen e-mailadres in en kies **Invite user**.
2. Open de mail en tik op **Uitnodiging aannemen**. Kies je naam en als gebruikersnaam precies wat bij `eigenaar` in `config.js` staat (`ruben`). Zo weet de site dat de startpagina van jou is.

Doe dit vóór je vrienden uitnodigt, zodat niemand anders jouw gebruikersnaam kan nemen.

### Een vriend uitnodigen

1. **Authentication**, **Users**, **Add user**, **Send invitation**, het e-mailadres van je vriend, **Invite user**.
2. Je vriend krijgt een mail, tikt op de link, kiest een naam en een gebruikersnaam, en kan meteen credits afvinken.
3. Daarna logt je vriend in via **Inloggen** op de site: e-mailadres invullen, link in de mail aantikken. Een wachtwoord is er niet.

Is de uitnodiging verlopen (na een uur)? Nodig gewoon opnieuw uit op dezelfde manier. Wil iemand niet meer meedoen? Kies bij **Users** de drie puntjes en **Delete user**: dan verdwijnen account, profiel en credits samen.

### Je credits overzetten (één keer)

Zolang jouw account nog geen ritten heeft, toont de startpagina gewoon je credits uit `data/gereden.json`. Zo zet je ze over:

1. Log in op de site en open **Mijn account** (je naam rechtsboven).
2. Onder je profiel staat **Je credits overzetten**, met het aantal ritten. Kies **Zet … credits over**.
3. Klaar. Vanaf nu vink je af, bewerk je en verwijder je ritten met je account, net als je vrienden. De knop verdwijnt; overzetten kan maar één keer.

`data/gereden.json` blijft in de repository staan als reservekopie. De site wijzigt hem niet meer. Is Supabase een keer niet bereikbaar (bijvoorbeeld als het project op pauze staat), dan toont de startpagina deze reservekopie, met een melding.

### Credits afvinken (voor iedereen met een account)

- **Zet op mijn lijst** op de pagina van een achtbaan. De datum is niet verplicht: kies *Geen datum*, *Alleen een jaar* of *Volledige datum*. Cijfer en notitie mogen ook leeg blijven.
- **Bewerken** en **Verwijderen** bij elke rit.
- **Afvinken** in het overzicht van je eigen lijst (zie *Afvinkmodus* hieronder).

Wat je opslaat staat meteen op de site, voor iedereen. Op de pagina van een achtbaan zie je, als je bent ingelogd, je eigen rit. Bezoekers zonder account zien jouw rit, zoals altijd.

## Delen en vergelijken

- **Profiel**: iedereen heeft een eigen pagina, zoals `https://rudemer.github.io/achtbanen/profiel.html?wie=anna`. Daar staan dezelfde teller, het treintje, de records, de kaart en de lijst als op de startpagina. Op je eigen profiel vink je af en bewerk je je ritten. Je komt er via je naam rechtsboven.
- **Ranglijst**: op de startpagina, onder de kaart (**Vrienden** in het menu). Op aantal credits, met landen en parken. Wie bij *Mijn account* het vinkje voor de ranglijst uitzet, staat er niet in en ook niet bij *Ook gereden door* of in het filter. Diens profiel is dan alleen te vinden met de eigen link.
- **Ook gereden door**: op de pagina van een achtbaan, met datum, cijfer en notitie.
- **Vergelijken**: `vergelijk.html`, of **Vergelijk met mij** op het profiel van een vriend. Je ziet wat jullie allebei gereden hebben, wat alleen de één en wat alleen de ander.
- **Gereden door …**: een filter in de lijst met alle achtbanen. Combineer het bijvoorbeeld met *Alleen gereden* om te zien wat jullie allebei hebben.
- **Delen**: de knop onder de teller. Op een telefoon opent het deelmenu (WhatsApp, Berichten, …); op een computer wordt de link gekopieerd.

Als iemand een link in WhatsApp plakt, toont WhatsApp een voorbeeld met titel, korte tekst en `assets/delen.png`. Die gegevens staan vast in de HTML (Open Graph), omdat WhatsApp geen JavaScript uitvoert. Daarom staat er bij een profiel een algemene tekst en niet het aantal credits. WhatsApp onthoudt een voorbeeld een tijdje; zie je na een wijziging nog het oude, dan komt het nieuwe vanzelf. Deze tags verwijzen naar `https://rudemer.github.io/achtbanen/`; verhuist de site, pas dan in de HTML-bestanden `og:url` en `og:image` aan.

## Beheer: de lijst en je foto's (alleen jij)

Achtbanen toevoegen, eigen foto's, en banen splitsen of verbergen blijft alleen voor jou, via GitHub. Je vrienden kunnen dat niet: daarvoor is een token nodig dat alleen jij hebt. (Zonder Supabase sla je met beheer ook je ritten op in `gereden.json`, zoals vroeger.)

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

- **Achtbaan ontbreekt**: een achtbaan toevoegen aan `data/extra.json`.
- **Eigen foto** bij een achtbaan, rechtstreeks vanaf je telefoon (zie *Eigen foto's*).
- **Splitsen in losse sporen** en **Verbergen**, onderaan de pagina van een baan (zie hieronder).
- Zonder Supabase ook: **Zet op mijn lijst**, **Bewerken**, **Verwijderen** en **Afvinken** voor je ritten in `gereden.json`.

Alles wordt meteen opgeslagen in de repository. Jij ziet de wijziging direct; bezoekers na een paar minuten, als GitHub de site opnieuw heeft gepubliceerd. Heeft iets anders het bestand net gewijzigd, dan haalt de site het opnieuw op en probeert het nog eens, zodat er niets verloren gaat.

### Afvinkmodus: snel tientallen credits

1. Ga naar **Alle achtbanen** en kies **Afvinken**.
2. Filter op een park, land of zoekwoord. Tik op elke achtbaan die je gereden hebt, of kies **Alles kiezen** voor alles wat je nu ziet.
3. Wissel gerust van filter: je keuze blijft bewaard, ook als je de pagina herlaadt.
4. Vul eventueel een jaar in dat voor allemaal geldt, of laat het leeg.
5. Kies **Opslaan**. Alles gaat in één keer naar je account (zonder Supabase: in één commit naar `gereden.json`).

### Ritten zonder datum

Ritten zonder datum tellen gewoon mee voor de teller, de landen en de parken. Voor de records *Eerste credit* en *Nieuwste credit* telt een achtbaan alleen mee als al je ritten erop een datum hebben. Heeft één rit geen datum, dan weten we niet wanneer je hem voor het eerst reed.

## Een rit met de hand toevoegen (zonder Supabase)

Zolang je geen accounts gebruikt, kan het ook zonder beheer: open `data/gereden.json` op GitHub en zet er een regel in, bijvoorbeeld:

```json
{ "id": "Q12345", "datum": "2025-07-14", "cijfer": 8.5, "notitie": "Voorste rij" },
```

Alleen `id` is verplicht. De code staat in het adres van de attractiepagina (`Q…` voor Wikidata, `osm-way-…` voor OpenStreetMap, `x-…` voor je eigen achtbanen). Een datum mag ook alleen een jaar zijn (`"2006"`). Een komma na de laatste regel is geen probleem. Heb je een achtbaan vaker gereden, zet hem er dan nog een keer in.

## Banen met meer sporen

Sommige banen staan in Wikidata en OpenStreetMap als één baan, maar zijn er eigenlijk twee, zoals een duelachtbaan. In `data/splitsen.json` staat welke banen per spoor tellen. Al ingevuld: Winja's Fear & Force, Joris en de Draak (Water en Vuur) en Max & Moritz (Max en Moritz).

Zelf splitsen: open de baan en kies onderaan **Splitsen in losse sporen**. Geef elk spoor een naam. Elk spoor wordt dan een eigen achtbaan met een eigen code (`Q1130871-1`, `Q1130871-2`). Had je de baan al gereden, dan telt die rit voor elk spoor. Heb je één spoor niet gereden, verwijder dan de rit op de pagina van dat spoor. Ziet OpenStreetMap ergens sporen met een eigen naam, dan staat dat als voorstel op de beheerpagina.

Ongedaan maken: haal de regel weg uit `data/splitsen.json`.

## Wat geen achtbaan is

OpenStreetMap noemt soms ook andere dingen een achtbaan. Het script laat bij banen die alleen in OpenStreetMap staan dit weg: losse stations, zomerrodelbanen en alpine coasters, waterattracties en andere attracties (darkrides, treintjes, speelplaatsen), dingen waarvan de Wikidata-koppeling zegt dat het geen achtbaan is, en banen buiten een pretpark zonder RCDB-nummer. VR-versies, zoals EuroSat Coastiality, horen bij de echte baan: een rit erop telt voor die baan.

Staat er nog iets tussen wat geen achtbaan is, of dubbel staat: open het en kies onderaan **Verbergen**. Het komt dan in `data/verborgen.json` en verdwijnt van de site. Terugzetten kan op de beheerpagina. Een baan die iemand gereden heeft (jij of een vriend) kun je niet verbergen.

## Een achtbaan die niet in de lijst staat

Met beheer: zoek hem in het overzicht en kies **Achtbaan ontbreekt**. Of zet hem met de hand in `data/extra.json`:

```json
{ "id": "x-mijn-kinderachtbaan", "naam": "Kleine Draak", "park": "Speelpark Voorbeeld", "land": "Nederland", "status": "open", "geopend": 2004, "lat": 51.37, "lon": 6.17 },
```

Komt dezelfde achtbaan later in Wikidata of OpenStreetMap, dan merkt het script dat (zelfde naam, vlakbij of in hetzelfde park). Je regel in `extra.json` gaat dan verwijzen naar die achtbaan, en je ritten blijven gelden.

Nog mooier: voeg hem toe aan [Wikidata](https://www.wikidata.org) of [OpenStreetMap](https://www.openstreetmap.org). Dan heeft iedereen er wat aan.

## Eigen foto's

Alleen met beheer. Open een achtbaan en kies onderaan bij **Beheer** **Kies een foto**. De browser maakt hem kleiner (maximaal 1600 pixels breed), draait hem goed en haalt de gegevens uit de foto (zoals de plek waar hij gemaakt is). Daarna komt hij in `fotos/` en in `data/fotos.json`. Je eigen foto gaat op de hele site voor op de foto van Wikimedia Commons, ook op de profielen van je vrienden. **Foto weghalen** haalt hem van de site; het bestand blijft in `fotos/` staan. Vrienden kunnen geen foto's uploaden.

## Lijst nu meteen bijwerken

Het script draait elke eerste dag van de maand. Wil je niet wachten: ga naar **Actions**, kies **Site bouwen en publiceren** en klik op **Run workflow**. Onder de run staat een samenvatting met aantallen: hoeveel uit Wikidata, hoeveel extra uit OpenStreetMap, hoeveel dubbelen weggehaald en hoeveel met foto.

## Hoe het script werkt

1. **Wikidata**: alle achtbanen met naam, park, land, cijfers en foto. Het script probeert Wikidata v2, dan v1, dan QLever.
2. **OpenStreetMap**: één grote vraag aan de Overpass API voor alle objecten met `attraction=roller_coaster`, plus de parkgebieden (`tourism=theme_park`). Met een nette User-Agent, twee reserve-servers, en opnieuw proberen bij drukte. Alles samen hooguit 25 minuten; daarna blijven de OSM-gegevens van de vorige keer staan.
3. **Samenvoegen**: een OSM-object hoort bij een Wikidata-achtbaan via de `wikidata`-tag, of op naam plus afstand: 300 meter, of 1,5 km als de naam precies gelijk is (Wikidata zet een baan vaak midden in het park). Het park komt uit het omringende parkgebied; liggen er gebieden in elkaar, dan gaat het gebied met een Wikidata-koppeling voor. Meerdere OSM-objecten van één achtbaan (spoor en station) worden één. Achtbanen die alleen in OSM staan krijgen een vaste code zoals `osm-way-123`.
4. **Foto's**, in deze volgorde: Wikidata P18, een geschikte foto uit de Commons-categorie (P373), de vrij gelicenseerde hoofdafbeelding van het Wikipedia-artikel, de `image`- of `wikimedia_commons`-tag uit OSM, en als laatste een foto op Commons met de naam van de baan én van het park in de bestandsnaam. Elke foto wordt bij Commons gecontroleerd: hij moet er echt staan, met een vrije licentie. Alleen de bestandsnaam wordt bewaard; de site toont bij elke foto de maker en de licentie.

Wil je zien wat het script heeft weggelaten en waarom, draai het dan met `ACHTBANEN_UITLEG=1 python3 scripts/haal_achtbanen.py`.

Beveiligingen:
- Lukt Wikidata niet, dan blijft de oude lijst staan.
- Lukt alleen OpenStreetMap niet, dan blijven de OSM-gegevens van de vorige keer staan.
- Lukt het zoeken of controleren van foto's niet, dan blijven de eerder goedgekeurde foto's.
- Krijgt een achtbaan een andere code (bijvoorbeeld omdat een OSM-baan nu ook in Wikidata staat), dan blijft de oude code werken.
- Staat een code uit `gereden.json`, of uit de ritten van iemand in Supabase, nergens meer in, dan blijft de oude regel staan, zodat geen credit verdwijnt. (Het script leest de ritten met de publieke sleutel uit `config.js`.)

## Bronnen en licenties

- **Wikidata**: vrij te gebruiken (CC0).
- **OpenStreetMap**: © OpenStreetMap-bijdragers, onder de [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Omdat `data/achtbanen.json` (en `data/details.json`, als die er is) gegevens uit OpenStreetMap bevat, valt dat bestand onder de ODbL. Wie het bestand hergebruikt, moet OpenStreetMap noemen en het onder dezelfde licentie delen.
- **Foto's**: van Wikimedia Commons, alleen met een vrije licentie; maker en licentie staan bij elke foto.
- **Teksten** op de attractiepagina: Wikipedia (CC BY-SA).
- **Kaarten**: © OpenStreetMap.
- **RCDB**: er worden geen gegevens of foto's van rcdb.com overgenomen (auteursrecht en databankenrecht). Alleen een link naar de RCDB-pagina, als het nummer in Wikidata of OpenStreetMap staat.
