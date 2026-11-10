# Rubens Achtbanen

Alle achtbanen van de wereld op één site, met een teller van de achtbanen die ik gereden heb. Vrienden met een account houden hun eigen credits bij; we bekijken en vergelijken elkaars lijsten.

## Wat staat waar

| Bestand | Wat het doet |
| --- | --- |
| `config.js` | Naam van de site, je GitHub-gegevens en de publieke gegevens van Supabase. Het enige bestand dat je hoeft aan te passen. |
| `data/gereden.json` | Jouw credits van vóór de accounts. Met Supabase de reservekopie (zie *Je credits overzetten*); zonder Supabase de echte lijst. |
| `data/fotos.json` | Welke eigen foto bij welke achtbaan hoort. De site schrijft hier zelf in (beheer). |
| `data/aanvullingen.json` | Je eigen gegevens (hoogte, snelheid, type, ...) met de bron erbij. Gaan voor op alle andere bronnen. De site schrijft hier zelf in (beheer, *Gegevens aanvullen*). |
| `data/extra.json` | Achtbanen die niet in Wikidata of OpenStreetMap staan. |
| `data/splitsen.json` | Banen met meer sporen (zoals Joris en de Draak), die per spoor als eigen achtbaan tellen. |
| `data/verborgen.json` | Wat niet op de site komt, omdat het geen achtbaan is of dubbel staat. |
| `data/achtbanen.json` | De lijst met de belangrijkste gegevens per achtbaan. Wordt automatisch gemaakt; niet zelf aanpassen. Valt onder de ODbL (zie Bronnen). |
| `data/details/` | De rest per achtbaan (valhoogte, ritduur, model, de bron van elk gegeven, links naar Wikipedia), verdeeld over 16 kleine bestanden zodat de site snel blijft. Ook automatisch. |
| `data/rapport.json` | Het kwaliteitsrapport van de laatste run: hoeveel achtbanen een foto, hoogte, snelheid, park enzovoort hebben. Automatisch. |
| `fotos/` | Je eigen foto's. |
| `index.html` | De startpagina met jouw teller, kaart, de ranglijst van vrienden en de zoeklijst. |
| `profiel.html` | Het profiel van een vriend: `profiel.html?wie=gebruikersnaam`. |
| `vergelijk.html` | Twee mensen vergelijken: `vergelijk.html?a=ruben&b=anna`. |
| `assets/delen.png` | Het plaatje dat WhatsApp en andere apps tonen als je een link deelt. |
| `achtbaan.html` | De attractiepagina. Toont elke achtbaan via `achtbaan.html?id=…`. |
| `park.html` | De pagina van een park: `park.html?id=…`, met alle achtbanen (open en gesloten apart), hoeveel je er gereden hebt en een kaart. |
| `landen.html` | Per land hoeveel achtbanen er zijn en hoeveel je er gereden hebt. |
| `ontbrekend.html` | Beheer: je credits waar nog iets aan ontbreekt, en het kwaliteitsrapport. |
| `beheer.html` | Het beheerpaneel. Staat niet in het menu; alleen voor jou. |
| `account.html` | Inloggen met een link per mail, je profiel, uitloggen en je account verwijderen. |
| `privacy.html` | In gewone taal: wat er bewaard wordt, wie het kan zien en hoe je alles verwijdert. |
| `supabase/schema.sql` | De database voor accounts en credits, met de beveiliging. Plak je in Supabase. |
| `supabase/test_beveiliging.sql` | Test of niemand bij de gegevens van een ander kan. Draai je in Supabase. |
| `supabase/mails/` | Nederlandse teksten voor de inlogmail en de uitnodiging. |
| `assets/vendor/supabase.js` | De officiële Supabase-bibliotheek (versie 2.118.0, MIT-licentie). Staat in de repository, zodat de site geen andere server nodig heeft. |
| `scripts/haal_achtbanen.py` | Haalt de achtbanen op bij Wikidata, Wikipedia en OpenStreetMap, en zoekt foto's. |
| `scripts/wikipedia.py` | Leest het informatieblok van een Wikipedia-artikel (Engels, Nederlands en Duits). |
| `scripts/normaliseer.py` | Maakt namen, landen, types en fabrikanten gelijk, en filtert onmogelijke waarden. |
| `scripts/rapport.py` | Maakt het kwaliteitsrapport. |
| `scripts/test_gegevens.py` | Tests voor het lezen en gelijk maken van de gegevens. GitHub draait ze voor elke run. |
| `scripts/reservekopie.py` | Controleert Supabase, maakt een reservekopie en kan hem terugzetten. |
| `.github/workflows/site.yml` | Laat GitHub de lijst ophalen en de site publiceren. |
| `.github/workflows/reservekopie.yml` | Kijkt elke dag of Supabase werkt en maakt elke maandag een versleutelde reservekopie. |

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
2. De **Project URL** staat bij **Project Settings**, **Data API** (of onder de knop **Connect** bovenaan). Je hebt alleen het begin nodig: `https://abcdefghijkl.supabase.co`. Staat er nog iets achter, zoals `/rest/v1/`, laat dat dan weg. (De site haalt het er ook zelf af.) Je vindt het stuk `abcdefghijkl` ook in de adresbalk van je browser als je het project open hebt: `supabase.com/dashboard/project/abcdefghijkl`.
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

## Zoeken en filteren

In **Alle achtbanen** filter je op land, park, fabrikant, type, status, gereden of nog niet (ook per vriend: *Gereden door* of *Nog niet gereden door*), hoogte van-tot, snelheid van-tot, openingsjaar van-tot, met of zonder inversies, en met of zonder foto. Alles is te combineren. Wat aan staat zie je als chips: tik op een chip om dat filter weg te halen, of op **Alles wissen**.

- **Delen**: alle filters staan in het adres. Kopieer de link en een vriend ziet precies dezelfde lijst.
- **Weergave**: kaartjes, een compacte lijst, of een tabel. In de tabel sorteer je door op een kolomkop te tikken (nog een keer: andersom).
- **Zoeken** vindt ook parken, fabrikanten en landen, met suggesties terwijl je typt. Hoofdletters en accenten maken niet uit.
- **Op je telefoon** zitten de filters onder de knop **Filters**.
- Wil je geen alpine coasters zien: kies bij Type een ander type, of zoek in de tabel. Ze hebben het type *Alpine coaster*.
- **Parkpagina**: tik op de naam van een park. Je ziet alle achtbanen, open en gesloten apart, hoeveel je er gereden hebt, en een kaart.
- **Landen** (in het menu): per land hoeveel achtbanen er zijn en hoeveel je er gereden hebt.

## Delen en vergelijken

- **Profiel**: iedereen heeft een eigen pagina, zoals `https://rudemer.github.io/achtbanen/profiel.html?wie=anna`. Daar staan dezelfde teller, het treintje, de records, de kaart en de lijst als op de startpagina. Op je eigen profiel vink je af en bewerk je je ritten. Je komt er via je naam rechtsboven.
- **Ranglijst**: op de startpagina, onder de kaart (**Vrienden** in het menu). Op aantal credits, met landen en parken. Wie bij *Mijn account* het vinkje voor de ranglijst uitzet, staat er niet in en ook niet bij *Ook gereden door* of in het filter. Diens profiel is dan alleen te vinden met de eigen link.
- **Ook gereden door**: op de pagina van een achtbaan, met datum, cijfer en notitie.
- **Vergelijken**: `vergelijk.html`, of **Vergelijk met mij** op het profiel van een vriend. Je ziet wat jullie allebei gereden hebben, wat alleen de één en wat alleen de ander.
- **Gereden door …**: een filter in de lijst met alle achtbanen. Combineer het bijvoorbeeld met *Alleen gereden* om te zien wat jullie allebei hebben.
- **Delen**: de knop onder de teller. Op een telefoon opent het deelmenu (WhatsApp, Berichten, …); op een computer wordt de link gekopieerd.

Als iemand een link in WhatsApp plakt, toont WhatsApp een voorbeeld met titel, korte tekst en `assets/delen.png`. Die gegevens staan vast in de HTML (Open Graph), omdat WhatsApp geen JavaScript uitvoert. Daarom staat er bij een profiel een algemene tekst en niet het aantal credits. WhatsApp onthoudt een voorbeeld een tijdje; zie je na een wijziging nog het oude, dan komt het nieuwe vanzelf. Deze tags verwijzen naar `https://rudemer.github.io/achtbanen/`; verhuist de site, pas dan in de HTML-bestanden `og:url` en `og:image` aan.

## Privacy en veiligheid

- **Zo min mogelijk bewaren.** Per persoon: e-mailadres (alleen om in te loggen, bij Supabase), naam op de site, gebruikersnaam, wel of niet in de ranglijst, en de ritten. Geen wachtwoorden, geen tijdstempels in de eigen tabellen, geen tracking, geen cookies. Het e-mailadres staat nergens op de site; jij ziet het alleen in Supabase bij **Authentication**, **Users**.
- **Privacypagina**: [`privacy.html`](privacy.html), onderaan elke pagina. Pas hem aan als je iets anders gaat doen met de gegevens.
- **Alles verwijderen**: iedereen kan op *Mijn account* zijn eigen account verwijderen. Dan verdwijnen meteen account, e-mailadres, profiel en ritten. Jij kunt het ook doen bij **Authentication**, **Users**, drie puntjes, **Delete user**.
- **Alleen je eigen gegevens**: dat regelt de database zelf (row level security), niet alleen de site. Draai [`supabase/test_beveiliging.sql`](supabase/test_beveiliging.sql) gerust nog eens als je iets aan de database verandert.
- **Invoer wordt gecontroleerd**, eerst door de site en daarna nog eens door de database: naam hooguit 40 tekens, gebruikersnaam 3 tot 24 tekens (kleine letters, cijfers, streepjes), notitie hooguit 200 tekens, cijfer van 1 tot 10, een echte datum of een jaar tussen 1900 en 2100, en een geldige achtbaan-code. Hooguit 5000 ritten per persoon.
- **Tekst van gebruikers komt nooit als HTML op de pagina.** Een naam of notitie met `<script>` erin staat er gewoon als tekst. Daarnaast laat de beveiliging van de pagina's (Content Security Policy) alleen scripts van de site zelf toe.
- **Sleutels**: in `config.js` staat alleen de publieke sleutel. Is de geheime sleutel ooit ergens terechtgekomen waar hij niet hoort: maak in Supabase bij **Project Settings**, **API Keys** een nieuwe aan en verwijder de oude.

## Supabase op pauze

**Wat het betekent.** Supabase zet een gratis project op pauze als er een week lang weinig gebeurt. Je gegevens blijven bewaard, maar de database doet het dan niet: niemand kan inloggen of afvinken, en de ranglijst, profielen en vergelijkingen laden niet. De startpagina toont dan je credits uit de reservekopie `data/gereden.json`, met een melding.

**Hoe je het merkt.**
- Supabase mailt je ongeveer een week van tevoren, en nog een keer als het project op pauze staat.
- De workflow **Supabase controleren en reservekopie** kijkt elke dag of de database bereikbaar is. Lukt dat niet, dan mislukt de run en krijg je een mail van GitHub. Zorg dat die mail aanstaat: GitHub, je profielfoto, **Settings**, **Notifications**, bij **Actions** kies **Email** en **Only notify for failed workflows**.
- Op [supabase.com/dashboard](https://supabase.com/dashboard) staat bij het project *Paused*.

**Weer aanzetten.** Open het project op [supabase.com/dashboard](https://supabase.com/dashboard) en kies **Resume project**. Na een paar minuten werkt alles weer, met alle gegevens. Volgens Supabase kan dat tot een jaar na het pauzeren. Start daarna in GitHub bij **Actions** de workflow nog eens met **Run workflow** om te zien dat hij weer groen is.

**Voorkomen.** De dagelijkse controle doet elke dag een paar kleine verzoeken. Volgens Supabase is "een paar verzoeken per dag" meestal genoeg om pauzeren te voorkomen, maar een garantie is het niet. Alleen een betaald abonnement (Pro) gaat nooit op pauze. Let op: GitHub zet geplande workflows in een openbare repository uit als er 60 dagen niets in de repository verandert. Je krijgt daar een mail van; zet hem dan weer aan bij **Actions**, de workflow, **Enable workflow**.

## Reservekopie (niet openbaar)

Supabase maakt bij het gratis abonnement geen reservekopie die je kunt downloaden. Daarom doet de workflow **Supabase controleren en reservekopie** dat elke maandag: alle profielen en ritten, zonder e-mailadressen (die zijn met de publieke sleutel niet te lezen, en dat is goed zo). De kopie is versleuteld met een wachtwoord dat alleen jij kent en blijft 90 dagen bij de run staan. Waarom versleuteld: je repository is openbaar, en bestanden bij een run kan iedereen met een GitHub-account downloaden. Zonder het wachtwoord kan niemand de kopie openen.

### Aanzetten (één keer)

1. Bedenk een lang wachtwoord (bijvoorbeeld vier losse woorden) en bewaar het in je wachtwoordmanager. Kwijt is kwijt: zonder wachtwoord open je de kopie niet.
2. Ga op GitHub naar de repository, **Settings**, **Secrets and variables**, **Actions**, **New repository secret**. **Name**: `RESERVEKOPIE_WACHTWOORD`, **Secret**: je wachtwoord. Kies **Add secret**.
3. Ga naar **Actions**, kies **Supabase controleren en reservekopie** en **Run workflow**. Na een minuut staat er onderaan de run bij **Artifacts** een `reservekopie-…`.

Zonder dat geheim maakt de workflow wel de controle, maar bewaart hij geen kopie, zodat er nooit iets onversleuteld online komt. Je eigen ritten zet hij ook in `data/gereden.json` (die zijn toch al openbaar), zodat de reservekopie op de startpagina bij blijft.

### Een kopie openen

Download bij een run het artifact. Je krijgt een zip met een `.7z`-bestand. Open dat met [7-Zip](https://www.7-zip.org) (Windows) of [Keka](https://www.keka.io) (Mac) en je wachtwoord. Daarin staat `reservekopie-JJJJ-MM-DD.json`.

### Met de hand, extra veilig

Wil je ook een kopie op je eigen computer (bijvoorbeeld elke maand): kies in Supabase **SQL Editor**, draai `select * from public.ritten;` en kies bij het resultaat **Export**, **Download CSV**. Doe hetzelfde met `select * from public.profielen;`. Wil je ook de e-mailadressen bewaren, gebruik dan `select id, email from auth.users;`. Bewaar deze bestanden op je eigen computer, nooit in de repository.

### Terugzetten

Ritten of profielen kwijt, maar de accounts bestaan nog? Pak de kopie uit en maak er SQL van:

```bash
python3 scripts/reservekopie.py terugzetten reservekopie-2026-11-10.json > terugzetten.sql
```

Plak de inhoud van `terugzetten.sql` in de **SQL Editor** en kies **Run**. Wat er nog staat, blijft staan; er komt niets dubbel. Is het hele project weg, maak dan een nieuw project (stap 1 tot 4), nodig iedereen opnieuw uit en laat ze hun gebruikersnaam opnieuw kiezen. Daarna kunnen de ritten per gebruikersnaam worden teruggezet; dat is maatwerk.

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
- **Gegevens aanvullen**, onderaan de pagina van een baan: hoogte, snelheid, type, fabrikant en meer, altijd met een bron (zie *Gegevens aanvullen*).
- **Ontbrekende gegevens** (`ontbrekend.html`): je credits waar nog iets aan ontbreekt, op een rij, om meteen aan te vullen.
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

## Gegevens aanvullen

Klopt er iets niet, of ontbreekt er iets? Met beheer: open de baan en kies onderaan **Gegevens aanvullen**, of ga naar **Ontbrekende gegevens** op de beheerpagina. Vul in wat je weet en schrijf erbij waar het vandaan komt (bijvoorbeeld *bordje bij de ingang, 2025* of de site van het park). Zonder bron kun je niet opslaan. Je aanvulling komt in `data/aanvullingen.json` en gaat voor op Wikidata, Wikipedia en OpenStreetMap. Op de pagina van de baan staat dan klein *Eigen aanvulling* met je bron. **Aanvulling weghalen** zet de gegevens uit de bronnen terug.

Met de hand kan ook:

```json
{ "id": "Q888394", "hoogte": 12.5, "type": "Bobsleebaan", "bron": "Bordje bij de ingang, 2025" },
```

## Wat geen achtbaan is

OpenStreetMap noemt soms ook andere dingen een achtbaan. Het script laat bij banen die alleen in OpenStreetMap staan dit weg: losse stations, waterattracties en andere attracties (darkrides, treintjes, speelplaatsen), dingen waarvan de Wikidata-koppeling zegt dat het geen achtbaan is, en banen buiten een pretpark zonder RCDB-nummer. Alpine coasters (zomerrodelbanen op rails) blijven wel staan, met het type *Alpine coaster*, zodat je ze met een filter kunt weglaten. VR-versies, zoals EuroSat Coastiality, horen bij de echte baan: een rit erop telt voor die baan.

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

Het script draait elke eerste dag van de maand. Wil je niet wachten: ga naar **Actions**, kies **Site bouwen en publiceren** en klik op **Run workflow**. Onder de run staat het **kwaliteitsrapport**: hoeveel procent van de achtbanen een foto, park, hoogte, snelheid, openingsjaar enzovoort heeft, wat dat de vorige keer was, waar de foto's vandaan komen, en wat er misging (bijvoorbeeld als OpenStreetMap niet bereikbaar was). Hetzelfde rapport staat in `data/rapport.json` en op **Ontbrekende gegevens**.

## Hoe het script werkt

1. **Wikidata**: alle achtbanen met naam, park, land, cijfers en foto. Het script probeert Wikidata v2, dan v1, dan QLever.
2. **OpenStreetMap**: één grote vraag aan de Overpass API voor alle objecten met `attraction=roller_coaster`, plus de parkgebieden (`tourism=theme_park`). Met een nette User-Agent, twee reserve-servers, en opnieuw proberen bij drukte. Alles samen hooguit 25 minuten; daarna blijven de OSM-gegevens van de vorige keer staan.
3. **Samenvoegen**: een OSM-object hoort bij een Wikidata-achtbaan via de `wikidata`-tag, of op naam plus afstand: 300 meter, of 1,5 km als de naam precies gelijk is (Wikidata zet een baan vaak midden in het park). Het park komt uit het omringende parkgebied; liggen er gebieden in elkaar, dan gaat het gebied met een Wikidata-koppeling voor. Meerdere OSM-objecten van één achtbaan (spoor en station) worden één. Achtbanen die alleen in OSM staan krijgen een vaste code zoals `osm-way-123`.
4. **Wikipedia**: het informatieblok van het artikel in het Engels, Nederlands en Duits (hoogte, valhoogte, lengte, topsnelheid, inversies, ritduur, fabrikant, model, type, opening, sluiting en status). Per 50 artikelen tegelijk, met een pauze ertussen. Alles wordt omgerekend naar meter en km/u; onmogelijke waarden (een baan van 900 meter hoog) vallen weg.
5. **Kiezen per gegeven**: je eigen aanvulling gaat voor, dan Wikidata, dan Wikipedia, dan OpenStreetMap. Van elk gegeven wordt de bron bewaard; de attractiepagina toont die klein onder het gegeven.
6. **Gelijk maken**: namen (zonder "(roller coaster)" erachter), landen in het Nederlands, één schrijfwijze per fabrikant en per type. Dubbele banen en dubbele parken worden samengevoegd (oude codes blijven werken). Een baan zonder land krijgt het land van zijn park, of van de banen in de buurt als die allemaal in hetzelfde land staan. Verhuisde banen krijgen *Eerder in ...* met de jaren.
7. **Foto's**, in deze volgorde: je eigen foto, Wikidata P18, de Commons-categorie (P373), de hoofdafbeelding van het Wikipedia-artikel, de `image`- of `wikimedia_commons`-tag uit OSM, en als laatste zoeken op Commons, alleen als het zeker om deze baan gaat (de naam in de bestandsnaam, en het park of een cameraplek binnen een kilometer). Elke foto wordt bij Commons gecontroleerd: hij moet er echt staan, met een vrije licentie. Een liggende foto van de baan zelf gaat voor; logo's, plattegronden, borden, ingangen en winkels worden overgeslagen, en een staande foto, een bouwfoto of een foto van het station alleen als er niets beters is. De maker en de licentie gaan mee, zodat de site ze bij elke foto kan tonen. Is er geen vrije foto, dan toont de site een getekende illustratie die past bij het type en de hoogte (met een looping per inversie). Dat is duidelijk een tekening, geen foto.
8. **Rapport**: het kwaliteitsrapport komt in `data/rapport.json` en in de samenvatting van de run.

Wil je zien wat het script heeft weggelaten en waarom, draai het dan met `ACHTBANEN_UITLEG=1 python3 scripts/haal_achtbanen.py`.

Beveiligingen:
- Lukt Wikidata niet, dan blijft de oude lijst staan.
- Lukt alleen OpenStreetMap niet, dan blijven de OSM-gegevens van de vorige keer staan.
- Lukt het zoeken of controleren van foto's niet, dan blijven de eerder goedgekeurde foto's.
- Krijgt een achtbaan een andere code (bijvoorbeeld omdat een OSM-baan nu ook in Wikidata staat), dan blijft de oude code werken.
- Staat een code uit `gereden.json`, of uit de ritten van iemand in Supabase, nergens meer in, dan blijft de oude regel staan, zodat geen credit verdwijnt. (Het script leest de ritten met de publieke sleutel uit `config.js`.)

## Bronnen en licenties

- **Wikidata**: vrij te gebruiken (CC0).
- **OpenStreetMap**: © OpenStreetMap-bijdragers, onder de [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). Omdat `data/achtbanen.json` en de bestanden in `data/details/` gegevens uit OpenStreetMap bevatten, vallen ze onder de ODbL. Wie ze hergebruikt, moet OpenStreetMap noemen en ze onder dezelfde licentie delen.
- **Wikipedia**: gegevens uit de informatieblokken van Wikipedia (Engels, Nederlands en Duits) en de teksten op de attractiepagina vallen onder [CC BY-SA](https://creativecommons.org/licenses/by-sa/4.0/deed.nl). Op de attractiepagina staat bij elk gegeven uit Wikipedia klein uit welk artikel het komt, met een link, en onderaan de lijst *Waar de gegevens vandaan komen*.
- **Foto's**: van Wikimedia Commons, alleen met een vrije licentie (de licentie verschilt per foto). Maker en licentie staan bij elke foto, ook op de kaartjes, met een link naar de pagina van de foto op Commons.
- **Getekende illustraties**: maakt de site zelf, voor banen zonder vrije foto.
- **Je eigen aanvullingen** (`data/aanvullingen.json`): met de bron die je zelf opgeeft.
- **Kaarten**: © OpenStreetMap.
- **RCDB**: er worden geen gegevens of foto's van rcdb.com overgenomen (auteursrecht en databankenrecht). Alleen een link naar de RCDB-pagina, als het nummer in Wikidata of OpenStreetMap staat.
