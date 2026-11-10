/* Rubens Achtbanen — de code achter alle pagina's.
   Instellingen staan in config.js; hier hoef je niets te veranderen. */
(function () {
  "use strict";

  const SITE = Object.assign(
    { naam: "Mijn achtbanen", githubGebruiker: "", githubRepo: "", branch: "main" },
    window.SITE || {}
  );
  const TAAL = "nl-NL";
  const PER_KEER = 48;
  const params = new URLSearchParams(location.search);
  const PAGINA = document.body.dataset.pagina;

  /* ---------- Opslag in je eigen browser ---------- */
  const opslag = {
    lees(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    zet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    wis(k) { try { localStorage.removeItem(k); } catch (e) { /* geen opslag */ } },
  };

  /* ---------- Beheer: alleen met een GitHub-token op dit apparaat ----------
     Het token plak je één keer op beheer.html. Het blijft in de opslag van je
     eigen browser (localStorage) en komt nooit in de repository of in de code.
     Zonder token ziet een bezoeker geen enkele beheerknop. */
  const TOKEN_SLEUTEL = "achtbanen-token";
  opslag.wis("beheer"); // van de oude beheermodus
  if (params.get("beheer") === "aan" && PAGINA !== "beheer") { location.replace("beheer.html"); return; }
  const repoBekend = !!SITE.githubGebruiker && !/JOUW-/.test(SITE.githubGebruiker) && !!SITE.githubRepo;
  const leesToken = () => opslag.lees(TOKEN_SLEUTEL) || "";
  const beheer = repoBekend && !!leesToken();

  /* ---------- Hulpfuncties ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getal = (n, dec = 0) => Number(n).toLocaleString(TAAL, { maximumFractionDigits: dec });
  const zoekbaar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const meervoud = (n, een, veel) => (n === 1 ? een : veel);
  const pagina = (a) => `achtbaan.html?id=${encodeURIComponent(a.id)}`;
  const wacht = (ms) => new Promise((klaar) => setTimeout(klaar, ms));

  function datum(waarde, kort) {
    const s = String(waarde || "").trim();
    if (/^\d{4}$/.test(s)) return s;
    const maand = kort ? "short" : "long";
    if (/^\d{4}-\d{2}$/.test(s)) {
      return new Date(s + "-15T12:00:00").toLocaleDateString(TAAL, { month: maand, year: "numeric" });
    }
    const d = new Date(s.slice(0, 10) + "T12:00:00");
    if (isNaN(d)) return s;
    return d.toLocaleDateString(TAAL, { day: "numeric", month: maand, year: "numeric" });
  }

  // "op 14 juli 2006", maar "in 2006" of "in juli 2006"
  const opDatumTekst = (d) => `${/^\d{4}(-\d{2})?$/.test(String(d)) ? "in" : "op"} ${datum(d)}`;
  function vandaag() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  // Eigen foto (pad of link) of een bestandsnaam op Wikimedia Commons
  function isEigenFoto(foto) { return /^(https?:|\.{0,2}\/|fotos\/)/.test(foto || ""); }
  const netGeupload = new Map(); // pad -> blob-adres, zodat een nieuwe foto meteen te zien is
  function fotoBron(foto, breedte) {
    if (!foto) return null;
    if (netGeupload.has(foto)) return netGeupload.get(foto);
    if (isEigenFoto(foto)) return foto;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(foto)}?width=${breedte}`;
  }
  const commonsPagina = (bestand) =>
    `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(bestand.replace(/ /g, "_"))}`;
  const eigenPad = (foto) => (/^(\.\/)?fotos\//.test(foto || "") ? foto.replace(/^\.\//, "") : "");

  // Een eigen foto die net is geüpload staat nog niet op de site. Probeer hem dan bij GitHub zelf.
  function fotoMislukt(img, anders) {
    const pad = img.dataset.eigen;
    if (pad && repoBekend && !img.dataset.tweede) {
      img.dataset.tweede = "1";
      img.src = `https://raw.githubusercontent.com/${SITE.githubGebruiker}/${SITE.githubRepo}/${SITE.branch}/${pad}`;
      return;
    }
    if (anders) anders(); else img.remove();
  }

  function statusTekst(a) {
    if (a.status === "gesloten") return a.gesloten ? `Gesloten in ${a.gesloten}` : "Gesloten";
    if (a.status === "gepland") return a.geopend ? `Opent in ${a.geopend}` : "Komt nog";
    return a.geopend ? `Open sinds ${a.geopend}` : "Open";
  }

  function toast(tekst, lang) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = tekst;
    (document.querySelector("dialog[open]") || document.body).appendChild(t);
    setTimeout(() => t.remove(), lang ? 6500 : 3200);
  }

  function toonFout(vak, fout) {
    console.error(fout);
    const geenLijst = /achtbanen\.json/.test(fout.message);
    vak.innerHTML = `<div class="melding">
      <h1>${geenLijst ? "De achtbanenlijst is er nog niet" : "Er ging iets mis"}</h1>
      <p>${esc(fout.message)}</p>
      ${geenLijst
        ? "<p>Kijk op GitHub bij het tabblad <strong>Actions</strong> of de workflow <em>Site bouwen en publiceren</em> gelukt is. Die haalt de lijst bij Wikidata op.</p>"
        : "<p>Controleer of je laatste wijziging in een JSON-bestand klopt: elke regel tussen accolades, met komma's ertussen.</p>"}
    </div>`;
  }

  /* ---------- JSON lezen en netjes schrijven ---------- */

  function leesJsonTekst(tekst, pad) {
    try {
      // Een komma te veel na de laatste regel is geen probleem
      return JSON.parse(tekst.replace(/,(\s*[\]}])/g, "$1"));
    } catch (e) {
      throw new Error(`In ${pad} zit een typefout: ${e.message}`);
    }
  }

  // Eén regel per rit (of achtbaan), net zoals je hem met de hand zou typen
  function regelJson(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return JSON.stringify(o);
    return `{ ${Object.entries(o).filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${JSON.stringify(k)}: ${Array.isArray(v) ? `[${v.map((x) => JSON.stringify(x)).join(", ")}]` : JSON.stringify(v)}`).join(", ")} }`;
  }
  function netteJson(data, lijstSleutel) {
    const delen = Object.entries(data).map(([k, v]) => {
      if (k !== lijstSleutel) return `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
      return `  ${JSON.stringify(k)}: [\n${v.map((x) => "    " + regelJson(x)).join(",\n")}${v.length ? "\n" : ""}  ]`;
    });
    return `{\n${delen.join(",\n")}\n}\n`;
  }

  // Twee ritten zijn dezelfde als alle velden gelijk zijn (volgorde maakt niet uit)
  const vorm = (o) => JSON.stringify(Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, o[k]]));
  const vindRit = (lijst, rit) => lijst.findIndex((x) => x && vorm(x) === vorm(rit));

  /* ---------- GitHub: rechtstreeks opslaan met je token ---------- */

  class GitHubFout extends Error {
    constructor(status, uitleg, bericht) { super(uitleg); this.status = status; this.bericht = bericht || ""; }
  }

  function legFoutUit(status, bericht) {
    if (status === 401) return "GitHub accepteert je token niet (meer). Misschien is hij verlopen of ingetrokken. Plak een nieuw token op de beheerpagina.";
    if (status === 403 && /rate limit/i.test(bericht)) return "Even te veel verzoeken naar GitHub. Probeer het over een paar minuten opnieuw.";
    if (status === 403) return "Je token mag hier niet schrijven. Geef hem bij Repository permissions de rechten Contents: Read and write.";
    if (status === 404) return `GitHub vindt ${SITE.githubGebruiker}/${SITE.githubRepo} niet. Heeft je token toegang tot deze repository?`;
    if (status === 409) return "Het bestand is net door iets anders gewijzigd.";
    return `GitHub gaf fout ${status}${bericht ? `: ${bericht}` : ""}.`;
  }

  async function github(pad, opties = {}, token = leesToken()) {
    let r;
    try {
      r = await fetch(`https://api.github.com/repos/${encodeURIComponent(SITE.githubGebruiker)}/${encodeURIComponent(SITE.githubRepo)}${pad}`, {
        cache: "no-store",
        ...opties,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          ...(opties.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch (e) {
      throw new GitHubFout(0, "GitHub is niet bereikbaar. Controleer je internetverbinding en probeer het opnieuw.");
    }
    if (r.ok) return r.status === 204 ? null : r.json();
    let bericht = "";
    try { bericht = (await r.json()).message || ""; } catch (e) { /* geen uitleg */ }
    throw new GitHubFout(r.status, legFoutUit(r.status, bericht), bericht);
  }

  const inhoudPad = (pad) => `/contents/${pad.split("/").map(encodeURIComponent).join("/")}`;

  function naarBase64(tekst) {
    const bytes = new TextEncoder().encode(tekst);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function uitBase64(b64) {
    const bin = atob(String(b64 || "").replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  async function haalBestand(pad, token) {
    try {
      const d = await github(`${inhoudPad(pad)}?ref=${encodeURIComponent(SITE.branch)}`, {}, token);
      return { tekst: uitBase64(d.content), sha: d.sha };
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function schrijfBestand(pad, base64, sha, bericht, token) {
    const d = await github(inhoudPad(pad), {
      method: "PUT",
      body: JSON.stringify({ message: bericht, content: base64, branch: SITE.branch, ...(sha ? { sha } : {}) }),
    }, token);
    return d.content && d.content.sha;
  }

  // Wat je net hebt opgeslagen, zodat je het meteen ziet (ook als GitHub nog even de oude versie geeft)
  const GESCHREVEN = "achtbanen-geschreven";
  function onthoudGeschreven(pad, tekst, sha) {
    let alles = {};
    try { alles = JSON.parse(opslag.lees(GESCHREVEN) || "{}"); } catch (e) { alles = {}; }
    alles[pad] = { tekst, sha, tijd: Date.now() };
    opslag.zet(GESCHREVEN, JSON.stringify(alles));
  }
  function leesGeschreven(pad) {
    try { return JSON.parse(opslag.lees(GESCHREVEN) || "{}")[pad] || null; } catch (e) { return null; }
  }

  // Haalt een JSON-bestand op, past de lijst erin aan en schrijft hem terug, met de sha erbij.
  // Heeft iets anders het bestand intussen gewijzigd (conflict), dan haalt hij het opnieuw op
  // en probeert hij het nog eens.
  async function wijzigJson(pad, lijstSleutel, wijzig, bericht) {
    for (let poging = 1; ; poging++) {
      const bestand = await haalBestand(pad);
      const data = bestand ? leesJsonTekst(bestand.tekst, pad) : {};
      const lijst = Array.isArray(data[lijstSleutel]) ? data[lijstSleutel].slice() : [];
      data[lijstSleutel] = wijzig(lijst);
      const tekst = netteJson(data, lijstSleutel);
      try {
        const sha = await schrijfBestand(pad, naarBase64(tekst), bestand && bestand.sha, bericht);
        onthoudGeschreven(pad, tekst, sha);
        return JSON.parse(tekst); // precies wat er nu in het bestand staat
      } catch (e) {
        const conflict = e.status === 409 || (e.status === 422 && /sha/i.test(e.bericht));
        if (!conflict || poging >= 4) throw e;
        console.warn(`Conflict bij ${pad}, poging ${poging + 1}`);
        await wacht(500 * poging);
      }
    }
  }

  // Beheer: je eigen bestanden komen rechtstreeks van GitHub, dan zie je een wijziging meteen
  async function haalVers(pad) {
    const b = await haalBestand(pad);
    const net = leesGeschreven(pad);
    let tekst = b ? b.tekst : null;
    if (net && Date.now() - net.tijd < 120000 && (!b || b.sha !== net.sha)) tekst = net.tekst;
    return tekst == null ? null : leesJsonTekst(tekst, pad);
  }

  /* ---------- Accounts en credits van iedereen (Supabase) ----------
     Inloggen gaat met een link per e-mail, zonder wachtwoord. Alleen wie is
     uitgenodigd heeft een account. In config.js staat alleen de publieke sleutel;
     de database zelf (row level security) zorgt dat iedereen alleen zijn eigen
     gegevens kan wijzigen. Staat Supabase niet in config.js, dan werkt de site
     zoals vroeger met data/gereden.json. */
  const sbAan = !!(window.supabase && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(SITE.supabaseUrl || "") &&
    /^(sb_publishable_|eyJ)/.test(SITE.supabaseSleutel || ""));
  if (/^sb_secret_/.test(SITE.supabaseSleutel || "")) console.error("In config.js staat een GEHEIME sleutel. Haal hem meteen weg en maak in Supabase een nieuwe aan.");

  // Kwam je binnen via een verlopen of al gebruikte link? Dat staat in het adres.
  // Eerst bewaren, want daarna ruimt de site het adres op.
  const adresHash = new URLSearchParams(location.hash.slice(1));
  const LOGIN_MELDING = "achtbanen-login-melding";
  if (adresHash.get("error_code") || adresHash.get("error_description")) {
    const verlopen = /expired|invalid/i.test(adresHash.get("error_code") + adresHash.get("error_description"));
    try {
      sessionStorage.setItem(LOGIN_MELDING, verlopen
        ? "Deze inloglink is verlopen of al gebruikt. Vraag hieronder een nieuwe aan. Tip: een link werkt maar één keer en een uur lang."
        : `Inloggen lukte niet: ${adresHash.get("error_description") || adresHash.get("error_code")}.`);
    } catch (e) { /* geen opslag */ }
    history.replaceState(null, "", location.pathname + location.search);
    if (PAGINA !== "account") { location.replace("account.html"); return; }
  }
  const welkeLink = adresHash.get("type"); // magiclink of invite

  const sb = sbAan ? window.supabase.createClient(SITE.supabaseUrl.replace(/\/$/, ""), SITE.supabaseSleutel, {
    auth: { storageKey: "achtbanen-sessie", flowType: "implicit", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
  }) : null;

  let sessie = null; // ingelogd? (van Supabase)
  let ik = null;     // je eigen profiel: { id, gebruikersnaam, weergavenaam, in_ranglijst }

  const PROFIEL_VELDEN = "id,gebruikersnaam,weergavenaam,in_ranglijst";
  const GEBRUIKERSNAAM = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;
  // Tekst van gebruikers: geen onzichtbare tekens, geen dubbele spaties
  const netteTekst = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim();

  function metTijd(vraag) {
    return typeof AbortSignal !== "undefined" && AbortSignal.timeout ? vraag.abortSignal(AbortSignal.timeout(20000)) : vraag;
  }

  // Een fout van Supabase in gewone taal
  function sbFout(e, wat) {
    const code = String(e.code || e.error_code || "");
    const bericht = String(e.message || e.msg || "");
    let tekst;
    if (code === "23505" && /gebruikersnaam/.test(bericht)) tekst = "Deze gebruikersnaam is al bezet. Kies een andere.";
    else if (code === "23505" && /profielen_pkey/.test(bericht)) tekst = "Je hebt al een profiel. Laad de pagina opnieuw.";
    else if (code === "23514" || code === "22P02" || code === "22003") tekst = "Een van de velden klopt niet. Controleer wat je hebt ingevuld.";
    else if (code === "23503") tekst = "Maak eerst je profiel op de accountpagina.";
    else if (code === "P0001") tekst = bericht;
    else if (code === "42501" || e.status === 401 || /^PGRST30/.test(code) || /jwt/i.test(bericht)) tekst = "Je bent niet (meer) ingelogd. Log opnieuw in op de accountpagina.";
    else if (e.status === 429 || /rate_limit/.test(code)) tekst = "Even te veel verzoeken. Wacht een minuut en probeer het dan opnieuw.";
    else if (/fetch|network|load failed|abort|timeout/i.test(bericht) || e.name === "AbortError" || e.name === "TimeoutError") {
      tekst = "De accounts zijn nu niet bereikbaar. Is je internet weg? Of de database staat even op pauze; probeer het later nog eens.";
    } else tekst = bericht || "Onbekende fout.";
    return Object.assign(new Error(wat ? `${wat}: ${tekst}` : tekst), { code, status: e.status });
  }

  async function sbVraag(vraag, wat) {
    let r;
    try { r = await vraag; } catch (e) { throw sbFout(e, wat); }
    if (r.error) throw sbFout(r.error, wat);
    return r.data;
  }

  async function haalProfiel(waar) {
    let q = sb.from("profielen").select(PROFIEL_VELDEN);
    q = waar.id ? q.eq("id", waar.id) : q.eq("gebruikersnaam", String(waar.gebruikersnaam || "").toLowerCase());
    return sbVraag(metTijd(q).maybeSingle(), "Profiel ophalen");
  }

  let accountFout = "";
  async function startAccount() {
    if (!sb) return true;
    try {
      const { data } = await sb.auth.getSession();
      sessie = data.session || null;
      if (sessie) ik = await haalProfiel({ id: sessie.user.id });
      // Sessie zonder profiel: bestaat het account nog? (Misschien verwijderd in Supabase.)
      if (sessie && !ik) {
        const { error } = await sb.auth.getUser();
        if (error && (error.status === 401 || error.status === 403 || /not.exist|user_not_found|bad_jwt/i.test(`${error.code} ${error.message}`))) {
          await sb.auth.signOut({ scope: "local" }).catch(() => {});
          try { localStorage.removeItem("achtbanen-sessie"); } catch (e) { /* geen opslag */ }
          sessie = null;
          try { sessionStorage.setItem(LOGIN_MELDING, "Je account bestaat niet meer. Ben je opnieuw uitgenodigd? Log dan hieronder in."); } catch (e) { /* geen opslag */ }
          if (PAGINA !== "account") { location.replace("account.html"); return false; }
        }
      }
    } catch (e) {
      console.warn(e);
      accountFout = e.message;
    }
    // Net binnen via een uitnodiging of een link, maar nog geen profiel: eerst een naam kiezen
    if (sessie && !ik && !accountFout && !["account", "privacy"].includes(PAGINA)) {
      location.replace("account.html");
      return false;
    }
    return true;
  }

  /* ---------- Gegevens laden ---------- */

  async function haalJson(pad, verplicht) {
    let r;
    try { r = await fetch(pad, { cache: "no-cache" }); } catch (e) { r = null; }
    if (!r || !r.ok) {
      if (verplicht) throw new Error(`Het bestand ${pad} kon niet geladen worden${r ? ` (fout ${r.status})` : ""}.`);
      return null;
    }
    return leesJsonTekst(await r.text(), pad);
  }

  let apiWaarschuwing = "";
  async function laadEigen(pad) {
    if (beheer) {
      try { return await haalVers(pad); } catch (e) {
        console.warn(e);
        apiWaarschuwing = `De nieuwste versie kon niet bij GitHub opgehaald worden. ${e.message}`;
      }
    }
    return haalJson(pad, false);
  }

  let geladen = null;
  function laadAlles() {
    geladen = geladen || (async () => {
      const [basis, extra, mijn, splitsBestand, verborgenBestand, fotoBestand] = await Promise.all([
        haalJson("data/achtbanen.json", true),
        laadEigen("data/extra.json"),
        laadEigen("data/gereden.json"),
        laadEigen("data/splitsen.json"),
        laadEigen("data/verborgen.json"),
        laadEigen("data/fotos.json"),
      ]);
      // Verwijzingen: oude ids (bijvoorbeeld een OSM-baan die nu in Wikidata staat, of een
      // regel uit extra.json die nu in de bronnen staat) wijzen naar de achtbaan van nu
      const aliassen = basis.aliassen || {};
      let lijst = [...(basis.achtbanen || []), ...((extra && extra.achtbanen) || []).filter((a) => a && !aliassen[a.id])]
        .filter((a) => a && a.id && a.naam);

      // Banen met losse sporen (data/splitsen.json): elk spoor wordt een eigen achtbaan,
      // met id <id>-1, <id>-2, ... Een rit op de hele baan telt voor elk spoor.
      const splitsen = new Map();
      for (const s of (splitsBestand && splitsBestand.splitsen) || []) {
        if (s && s.id && Array.isArray(s.sporen) && s.sporen.length >= 2) splitsen.set(s.id, s.sporen.map(String));
      }
      const sporenVan = new Map();
      lijst = lijst.flatMap((a) => {
        const namen = splitsen.get(a.id);
        if (!namen) return [a];
        const sporen = namen.map((naam, i) => ({
          ...a, id: `${a.id}-${i + 1}`, naam, deelVan: a.id, heleNaam: a.naam, spoor: i + 1,
          wikidata: /^Q\d+$/.test(a.id) ? a.id : a.wikidata,
        }));
        sporenVan.set(a.id, sporen);
        return sporen;
      });

      // Verborgen banen (data/verborgen.json): geen achtbaan, of dubbel
      const verborgen = new Map(((verborgenBestand && verborgenBestand.verborgen) || []).filter((v) => v && v.id).map((v) => [v.id, v]));
      const verborgenBanen = new Map(lijst.filter((a) => verborgen.has(a.id)).map((a) => [a.id, a]));
      lijst = lijst.filter((a) => !verborgen.has(a.id));

      const perId = new Map(lijst.map((a) => [a.id, a]));
      for (const [id, sporen] of sporenVan) if (!perId.has(id) && perId.has(sporen[0].id)) perId.set(id, sporen[0]);
      for (const [oud, nieuw] of Object.entries(aliassen)) if (!perId.has(oud) && perId.has(nieuw)) perId.set(oud, perId.get(nieuw));
      for (const a of lijst) a._zoek = zoekbaar([a.naam, a.heleNaam, a.park, a.land, a.fabrikant, a.type].join(" "));
      const data = {
        lijst, perId, aliassen, sporenVan, verborgen, verborgenBanen, echteIds: new Set(lijst.map((a) => a.id)),
        voorstellen: basis.splitsvoorstellen || {},
        bijgewerkt: basis.bijgewerkt, details: basis.details, extra: (extra && extra.achtbanen) || [],
        // Je credits uit gereden.json: zonder Supabase de echte lijst, met Supabase de reservekopie
        jsonRitten: ((mijn && mijn.gereden) || []).filter((r) => r && r.id),
        persoon: null,
      };
      zetFotos(data, (fotoBestand && fotoBestand.fotos) || []);
      zetRitten(data, data.jsonRitten);
      if (apiWaarschuwing) setTimeout(() => toast(apiWaarschuwing, true), 400);
      return data;
    })();
    return geladen;
  }

  // Koppelt de ritten uit gereden.json aan de achtbanen. Wordt na elke wijziging opnieuw gedaan.
  function zetRitten(data, ritten) {
    data.ritten = ritten.filter((r) => r && r.id);
    data.onbekend = [];
    for (const a of data.lijst) { delete a.ritten; delete a.rit; delete a.creditDatum; delete a.laatsteDatum; }
    for (const rit of data.ritten) {
      const banen = banenVanRit(data, rit.id);
      if (!banen.length) { data.onbekend.push(rit); continue; }
      for (const a of banen) (a.ritten = a.ritten || []).push(rit);
    }
    for (const a of data.lijst) {
      if (!a.ritten) continue;
      a.ritten.sort((x, y) => String(x.datum || "9999").localeCompare(String(y.datum || "9999")));
      // Eerste rit telt; cijfer, notitie en foto mogen in een latere regel staan
      a.rit = Object.assign({}, ...a.ritten.slice().reverse(), { datum: a.ritten[0].datum });
      // Ritten zonder datum tellen gewoon mee. Maar heeft één rit op deze baan geen datum,
      // dan weten we niet wanneer je eerste rit was: dan doet de baan niet mee voor
      // "eerste credit" en "nieuwste credit".
      const metDatum = a.ritten.filter((r) => r.datum);
      a.creditDatum = metDatum.length === a.ritten.length ? a.ritten[0].datum : null;
      a.laatsteDatum = metDatum.length ? metDatum[metDatum.length - 1].datum : null;
    }
    data.gereden = data.lijst.filter((a) => a.rit);
    if (data.onbekend.length) console.warn("Deze codes uit gereden.json staan niet in de lijst:", data.onbekend.map((r) => r.id));
  }

  // Bij welke achtbaan (of welke sporen) hoort een rit? Een rit op een gesplitste baan
  // telt voor elk spoor; een oude id volgt de verwijzing.
  function banenVanRit(data, id) {
    const doel = data.aliassen[id] && !data.echteIds.has(id) ? data.aliassen[id] : id;
    if (data.sporenVan.has(doel)) return data.sporenVan.get(doel).filter((s) => data.perId.get(s.id) === s);
    if (data.sporenVan.has(id)) return data.sporenVan.get(id).filter((s) => data.perId.get(s.id) === s);
    const a = data.perId.get(id);
    return a ? [a] : [];
  }

  async function bewaarRitten(data, wijzig, bericht) {
    const nieuw = await wijzigJson("data/gereden.json", "gereden", wijzig, bericht);
    data.jsonRitten = nieuw.gereden;
    if (data.persoon) data.persoon.ritten = nieuw.gereden;
    zetRitten(data, nieuw.gereden);
  }

  // Je eigen foto's per achtbaan (data/fotos.json, alleen via beheer). Een foto die nog
  // bij een oude rit in gereden.json staat, telt ook.
  function zetFotos(data, fotos) {
    data.fotos = fotos.filter((f) => f && f.id && eigenPad(f.foto));
    for (const a of data.lijst) delete a.eigenFoto;
    for (const r of data.jsonRitten) if (r.foto) for (const a of banenVanRit(data, r.id)) a.eigenFoto = r.foto;
    for (const f of data.fotos) {
      const a = data.perId.get(f.id) || data.verborgenBanen.get(f.id);
      if (a) a.eigenFoto = f.foto;
    }
  }

  /* ---------- Ritten in Supabase ----------
     In de database heet een rit { id, achtbaan, datum, cijfer, notitie }. Op de site
     gebruiken we dezelfde vorm als in gereden.json: { id: <achtbaan>, datum, cijfer, notitie },
     met het rijnummer uit de database er onzichtbaar bij. */
  const ACHTBAAN_ID = /^(Q[1-9][0-9]*|osm-(node|way|relation)-[1-9][0-9]*|x-[a-z0-9]+(-[a-z0-9]+)*)(-[1-9][0-9]?)?$/;
  function naarRit(r) {
    const rit = { id: r.achtbaan };
    if (r.datum) rit.datum = r.datum;
    if (r.cijfer != null) rit.cijfer = Number(r.cijfer);
    if (r.notitie) rit.notitie = r.notitie;
    Object.defineProperty(rit, "_rij", { value: r.id, enumerable: false });
    return rit;
  }
  // Zelfde regels als in de database: leeg, 2006, 2006-07 of 2006-07-14 (een echte dag)
  function geldigeDatum(d) {
    if (!d) return true;
    const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(d));
    if (!m || +m[1] < 1900 || +m[1] > 2100) return false;
    if (!m[2]) return true;
    if (+m[2] < 1 || +m[2] > 12) return false;
    return !m[3] || new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDate() === +m[3];
  }
  function naarRij(rit) {
    if (!ACHTBAAN_ID.test(rit.id || "") || rit.id.length > 100) throw new Error(`Onbekende achtbaan-code: ${rit.id}`);
    if (!geldigeDatum(rit.datum)) throw new Error(`Deze datum klopt niet: ${rit.datum}`);
    if (rit.cijfer != null && !(Number(rit.cijfer) >= 1 && Number(rit.cijfer) <= 10)) throw new Error("Een cijfer moet tussen 1 en 10 liggen.");
    const notitie = netteTekst(rit.notitie).slice(0, 200);
    return { achtbaan: rit.id, datum: rit.datum || null, cijfer: rit.cijfer ?? null, notitie: notitie || null };
  }

  // Alle ritten van één persoon (Supabase geeft er hooguit 1000 per keer)
  async function haalRitten(gebruiker) {
    const alle = [];
    for (let van = 0; ; van += 1000) {
      const rijen = await sbVraag(metTijd(sb.from("ritten").select("id,achtbaan,datum,cijfer,notitie")
        .eq("gebruiker", gebruiker).order("id").range(van, van + 999)), "Credits ophalen");
      alle.push(...rijen);
      if (rijen.length < 1000) break;
    }
    return alle.map(naarRit);
  }

  // Wiens credits toont deze pagina, en mag je ze hier aanpassen?
  //   { profiel, ritten, bron: "supabase" | "json", bewerkbaar, nogOverzetten }
  async function laadPersoon(data, profiel) {
    const ritten = await haalRitten(profiel.id);
    if (profiel.gebruikersnaam === SITE.eigenaar && !ritten.length && data.jsonRitten.length) {
      // Je credits staan nog alleen in gereden.json: die tonen tot je ze hebt overgezet
      return { profiel, ritten: data.jsonRitten, bron: "json", bewerkbaar: false, nogOverzetten: true };
    }
    return { profiel, ritten, bron: "supabase", bewerkbaar: !!ik && ik.id === profiel.id };
  }
  async function laadEigenaar(data) {
    if (!sbAan) return { profiel: null, ritten: data.jsonRitten, bron: "json", bewerkbaar: beheer };
    try {
      const p = await haalProfiel({ gebruikersnaam: SITE.eigenaar });
      if (p) return await laadPersoon(data, p);
      return { profiel: null, ritten: data.jsonRitten, bron: "json", bewerkbaar: false, nogOverzetten: true };
    } catch (e) {
      console.warn(e);
      return { profiel: null, ritten: data.jsonRitten, bron: "json", bewerkbaar: false,
        storing: "De accounts zijn even niet bereikbaar. Je ziet nu de reservekopie van de credits." };
    }
  }
  function zetPersoon(data, persoon) {
    data.persoon = persoon;
    zetRitten(data, persoon.ritten);
    if (persoon.storing) setTimeout(() => toast(persoon.storing, true), 600);
  }
  const magRitten = (data) => !!(data.persoon && data.persoon.bewerkbaar);
  const inSupabase = (data) => !!(data.persoon && data.persoon.bron === "supabase");

  async function herlaadRitten(data) {
    const p = data.persoon;
    if (inSupabase(data)) p.ritten = await haalRitten(p.profiel.id);
    zetRitten(data, p.ritten);
  }

  // Een rit op de hele baan bij een gesplitste baan: voor welke sporen telt hij?
  function sporenVanRit(data, a, rit) {
    if (!a.deelVan || rit.id === a.id) return null;
    const sporen = banenVanRit(data, rit.id);
    return sporen.length >= 2 ? sporen : null;
  }

  /* De ritbron: zonder Supabase gaat alles naar gereden.json op GitHub (met je token),
     met Supabase naar je eigen account. Dezelfde knoppen, hetzelfde venster. */
  const ritBron = {
    // Nieuwe ritten. "alleNieuw" laat ritten weg voor banen die al op je lijst staan.
    async voegToe(data, ritten, bericht, alleNieuw) {
      if (!inSupabase(data)) {
        return bewaarRitten(data, (lijst) => {
          if (!alleNieuw) return [...lijst, ...ritten];
          const al = new Set(lijst.map((r) => r && data.perId.get(r.id)).filter(Boolean));
          return [...lijst, ...ritten.filter((r) => !al.has(data.perId.get(r.id)))];
        }, bericht);
      }
      let nieuw = ritten;
      if (alleNieuw) {
        await herlaadRitten(data); // misschien heb je intussen op een ander apparaat iets afgevinkt
        const al = new Set(data.persoon.ritten.map((r) => data.perId.get(r.id)).filter(Boolean));
        nieuw = ritten.filter((r) => !al.has(data.perId.get(r.id)));
      }
      if (nieuw.length) await sbVraag(sb.from("ritten").insert(nieuw.map(naarRij)), "Opslaan lukte niet");
      await herlaadRitten(data);
    },

    async wijzig(data, a, oud, rit, bericht) {
      if (!inSupabase(data)) {
        return bewaarRitten(data, (lijst) => {
          const eigen = ritVoorDitSpoor(data, lijst, oud, a);
          if (eigen !== oud) rit.id = a.id;
          const i = vindRit(lijst, eigen);
          if (i < 0) throw new Error("Deze rit is intussen op een andere plek gewijzigd. Laad de pagina opnieuw en probeer het nog eens.");
          lijst[i] = rit;
          return lijst;
        }, bericht);
      }
      const sporen = sporenVanRit(data, a, oud);
      const velden = naarRij({ ...rit, id: sporen ? a.id : oud.id });
      await sbWijzigRij(oud._rij, velden);
      // De rit gold voor alle sporen: de andere sporen houden hun eigen kopie
      if (sporen) {
        const kopieen = sporen.filter((s) => s !== a).map((s) => naarRij({ ...oud, id: s.id }));
        if (kopieen.length) await sbVraag(sb.from("ritten").insert(kopieen), "Opslaan lukte niet");
      }
      await herlaadRitten(data);
    },

    async verwijder(data, a, oud, bericht) {
      if (!inSupabase(data)) {
        return bewaarRitten(data, (lijst) => {
          const i = vindRit(lijst, ritVoorDitSpoor(data, lijst, oud, a));
          if (i < 0) throw new Error("Deze rit staat niet meer in gereden.json. Laad de pagina opnieuw.");
          lijst.splice(i, 1);
          return lijst;
        }, bericht);
      }
      const sporen = sporenVanRit(data, a, oud);
      if (sporen) {
        const kopieen = sporen.filter((s) => s !== a).map((s) => naarRij({ ...oud, id: s.id }));
        if (kopieen.length) await sbVraag(sb.from("ritten").insert(kopieen), "Verwijderen lukte niet");
      }
      const weg = await sbVraag(sb.from("ritten").delete().eq("id", oud._rij).select("id"), "Verwijderen lukte niet");
      if (!weg.length) throw new Error("Deze rit bestaat niet meer. Laad de pagina opnieuw.");
      await herlaadRitten(data);
    },
  };

  async function sbWijzigRij(rij, velden) {
    const d = await sbVraag(sb.from("ritten").update(velden).eq("id", rij).select("id"), "Opslaan lukte niet");
    if (!d.length) throw new Error("Deze rit bestaat niet meer. Laad de pagina opnieuw.");
  }

  /* ---------- Iedereen: profielen en ritten van alle vrienden ---------- */

  async function haalAlles(tabel, velden, wat) {
    const alle = [];
    for (let van = 0; ; van += 1000) {
      const rijen = await sbVraag(metTijd(sb.from(tabel).select(velden).order("id").range(van, van + 999)), wat);
      alle.push(...rijen);
      if (rijen.length < 1000) return alle;
    }
  }
  let iedereenBelofte = null;
  function laadIedereen() {
    iedereenBelofte = iedereenBelofte || Promise.all([
      haalAlles("profielen", PROFIEL_VELDEN, "Vrienden ophalen"),
      haalAlles("ritten", "id,gebruiker,achtbaan", "Credits van vrienden ophalen"),
    ]).then(([profielen, ritten]) => ({ profielen, ritten }));
    iedereenBelofte.catch(() => { iedereenBelofte = null; }); // later opnieuw proberen
    return iedereenBelofte;
  }

  // Per persoon de banen die hij of zij gereden heeft, op dezelfde manier geteld als de teller
  function banenPerPersoon(data, iedereen) {
    const per = new Map(iedereen.profielen.map((p) => [p.id, { profiel: p, banen: new Set() }]));
    for (const r of iedereen.ritten) {
      const x = per.get(r.gebruiker);
      if (x) for (const a of banenVanRit(data, r.achtbaan)) x.banen.add(a);
    }
    // De eigenaar zonder ritten in Supabase: zijn credits staan nog in gereden.json
    for (const x of per.values()) {
      if (x.profiel.gebruikersnaam === SITE.eigenaar && !x.banen.size) {
        for (const r of data.jsonRitten) for (const a of banenVanRit(data, r.id)) x.banen.add(a);
      }
    }
    return per;
  }
  const opWeergavenaam = (x, y) => x.weergavenaam.localeCompare(y.weergavenaam, TAAL);

  // Wordt er na het opslaan nog iets gepubliceerd (GitHub), of zie je het meteen (Supabase)?
  const opgeslagenTekst = (data, wat = "Opgeslagen") =>
    inSupabase(data) ? `${wat}.` : `${wat}. Over een paar minuten staat het ook op de openbare site.`;

  /* ---------- Startpagina ---------- */

  const BAAN = "M0,226 L120,226 C165,226 185,218 205,200 L430,42 C452,26 474,26 492,46 " +
    "C522,82 548,200 590,222 C625,238 652,230 672,210 C700,172 728,132 765,132 " +
    "C802,132 822,172 846,206 C866,234 896,238 930,226 C995,226 1052,198 1054,150 " +
    "C1056,100 994,86 974,118 C956,148 976,206 1032,218 C1080,228 1140,226 1200,226";

  function startBaan() {
    const knop = $("#baan");
    if (!knop) return;
    const NS = "http://www.w3.org/2000/svg";
    const svg = $("svg", knop);
    svg.querySelectorAll("path[data-baan]").forEach((p) => p.setAttribute("d", BAAN));
    const pad = $(".baan-rails", svg);
    const lengte = pad.getTotalLength();

    // Steunpalen: van het laagste stuk baan recht naar beneden
    const grond = 240;
    const punten = [];
    for (let s = 0; s <= lengte; s += 2) punten.push(pad.getPointAtLength(s));
    const steunen = $("#steunen", svg);
    for (let x = 14; x < 1200; x += 24) {
      let laagste = -Infinity;
      for (const p of punten) if (Math.abs(p.x - x) < 1.5 && p.y > laagste) laagste = p.y;
      if (laagste > -Infinity && grond - laagste > 12) {
        const lijn = document.createElementNS(NS, "line");
        lijn.setAttribute("x1", x); lijn.setAttribute("x2", x);
        lijn.setAttribute("y1", laagste + 5); lijn.setAttribute("y2", grond);
        steunen.appendChild(lijn);
      }
    }

    // De trein: drie wagentjes die over de baan rijden
    const trein = $("#trein", svg);
    const klein = matchMedia("(max-width: 40rem)").matches;
    const wagens = [0, 1, 2].map(() => {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", -11); r.setAttribute("y", klein ? -21 : -15);
      r.setAttribute("width", 22); r.setAttribute("height", klein ? 12 : 10); r.setAttribute("rx", 3);
      trein.appendChild(r);
      return r;
    });
    let top = { s: 0, y: Infinity };
    for (let s = 0; s < lengte * 0.5; s += 2) {
      const p = pad.getPointAtLength(s);
      if (p.y < top.y) top = { s, y: p.y };
    }

    let bezig = false;
    function rit() {
      if (bezig || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      bezig = true;
      trein.style.opacity = 1;
      let s = 0, vorige = null;
      const tussen = 25;
      function frame(t) {
        const dt = vorige == null ? 0 : Math.min(0.04, (t - vorige) / 1000);
        vorige = t;
        const p = pad.getPointAtLength(Math.min(s, lengte));
        // Optakeling met de ketting, daarna laat de zwaartekracht hem gaan
        const v = s < top.s ? 175 : Math.sqrt(45 * 45 + 2 * 760 * Math.max(0, p.y - top.y));
        s += v * dt;
        wagens.forEach((w, i) => {
          const pos = s - i * tussen;
          if (pos < 0 || pos > lengte) { w.style.visibility = "hidden"; return; }
          const a = pad.getPointAtLength(pos);
          const b = pad.getPointAtLength(Math.min(lengte, pos + 1.5));
          const hoek = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
          w.style.visibility = "visible";
          w.setAttribute("transform", `translate(${a.x.toFixed(1)} ${a.y.toFixed(1)}) rotate(${hoek.toFixed(1)})`);
        });
        if (s - 2 * tussen < lengte) requestAnimationFrame(frame);
        else { bezig = false; trein.style.opacity = 0; }
      }
      requestAnimationFrame(frame);
    }
    knop.addEventListener("click", rit);
    setTimeout(rit, 500);
  }

  const telLanden = (banen) => new Set(banen.map((a) => a.land).filter(Boolean)).size;
  const telParken = (banen) => new Set(banen.map((a) => a.parkId || a.park).filter(Boolean)).size;

  function vulHero(data) {
    const gereden = data.gereden;
    const n = gereden.length;
    $("#aantal").textContent = getal(n);
    $("#teller-uitleg").textContent = meervoud(n, "achtbaan gereden", "achtbanen gereden");
    const landen = telLanden(gereden), parken = telParken(gereden);
    $("#teller-sub").textContent = n
      ? `in ${landen} ${meervoud(landen, "land", "landen")} en ${parken} ${meervoud(parken, "park", "parken")}`
      : magRitten(data)
        ? "De teller staat nog op nul. Kies Afvinken bij Alle achtbanen, of open een achtbaan en kies Zet op mijn lijst."
        : "De teller staat nog op nul.";
  }

  function vulFeiten(gereden) {
    const vak = $("#feiten");
    if (!gereden.length) { vak.hidden = true; vak.innerHTML = ""; return; }
    const hoogste = (veld) => gereden.filter((a) => a[veld]).sort((a, b) => b[veld] - a[veld])[0];
    const opDatum = gereden.filter((a) => a.creditDatum)
      .sort((a, b) => String(a.creditDatum).localeCompare(String(b.creditDatum)));
    const favoriet = gereden.filter((a) => Number(a.rit.cijfer))
      .sort((a, b) => b.rit.cijfer - a.rit.cijfer)[0];
    const eerste = opDatum[0];
    const laatste = opDatum.length > 1 ? opDatum[opDatum.length - 1] : null;

    const feiten = [
      ["Hoogste", hoogste("hoogte"), (a) => `${getal(a.hoogte, 1)} m`],
      ["Snelste", hoogste("snelheid"), (a) => `${getal(a.snelheid)} km/u`],
      ["Langste", hoogste("lengte"), (a) => `${getal(a.lengte)} m`],
      ["Favoriet", favoriet, (a) => `${getal(a.rit.cijfer, 1)}/10`],
      ["Eerste credit", eerste, (a) => datum(a.creditDatum, true)],
      ["Nieuwste credit", laatste, (a) => datum(a.creditDatum, true)],
    ].filter(([, a]) => a);

    vak.innerHTML = feiten.map(([label, a, waarde]) => `
      <a class="feit" href="${pagina(a)}">
        <span class="feit-label">${label}</span>
        <span class="feit-waarde">${esc(waarde(a))}</span>
        <span class="feit-naam">${esc(a.naam)}</span>
      </a>`).join("");
    vak.hidden = false;
  }

  let grooteKaart = null;
  function tekenKaart(gereden) {
    const sectie = $("#kaart-sectie");
    const metPlek = gereden.filter((a) => a.lat != null && a.lon != null);
    if (grooteKaart) { grooteKaart.remove(); grooteKaart = null; }
    if (!metPlek.length || !window.L) { sectie.hidden = true; return; }
    sectie.hidden = false;

    const groepen = new Map();
    for (const a of metPlek) {
      const sleutel = a.parkId || a.park || `${a.lat},${a.lon}`;
      if (!groepen.has(sleutel)) groepen.set(sleutel, { naam: a.park || a.land || "", lat: a.lat, lon: a.lon, banen: [] });
      groepen.get(sleutel).banen.push(a);
    }

    const kaart = grooteKaart = L.map("kaart", { scrollWheelZoom: false, worldCopyJump: true });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(kaart);
    const kleur = getComputedStyle(document.documentElement).getPropertyValue("--rail").trim() || "#cf2236";

    for (const g of groepen.values()) {
      const n = g.banen.length;
      L.circleMarker([g.lat, g.lon], {
        radius: Math.min(16, 6 + n * 1.5), color: "#fff", weight: 2, fillColor: kleur, fillOpacity: 0.95,
      }).bindPopup(`
        <p class="popup-park">${esc(g.naam)}</p>
        <ul class="popup-lijst">${g.banen.map((a) => `<li><a href="${pagina(a)}">${esc(a.naam)}</a></li>`).join("")}</ul>`)
        .addTo(kaart);
    }
    const grenzen = L.latLngBounds(metPlek.map((a) => [a.lat, a.lon]));
    kaart.fitBounds(grenzen.pad(0.25), { maxZoom: 9 });
  }

  const opNaam = (a, b) => a.naam.localeCompare(b.naam, TAAL);
  const ritSleutel = (a) => (a.rit ? String(a.laatsteDatum || "0") : "");
  const SORTERINGEN = {
    naam: opNaam,
    nieuw: (a, b) => (b.geopend || 0) - (a.geopend || 0) || opNaam(a, b),
    oud: (a, b) => (a.geopend || 9999) - (b.geopend || 9999) || opNaam(a, b),
    hoog: (a, b) => (b.hoogte || 0) - (a.hoogte || 0) || opNaam(a, b),
    snel: (a, b) => (b.snelheid || 0) - (a.snelheid || 0) || opNaam(a, b),
    rit: (a, b) => ritSleutel(b).localeCompare(ritSleutel(a)) || opNaam(a, b),
  };

  function kaartHtml(a, gekozen) {
    const foto = a.eigenFoto || a.rit?.foto || a.foto;
    const src = fotoBron(foto, 500);
    const plek = [a.park, a.land].filter(Boolean).join(", ");
    const eigen = eigenPad(foto);
    // Afvinkmodus: het hele kaartje is een vinkje, zodat je snel kunt tikken
    const afvink = !!gekozen;
    const tag = afvink ? "label" : "a";
    const klassen = `kaart${a.rit ? " is-gereden" : ""}${afvink ? " is-afvink" : ""}${afvink && gekozen.has(a.id) ? " is-gekozen" : ""}`;
    const vinkje = afvink
      ? `<input type="checkbox" class="afvink-vak" value="${esc(a.id)}"${a.rit ? " checked disabled" : gekozen.has(a.id) ? " checked" : ""}>`
      : "";
    return `
      <${tag} class="${klassen}"${afvink ? "" : ` href="${pagina(a)}"`}>${vinkje}
        <span class="kaart-foto">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async"${eigen ? ` data-eigen="${esc(eigen)}"` : ""}>` : ""}</span>
        <span class="kaart-tekst">
          <span class="kaart-naam">${esc(a.naam)}</span>
          ${plek ? `<span class="kaart-plek">${esc(plek)}</span>` : ""}
          <span class="kaart-meta">${esc(statusTekst(a))}</span>
          ${a.rit ? `<span class="kaart-rit">✓ Gereden${a.creditDatum ? " " + esc(datum(a.creditDatum, true)) : ""}</span>` : ""}
        </span>
      </${tag}>`;
  }

  function startOverzicht(data, naWijziging) {
    const { lijst } = data;
    const el = {
      zoek: $("#zoek"), land: $("#land"), status: $("#status"), sorteer: $("#sorteer"),
      gereden: $("#alleen-gereden"), raster: $("#raster"), meer: $("#meer"),
      tekst: $("#resultaten-tekst"), park: $("#park-filter"), filters: $(".filters"),
      door: $("#door"), doorVeld: $("#door-veld"),
    };

    const perLand = new Map();
    for (const a of lijst) if (a.land) perLand.set(a.land, (perLand.get(a.land) || 0) + 1);
    [...perLand.entries()]
      .sort((x, y) => x[0].localeCompare(y[0], TAAL))
      .forEach(([land, n]) => el.land.add(new Option(`${land} (${getal(n)})`, land)));

    const st = {
      q: params.get("q") || "",
      land: params.get("land") || "",
      status: params.get("status") || "",
      sorteer: SORTERINGEN[params.get("sorteer")] ? params.get("sorteer") : "naam",
      gereden: params.get("gereden") === "1",
      park: params.get("park") || "",
      door: (params.get("door") || "").toLowerCase(),
      toon: PER_KEER,
    };
    el.zoek.value = st.q;
    el.land.value = st.land; st.land = el.land.value;
    el.status.value = st.status; st.status = el.status.value;
    el.sorteer.value = st.sorteer;
    el.gereden.checked = st.gereden;

    let resultaat = [];

    function bewaarInAdres() {
      const u = new URLSearchParams();
      if (params.get("wie")) u.set("wie", params.get("wie")); // profielpagina: wie blijft staan
      if (st.q) u.set("q", st.q);
      if (st.land) u.set("land", st.land);
      if (st.status) u.set("status", st.status);
      if (st.sorteer !== "naam") u.set("sorteer", st.sorteer);
      if (st.gereden) u.set("gereden", "1");
      if (st.park) u.set("park", st.park);
      if (st.door) u.set("door", st.door);
      const qs = u.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }

    function parkNaam() {
      const a = lijst.find((x) => x.parkId === st.park || x.park === st.park);
      return a ? a.park : st.park;
    }

    // Filter "Gereden door …": de banen van één vriend (jezelf: zoals je lijst nu is)
    let perPersoon = null;
    const doorProfiel = () => (perPersoon ? [...perPersoon.values()].find((x) => x.profiel.gebruikersnaam === st.door) : null);
    function doorBanen() {
      if (!st.door) return null;
      if (data.persoon && data.persoon.profiel && data.persoon.profiel.gebruikersnaam === st.door) return new Set(data.gereden);
      const x = doorProfiel();
      return x ? x.banen : null;
    }
    if (sbAan && el.door) {
      el.doorVeld.hidden = false;
      el.filters.classList.add("met-door");
      laadIedereen().then((iedereen) => {
        perPersoon = banenPerPersoon(data, iedereen);
        const mensen = iedereen.profielen
          .filter((p) => p.in_ranglijst || (ik && ik.id === p.id) || p.gebruikersnaam === st.door)
          .sort(opWeergavenaam);
        for (const p of mensen) el.door.add(new Option(ik && ik.id === p.id ? `${p.weergavenaam} (ik)` : p.weergavenaam, p.gebruikersnaam));
        el.door.value = st.door;
        if (st.door) { st.door = el.door.value; bereken(); toon(false); }
      }).catch((e) => { console.warn(e); el.doorVeld.hidden = true; el.filters.classList.remove("met-door"); });
      el.door.addEventListener("change", () => { st.door = el.door.value; ververs(); });
    }

    function bereken() {
      const woorden = zoekbaar(st.q).split(/\s+/).filter(Boolean);
      const door = doorBanen();
      resultaat = lijst.filter((a) =>
        (!door || door.has(a)) &&
        (!st.gereden || a.rit) &&
        (!st.land || a.land === st.land) &&
        (!st.status || a.status === st.status) &&
        (!st.park || a.parkId === st.park || a.park === st.park) &&
        woorden.every((w) => a._zoek.includes(w)));
      resultaat.sort(SORTERINGEN[st.sorteer]);
    }

    function toon(alleenNieuwe) {
      const n = resultaat.length;
      const gefilterd = st.q || st.land || st.status || st.park || st.gereden || st.door;
      const door = st.door && doorProfiel() ? `, gereden door ${doorProfiel().profiel.weergavenaam}` : "";
      el.tekst.textContent = st.gereden
        ? `${getal(n)} ${meervoud(n, "credit", "credits")}${door}`
        : `${getal(n)} ${meervoud(n, "achtbaan", "achtbanen")}${gefilterd ? " gevonden" : " in de lijst"}${door}`;

      el.park.innerHTML = st.park
        ? `<button class="chip" type="button" id="park-wis">Alleen ${esc(parkNaam())} <span aria-hidden="true">×</span><span class="sr">filter wissen</span></button>`
        : "";
      if (st.park) $("#park-wis").addEventListener("click", () => { st.park = ""; ververs(); });

      if (!n) {
        el.raster.innerHTML = `<div class="leeg">
          <p>Geen achtbanen gevonden met deze zoekopdracht en filters.</p>
          <div class="knoppen-rij"><button class="knop knop-licht" type="button" id="wis-alles">Filters wissen</button>
          ${beheer ? '<button class="knop" type="button" id="ontbreekt-leeg">Achtbaan ontbreekt</button>' : ""}</div></div>`;
        $("#wis-alles").addEventListener("click", wisAlles);
        el.meer.hidden = true;
        return;
      }
      const kaartje = (a) => kaartHtml(a, af.aan ? af.gekozen : null);
      el.raster.classList.toggle("is-afvink", af.aan);
      if (alleenNieuwe) {
        el.raster.insertAdjacentHTML("beforeend", resultaat.slice(st.toon - PER_KEER, st.toon).map(kaartje).join(""));
      } else {
        el.raster.innerHTML = resultaat.slice(0, st.toon).map(kaartje).join("");
      }
      const over = n - st.toon;
      el.meer.hidden = over <= 0;
      el.meer.textContent = `Toon meer (nog ${getal(over)})`;
      tekenAfvink();
    }

    /* ---------- Afvinkmodus (je eigen lijst) ----------
       Een vinkje op elk kaartje. Je keuze blijft bewaard als je filtert of de pagina
       herlaadt. Opslaan zet alles in één keer in je account (zonder Supabase: in één
       commit in gereden.json). Achtbaan ontbreekt is alleen voor beheer. */
    const kanAfvinken = magRitten(data);
    const eigenaarMoetOverzetten = !kanAfvinken && !!(data.persoon && data.persoon.nogOverzetten && ik && ik.gebruikersnaam === SITE.eigenaar);
    const balkNodig = kanAfvinken || beheer || eigenaarMoetOverzetten;
    const AFVINK = `achtbanen-afvink${data.persoon && data.persoon.profiel ? `-${data.persoon.profiel.id}` : ""}`;
    const af = { aan: false, gekozen: new Set() };
    if (balkNodig) {
      if (kanAfvinken) {
        try {
          const b = JSON.parse(opslag.lees(AFVINK) || "null");
          if (b) { af.aan = !!b.aan; af.gekozen = new Set((b.ids || []).filter((id) => data.perId.has(id))); }
        } catch (e) { /* begin leeg */ }
      }
      el.filters.insertAdjacentHTML("afterend", '<div class="beheer-balk" id="beheer-balk"></div>');
      $("#overzicht").insertAdjacentHTML("beforeend", '<div class="afvink-balk" id="afvink-balk" hidden></div>');
    }
    const bewaarAfvink = () => opslag.zet(AFVINK, JSON.stringify({ aan: af.aan, ids: [...af.gekozen] }));
    const nogTeKiezen = () => resultaat.filter((a) => !a.rit && !af.gekozen.has(a.id));

    function tekenAfvink() {
      if (!balkNodig) return;
      const balk = $("#beheer-balk"), onder = $("#afvink-balk");
      if (!af.aan) {
        const uitleg = kanAfvinken && beheer ? "Snel een hele rij achtbanen op je lijst zetten, of er zelf een toevoegen."
          : kanAfvinken ? "Snel een hele rij achtbanen op je lijst zetten." : beheer ? "Staat een achtbaan er niet tussen? Voeg hem zelf toe." : "";
        balk.innerHTML = `${eigenaarMoetOverzetten ? '<p><strong>Je credits staan nog in gereden.json.</strong> <a href="account.html">Zet ze over naar je account</a>, dan kun je hier weer afvinken.</p>' : ""}
          ${kanAfvinken ? '<button class="knop knop-licht" type="button" id="afvink-aan">Afvinken</button>' : ""}
          ${beheer ? '<button class="knop knop-licht" type="button" id="ontbreekt">Achtbaan ontbreekt</button>' : ""}
          ${uitleg ? `<span class="klein">${uitleg}</span>` : ""}`;
        onder.hidden = true;
        return;
      }
      balk.innerHTML = `<p><strong>Afvinkmodus.</strong> Tik op elke achtbaan die je gereden hebt. Tip: filter op een park of land en kies <em>Alles kiezen</em>.</p>`;
      const n = af.gekozen.size, rest = nogTeKiezen().length;
      if (!onder.dataset.klaar) {
        onder.innerHTML = `<p class="afvink-aantal" aria-live="polite"></p>
          <div class="afvink-knoppen">
            <button class="knop-klein" type="button" id="afvink-alles"></button>
            <button class="knop-klein" type="button" id="afvink-niets">Niets kiezen</button>
            <label class="afvink-jaar">Jaar <input type="number" id="afvink-jaar" inputmode="numeric" min="1900" max="${new Date().getFullYear() + 1}" placeholder="mag leeg"></label>
            <button class="knop-klein" type="button" id="afvink-stop">Stoppen</button>
          </div>
          <button class="knop" type="button" id="afvink-opslaan">Opslaan</button>
          <p class="fout" id="afvink-fout" role="alert"></p>`;
        onder.dataset.klaar = "1";
      }
      $(".afvink-aantal", onder).innerHTML = `<strong>${getal(n)}</strong> ${meervoud(n, "achtbaan", "achtbanen")} gekozen`;
      $("#afvink-alles").textContent = `Alles kiezen (${getal(rest)})`;
      $("#afvink-alles").disabled = !rest;
      $("#afvink-niets").disabled = !n;
      $("#afvink-opslaan").disabled = !n;
      onder.hidden = false;
    }

    async function slaAfvinkOp(knop) {
      const fout = $("#afvink-fout");
      const jaar = $("#afvink-jaar").value.trim();
      if (jaar && (!/^\d{4}$/.test(jaar) || jaar < 1900 || jaar > new Date().getFullYear() + 1)) {
        fout.textContent = "Vul een jaar in zoals 2006, of laat het vak leeg.";
        return;
      }
      const banen = [...af.gekozen].map((id) => data.perId.get(id)).filter((a) => a && !a.rit).sort(opNaam);
      if (!banen.length) { af.gekozen.clear(); bewaarAfvink(); tekenAfvink(); return; }
      const bericht = banen.length === 1
        ? `Credit afgevinkt: ${banen[0].naam}`
        : `${banen.length} credits afgevinkt\n\n${banen.map((a) => `- ${a.naam}${a.park ? ` (${a.park})` : ""}`).join("\n")}`;
      // Staat een baan intussen al op je lijst (bijvoorbeeld via je telefoon), dan niet nog een keer
      const nieuw = banen.map((a) => (jaar ? { id: a.id, datum: jaar } : { id: a.id }));
      const gelukt = await metKnop(knop, fout, "Opslaan…", () => ritBron.voegToe(data, nieuw, bericht, true));
      if (!gelukt) return;
      af.gekozen.clear();
      bewaarAfvink();
      naWijziging();
      bereken();
      toon(false);
      toast(`${getal(banen.length)} ${meervoud(banen.length, "credit", "credits")} opgeslagen.${inSupabase(data) ? "" : " Bezoekers zien het over een paar minuten."}`, true);
    }

    if (balkNodig) {
      $("#overzicht").addEventListener("click", (e) => {
        const knop = e.target.closest("button");
        if (!knop) return;
        if (knop.id === "afvink-aan" && kanAfvinken) { af.aan = true; bewaarAfvink(); toon(false); }
        if (knop.id === "afvink-stop") {
          if (af.gekozen.size && !confirm(`Stoppen zonder opslaan? Je keuze van ${af.gekozen.size} ${meervoud(af.gekozen.size, "achtbaan", "achtbanen")} gaat verloren.`)) return;
          af.aan = false; af.gekozen.clear(); bewaarAfvink(); toon(false);
        }
        if (knop.id === "afvink-alles") {
          const nieuw = nogTeKiezen();
          if (nieuw.length > 150 && !confirm(`Wil je echt ${getal(nieuw.length)} achtbanen in één keer kiezen?`)) return;
          nieuw.forEach((a) => af.gekozen.add(a.id));
          bewaarAfvink(); toon(false);
        }
        if (knop.id === "afvink-niets") { af.gekozen.clear(); bewaarAfvink(); toon(false); }
        if (knop.id === "afvink-opslaan") slaAfvinkOp(knop);
        if ((knop.id === "ontbreekt" || knop.id === "ontbreekt-leeg") && beheer) openOntbreektVenster(data, st.q);
      });
      el.raster.addEventListener("change", (e) => {
        const vak = e.target.closest(".afvink-vak");
        if (!vak) return;
        if (vak.checked) af.gekozen.add(vak.value); else af.gekozen.delete(vak.value);
        vak.closest(".kaart").classList.toggle("is-gekozen", vak.checked);
        bewaarAfvink();
        tekenAfvink();
      });
    }

    function ververs() { st.toon = PER_KEER; bereken(); toon(false); bewaarInAdres(); }
    function wisAlles() {
      Object.assign(st, { q: "", land: "", status: "", park: "", gereden: false, door: "" });
      el.zoek.value = ""; el.land.value = ""; el.status.value = ""; el.gereden.checked = false;
      if (el.door) el.door.value = "";
      ververs();
    }

    let wachtOp;
    el.zoek.addEventListener("input", () => {
      clearTimeout(wachtOp);
      wachtOp = setTimeout(() => { st.q = el.zoek.value.trim(); ververs(); }, 150);
    });
    el.land.addEventListener("change", () => { st.land = el.land.value; ververs(); });
    el.status.addEventListener("change", () => { st.status = el.status.value; ververs(); });
    el.sorteer.addEventListener("change", () => { st.sorteer = el.sorteer.value; ververs(); });
    el.gereden.addEventListener("change", () => {
      st.gereden = el.gereden.checked;
      if (st.gereden && st.sorteer === "naam") { st.sorteer = "rit"; el.sorteer.value = "rit"; }
      ververs();
    });
    el.meer.addEventListener("click", () => { st.toon += PER_KEER; toon(true); });
    // Foto's die niet laden: eigen foto nog eens proberen bij GitHub, anders weghalen
    el.raster.addEventListener("error", (e) => { if (e.target.tagName === "IMG") fotoMislukt(e.target); }, true);

    // Terugkomen van een attractiepagina: zelfde plek in de lijst
    let terug = null;
    try {
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav && nav.type === "back_forward") terug = JSON.parse(sessionStorage.getItem("overzicht") || "null");
    } catch (e) { terug = null; }
    if (terug && terug.toon > PER_KEER) st.toon = terug.toon;
    addEventListener("pagehide", () => {
      try { sessionStorage.setItem("overzicht", JSON.stringify({ toon: st.toon, y: scrollY })); } catch (e) { /* geen opslag */ }
    });

    bereken();
    toon(false);
    if (terug) scrollTo({ top: terug.y, behavior: "instant" });
    else if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "instant" });

    // Na een wijziging: opnieuw tekenen, zelfde filters en zelfde aantal kaartjes
    return { herteken() { bereken(); toon(false); } };
  }

  async function startPagina() {
    startBaan();
    let data;
    try { data = await laadAlles(); } catch (e) {
      $("#resultaten-tekst").textContent = "";
      toonFout($("#raster"), e);
      return;
    }
    // De startpagina is van de eigenaar: zijn credits uit Supabase, of uit gereden.json
    zetPersoon(data, await laadEigenaar(data));
    const vulBoven = () => {
      vulHero(data); vulFeiten(data.gereden); tekenKaart(data.gereden); tekenProfielKnoppen(data, data.persoon.profiel);
    };
    vulBoven();
    tekenRanglijst(data);
    startOverzicht(data, vulBoven);
    if (data.bijgewerkt) $("#bijgewerkt").textContent = `, bijgewerkt op ${datum(data.bijgewerkt)}`;
  }

  /* ---------- Attractiepagina ---------- */

  async function haalWikipedia(qid) {
    const u1 = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=sitelinks` +
      `&sitefilter=${encodeURIComponent("nlwiki|enwiki")}&format=json&origin=*`;
    const links = (await (await fetch(u1)).json()).entities?.[qid]?.sitelinks || {};
    const keuze = links.nlwiki ? ["nl", links.nlwiki.title] : links.enwiki ? ["en", links.enwiki.title] : null;
    if (!keuze) return null;
    const [taal, titel] = keuze;
    const u2 = `https://${taal}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1` +
      `&redirects=1&titles=${encodeURIComponent(titel)}&format=json&origin=*`;
    const paginas = (await (await fetch(u2)).json()).query?.pages || {};
    const tekst = (Object.values(paginas)[0] || {}).extract || "";
    return { taal, titel, tekst, url: `https://${taal}.wikipedia.org/wiki/${encodeURIComponent(titel.replace(/ /g, "_"))}` };
  }

  async function haalFotoInfo(bestand) {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&prop=imageinfo&iiprop=extmetadata` +
      `&titles=${encodeURIComponent("File:" + bestand)}&format=json&origin=*`;
    const p = Object.values((await (await fetch(u)).json()).query?.pages || {})[0];
    const m = p?.imageinfo?.[0]?.extmetadata || {};
    const platteTekst = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();
    return { maker: platteTekst(m.Artist?.value), licentie: platteTekst(m.LicenseShortName?.value) };
  }

  // Na een wijziging tekent de pagina zichzelf opnieuw; dit voorkomt dat alles opnieuw wordt opgehaald
  const eenKeer = new Map();
  const onthoud = (sleutel, maak) => { if (!eenKeer.has(sleutel)) eenKeer.set(sleutel, maak()); return eenKeer.get(sleutel); };

  function duurTekst(sec) {
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m ? `${m}:${String(s).padStart(2, "0")}` : `${s} s`;
  }

  function specsHtml(a) {
    const rijen = [
      ["Hoogte", a.hoogte && `${getal(a.hoogte, 1)} m`],
      ["Topsnelheid", a.snelheid && `${getal(a.snelheid)} km/u`],
      ["Lengte", a.lengte && `${getal(a.lengte)} m`],
      ["Ritduur", a.duur && duurTekst(a.duur)],
      [a.status === "gepland" ? "Opent" : "Geopend", a.geopend],
      ["Gesloten", a.gesloten],
      ["Fabrikant", a.fabrikant, true],
      ["Type", a.type, true],
    ].filter(([, w]) => w);
    if (!rijen.length) return "";
    return `<dl class="specs">${rijen.map(([label, w, tekst]) =>
      `<div><dt>${label}</dt><dd${tekst ? ' class="tekstwaarde"' : ""}>${esc(w)}</dd></div>`).join("")}</dl>`;
  }

  function ritOmschrijving(x) {
    return [
      datum(x.datum) || "zonder datum",
      x.cijfer ? `${getal(x.cijfer, 1)}/10` : "",
      x.notitie || "",
    ].filter(Boolean).join(", ");
  }

  function ritHtml(a, data) {
    const mag = magRitten(data);
    if (!a.rit) {
      return mag
        ? `<section class="blok"><div class="mijn-rit"><p>Deze staat nog niet op je lijst.</p>
             <button class="knop" type="button" data-rit-nieuw>Zet op mijn lijst</button></div></section>`
        : "";
    }
    const r = a.rit;
    let lijst = "";
    if (mag) {
      // Alleen jij: elke rit met een knop om hem te bewerken of te verwijderen
      lijst = `<p>${a.ritten.length === 1 ? "Je rit:" : `${a.ritten.length} keer gereden:`}</p>
        <ul class="ritten ritten-beheer">${a.ritten.map((x, i) => `<li>
          <span>${esc(ritOmschrijving(x))}</span>
          <span class="knoppen-klein">
            <button class="knop-klein" type="button" data-rit-bewerk="${i}">Bewerken</button>
            <button class="knop-klein knop-gevaar" type="button" data-rit-weg="${i}">Verwijderen</button>
          </span></li>`).join("")}</ul>`;
    } else if (a.ritten.length > 1) {
      lijst = `<p>${a.ritten.length} keer gereden:</p><ul class="ritten">${a.ritten.map((x) =>
        `<li>${esc(datum(x.datum) || "zonder datum")}${x.notitie ? `, ${esc(x.notitie)}` : ""}</li>`).join("")}</ul>`;
    }
    return `<section class="blok"><h2>Mijn rit</h2><div class="mijn-rit">
        ${r.notitie && a.ritten.length === 1 ? `<p class="notitie">${esc(r.notitie)}</p>` : ""}
        ${r.cijfer ? `<p><strong>Mijn cijfer: ${getal(r.cijfer, 1)}/10</strong></p>` : ""}
        ${lijst}
        ${mag ? `<button class="knop knop-licht" type="button" data-rit-nieuw>Nog een rit toevoegen</button>` : ""}
      </div></section>`;
  }

  function zelfdeParkHtml(a, lijst) {
    if (!a.parkId && !a.park) return "";
    const anderen = lijst.filter((x) => x !== a && (a.parkId ? x.parkId === a.parkId : x.park === a.park));
    if (!anderen.length) return "";
    anderen.sort((x, y) => (x.status === "gesloten") - (y.status === "gesloten") || opNaam(x, y));
    const alle = [a, ...anderen];
    const gereden = alle.filter((x) => x.rit).length;
    const parkLink = `./?park=${encodeURIComponent(a.parkId || a.park)}#overzicht`;
    return `<section class="blok">
      <h2>Meer achtbanen in ${esc(a.park)}</h2>
      <p>${gereden} van de ${alle.length} gereden. <a href="${parkLink}">Bekijk het park in het overzicht</a></p>
      <ul class="park-lijst">${anderen.map((x) => `<li>
        <a href="${pagina(x)}">${esc(x.naam)}</a>
        ${x.rit ? '<span class="vink">✓ gereden</span>' : x.status === "gesloten" ? `<span class="dicht">${esc(statusTekst(x))}</span>` : ""}
      </li>`).join("")}</ul></section>`;
  }

  function bronnenHtml(a) {
    const links = [];
    const q = wikidataVan(a);
    if (q) links.push(`<a href="https://www.wikidata.org/wiki/${q}">Wikidata</a>`);
    if (a.rcdb) links.push(`<a href="https://rcdb.com/${encodeURIComponent(a.rcdb)}.htm">RCDB</a>`);
    const osm = /^(node|way|relation)\/\d+$/.test(a.osm || "") ? a.osm
      : /^osm-(node|way|relation)-\d+$/.test(a.id) ? a.id.slice(4).replace("-", "/") : "";
    const lat = Number(a.lat), lon = Number(a.lon);
    if (osm) links.push(`<a href="https://www.openstreetmap.org/${osm}">OpenStreetMap</a>`);
    else if (a.lat != null && isFinite(lat) && isFinite(lon)) links.push(`<a href="https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}">OpenStreetMap</a>`);
    return `<section class="blok"><h2>Meer weten</h2><ul class="links">${links.map((l) => `<li>${l}</li>`).join("")}</ul></section>`;
  }

  /* ---------- Venster: rit toevoegen of bewerken (alleen beheer) ---------- */

  function maakVenster(titel, inhoud) {
    const d = document.createElement("dialog");
    d.className = "dialoog";
    d.setAttribute("aria-labelledby", "venster-titel");
    d.innerHTML = `<h2 id="venster-titel">${esc(titel)}</h2>${inhoud}`;
    document.body.appendChild(d);
    d.addEventListener("close", () => d.remove());
    d.showModal();
    return d;
  }

  // Knop bezig laten zien en fouten netjes tonen
  async function metKnop(knop, foutVak, bezigTekst, werk) {
    const oud = knop.textContent;
    knop.disabled = true;
    knop.textContent = bezigTekst;
    if (foutVak) foutVak.textContent = "";
    try {
      await werk();
      return true;
    } catch (e) {
      console.error(e);
      if (foutVak) foutVak.textContent = e.message; else toast(e.message, true);
      return false;
    } finally {
      knop.disabled = false;
      knop.textContent = oud;
    }
  }

  function openRitVenster(a, data, oud, klaar) {
    const v = oud || {};
    // Datum is niet verplicht: geen datum, alleen een jaar of een volledige datum
    const was = String(v.datum || "");
    const wanneer = !was ? "geen" : /^\d{4}$/.test(was) ? "jaar" : /^\d{4}-\d{2}-\d{2}/.test(was) ? "datum" : "anders";
    const keuze = (waarde, tekst) => `<label class="vinkje"><input type="radio" name="rit-wanneer" value="${waarde}"${wanneer === waarde ? " checked" : ""}> ${tekst}</label>`;
    const d = maakVenster(oud ? `Rit op ${a.naam} bewerken` : `${a.naam} op je lijst zetten`, `
      <form method="dialog" class="formulier" id="rit-form">
        <fieldset class="keuze">
          <legend>Wanneer was je rit?</legend>
          ${keuze("geen", "Geen datum")}
          ${keuze("jaar", "Alleen een jaar")}
          ${keuze("datum", "Volledige datum")}
          ${wanneer === "anders" ? keuze("anders", `Laten zoals het is (${esc(datum(was))})`) : ""}
        </fieldset>
        <label data-wanneer="jaar">Jaar <input type="number" id="rit-jaar" inputmode="numeric" min="1900" max="${new Date().getFullYear() + 1}" placeholder="bijvoorbeeld 2006" value="${esc(wanneer === "jaar" ? was : "")}"></label>
        <label data-wanneer="datum">Datum <input type="date" id="rit-datum" max="${vandaag()}" value="${esc(wanneer === "datum" ? was.slice(0, 10) : vandaag())}"></label>
        <label>Cijfer van 1 tot 10 (mag leeg) <input type="text" id="rit-cijfer" inputmode="decimal" placeholder="bijvoorbeeld 8,5" value="${esc(v.cijfer != null ? String(v.cijfer).replace(".", ",") : "")}"></label>
        <label>Notitie (mag leeg) <input type="text" id="rit-notitie" maxlength="200" placeholder="Bijvoorbeeld: voorste rij, regen" value="${esc(v.notitie || "")}"></label>
        <p class="fout" id="rit-fout" role="alert"></p>
        <div class="knoppen">
          <button class="knop" type="submit" id="rit-opslaan">${oud ? "Wijziging opslaan" : "Zet op mijn lijst"}</button>
          <button class="knop knop-licht" type="button" id="rit-sluit">Annuleren</button>
        </div>
        <p class="klein">${inSupabase(data) ? "Wordt meteen opgeslagen in je account." : "Wordt meteen opgeslagen in <code>data/gereden.json</code> op GitHub. Bezoekers zien het na een paar minuten."}</p>
      </form>`);

    const veld = (id) => $(`#${id}`, d);
    veld("rit-sluit").addEventListener("click", () => d.close());
    const gekozen = () => $("input[name=rit-wanneer]:checked", d).value;
    function toonWanneer() {
      d.querySelectorAll("[data-wanneer]").forEach((el) => { el.hidden = el.dataset.wanneer !== gekozen(); });
    }
    d.querySelectorAll("input[name=rit-wanneer]").forEach((r) => r.addEventListener("change", () => {
      toonWanneer();
      const vak = d.querySelector(`[data-wanneer="${gekozen()}"] input`);
      if (vak) vak.focus();
    }));
    toonWanneer();

    function leesDatum() {
      const k = gekozen();
      if (k === "geen") return "";
      if (k === "anders") return was;
      if (k === "jaar") {
        const jaar = veld("rit-jaar").value.trim();
        if (!/^\d{4}$/.test(jaar) || jaar < 1900 || jaar > new Date().getFullYear() + 1) throw new Error("Vul een jaar in, bijvoorbeeld 2006. Of kies Geen datum.");
        return jaar;
      }
      const dag = veld("rit-datum").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dag)) throw new Error("Kies een datum. Of kies Geen datum.");
      return dag;
    }

    function leesFormulier() {
      // Velden die je in gereden.json met de hand hebt toegevoegd, blijven bewaard
      const rit = { id: a.id, datum: undefined, cijfer: undefined, notitie: undefined, foto: undefined, ...v };
      const zet = (k, w) => { if (w === undefined || w === "") delete rit[k]; else rit[k] = w; };
      zet("datum", leesDatum());
      const ruwCijfer = veld("rit-cijfer").value.trim();
      const cijfer = parseFloat(ruwCijfer.replace(",", "."));
      if (ruwCijfer && !(cijfer >= 1 && cijfer <= 10)) throw new Error("Een cijfer moet tussen 1 en 10 liggen.");
      zet("cijfer", ruwCijfer ? cijfer : "");
      const notitie = netteTekst(veld("rit-notitie").value);
      if (notitie.length > 200) throw new Error("Een notitie mag hooguit 200 tekens hebben.");
      zet("notitie", notitie);
      for (const k of Object.keys(rit)) if (rit[k] === undefined) delete rit[k];
      return rit;
    }

    veld("rit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      let rit;
      try { rit = leesFormulier(); } catch (fout) { veld("rit-fout").textContent = fout.message; return; }
      const knop = veld("rit-opslaan");
      const bericht = `${oud ? "Rit bewerkt" : "Rit toegevoegd"}: ${a.naam}`;
      const gelukt = await metKnop(knop, veld("rit-fout"), "Opslaan…", () =>
        (oud ? ritBron.wijzig(data, a, oud, rit, bericht) : ritBron.voegToe(data, [rit], bericht)));
      if (!gelukt) return;
      d.close();
      klaar();
      toast(opgeslagenTekst(data), true);
    });
  }

  // Maakt een foto kleiner in de browser (maximaal 1600 pixels breed) en slaat hem op als JPEG.
  // Daarbij verdwijnen ook de gegevens in de foto, zoals de plek waar hij gemaakt is.
  async function verkleinFoto(bestand, maxBreedte) {
    if (bestand.type && !/^image\//.test(bestand.type)) throw new Error("Dit bestand is geen foto.");
    let beeld, adres;
    try {
      beeld = await createImageBitmap(bestand, { imageOrientation: "from-image" });
    } catch (e) {
      adres = URL.createObjectURL(bestand);
      beeld = await new Promise((klaar, mis) => {
        const img = new Image();
        img.onload = () => klaar(img);
        img.onerror = () => mis(new Error("Deze foto kan de browser niet openen. Probeer een JPEG-foto."));
        img.src = adres;
      });
    }
    const schaal = Math.min(1, maxBreedte / beeld.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(beeld.width * schaal);
    canvas.height = Math.round(beeld.height * schaal);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(beeld, 0, 0, canvas.width, canvas.height);
    if (beeld.close) beeld.close();
    if (adres) URL.revokeObjectURL(adres);
    const blob = await new Promise((klaar) => canvas.toBlob(klaar, "image/jpeg", 0.85));
    if (!blob) throw new Error("Het verkleinen van de foto lukte niet.");
    return { blob, breedte: canvas.width, hoogte: canvas.height };
  }

  const blobNaarBase64 = (blob) => new Promise((klaar, mis) => {
    const lezer = new FileReader();
    lezer.onload = () => klaar(String(lezer.result).split(",")[1]);
    lezer.onerror = () => mis(lezer.error);
    lezer.readAsDataURL(blob);
  });

  async function uploadFoto(a, blob) {
    const d = new Date();
    const tijd = `${vandaag().replace(/-/g, "")}-${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
    const base64 = await blobNaarBase64(blob);
    for (let n = 1; ; n++) {
      const pad = `fotos/${slug(a.naam) || "achtbaan"}-${tijd}${n > 1 ? `-${n}` : ""}.jpg`;
      try {
        await schrijfBestand(pad, base64, null, `Foto toegevoegd: ${a.naam}`);
        netGeupload.set(pad, URL.createObjectURL(blob));
        return pad;
      } catch (e) {
        // Bestaat er al een foto met deze naam (zelfde seconde), dan een nummer erachter
        if (!(e.status === 422 && /sha/i.test(e.bericht)) || n >= 5) throw e;
      }
    }
  }

  async function verwijderRit(a, data, rit, knop, klaar) {
    if (!confirm(`Deze rit op ${a.naam} verwijderen?\n${ritOmschrijving(rit)}`)) return;
    const gelukt = await metKnop(knop, null, "Bezig…", () => ritBron.verwijder(data, a, rit, `Rit verwijderd: ${a.naam}`));
    if (!gelukt) return;
    klaar();
    toast(inSupabase(data) ? "Verwijderd." : "Verwijderd. Over een paar minuten is het ook van de openbare site af.", true);
  }

  /* ---------- Venster: achtbaan ontbreekt (alleen beheer) ----------
     Zet een achtbaan in data/extra.json. Staat hij later ook in Wikidata of
     OpenStreetMap, dan verwijst het script je regel daarnaar; je ritten blijven gelden. */

  const slug = (s) => zoekbaar(s).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

  function openOntbreektVenster(data, voorstel) {
    const parken = new Map(), landen = new Set();
    for (const a of data.lijst) {
      if (a.land) landen.add(a.land);
      if (a.park && !parken.has(a.park)) parken.set(a.park, a);
    }
    const opties = (lijst) => [...lijst].sort((x, y) => x.localeCompare(y, TAAL)).map((x) => `<option value="${esc(x)}"></option>`).join("");
    const d = maakVenster("Achtbaan ontbreekt", `
      <form method="dialog" class="formulier" id="nieuw-form" novalidate>
        <label>Naam van de achtbaan <input type="text" id="nieuw-naam" required maxlength="100" value="${esc(voorstel || "")}"></label>
        <label>Park (mag leeg) <input type="text" id="nieuw-park" list="nieuw-parken" maxlength="100" autocomplete="off"></label>
        <datalist id="nieuw-parken">${opties(parken.keys())}</datalist>
        <label>Land (mag leeg) <input type="text" id="nieuw-land" list="nieuw-landen" maxlength="60" autocomplete="off"></label>
        <datalist id="nieuw-landen">${opties(landen)}</datalist>
        <div class="twee-velden">
          <label>Status <select id="nieuw-status"><option value="open">Open</option><option value="gesloten">Gesloten</option><option value="gepland">Komt nog</option></select></label>
          <label>Geopend in (mag leeg) <input type="number" id="nieuw-geopend" inputmode="numeric" min="1880" max="${new Date().getFullYear() + 5}" placeholder="bijvoorbeeld 2004"></label>
        </div>
        <label>Fabrikant (mag leeg) <input type="text" id="nieuw-fabrikant" maxlength="60"></label>
        <fieldset class="plek-velden">
          <legend>Waar staat hij? (mag leeg)</legend>
          <div class="twee-velden">
            <label>Breedtegraad <input type="text" id="nieuw-lat" inputmode="decimal" placeholder="51,6497"></label>
            <label>Lengtegraad <input type="text" id="nieuw-lon" inputmode="decimal" placeholder="5,0434"></label>
          </div>
          <button class="knop-klein" type="button" id="nieuw-hier">Gebruik mijn locatie</button>
        </fieldset>
        ${!sbAan || ik ? '<label class="vinkje"><input type="checkbox" id="nieuw-gereden" checked> Meteen op mijn lijst zetten (zonder datum)</label>' : ""}
        <div id="nieuw-dubbel"></div>
        <p class="fout" id="nieuw-fout" role="alert"></p>
        <div class="knoppen">
          <button class="knop" type="submit" id="nieuw-opslaan">Toevoegen</button>
          <button class="knop knop-licht" type="button" id="nieuw-sluit">Annuleren</button>
        </div>
        <p class="klein">Komt in <code>data/extra.json</code> op GitHub. Nog mooier: zet hem ook op <a href="https://www.wikidata.org" target="_blank" rel="noopener">Wikidata</a> of <a href="https://www.openstreetmap.org" target="_blank" rel="noopener">OpenStreetMap</a>, dan heeft iedereen er wat aan.</p>
      </form>`);
    const veld = (id) => $(`#${id}`, d);
    veld("nieuw-sluit").addEventListener("click", () => d.close());

    // Een bekend park kiezen vult het land in
    veld("nieuw-park").addEventListener("change", () => {
      const p = parken.get(veld("nieuw-park").value.trim());
      if (p && p.land && !veld("nieuw-land").value) veld("nieuw-land").value = p.land;
    });
    veld("nieuw-hier").addEventListener("click", (e) => {
      const knop = e.currentTarget;
      if (!navigator.geolocation) { veld("nieuw-fout").textContent = "Je browser kan je locatie niet geven."; return; }
      knop.disabled = true; knop.textContent = "Locatie zoeken…";
      navigator.geolocation.getCurrentPosition((pos) => {
        veld("nieuw-lat").value = String(pos.coords.latitude.toFixed(5)).replace(".", ",");
        veld("nieuw-lon").value = String(pos.coords.longitude.toFixed(5)).replace(".", ",");
        knop.disabled = false; knop.textContent = "Gebruik mijn locatie";
      }, () => {
        veld("nieuw-fout").textContent = "Je locatie kon niet bepaald worden. Vul hem zelf in of laat hem leeg.";
        knop.disabled = false; knop.textContent = "Gebruik mijn locatie";
      }, { enableHighAccuracy: true, timeout: 15000 });
    });

    let dubbelGezien = "";
    veld("nieuw-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fout = veld("nieuw-fout");
      fout.textContent = "";
      const naam = veld("nieuw-naam").value.trim().replace(/\s+/g, " ");
      const park = veld("nieuw-park").value.trim().replace(/\s+/g, " ");
      if (!naam) { fout.textContent = "Vul de naam van de achtbaan in."; return; }
      const coord = (id, max) => {
        const s = veld(id).value.trim().replace(",", ".");
        if (!s) return undefined;
        const n = Number(s);
        if (!isFinite(n) || Math.abs(n) > max) throw new Error("Deze coördinaten kloppen niet. Gebruik bijvoorbeeld 51,6497 en 5,0434, of laat ze leeg.");
        return Math.round(n * 1e5) / 1e5;
      };
      let lat, lon;
      try { lat = coord("nieuw-lat", 90); lon = coord("nieuw-lon", 180); } catch (f) { fout.textContent = f.message; return; }
      if ((lat === undefined) !== (lon === undefined)) { fout.textContent = "Vul allebei de coördinaten in, of geen van beide."; return; }
      const jaar = veld("nieuw-geopend").value.trim();
      if (jaar && !/^\d{4}$/.test(jaar)) { fout.textContent = "Vul bij Geopend een jaar in, zoals 2004."; return; }

      // Staat hij er misschien al in? Dan eerst even laten zien.
      const sleutel = zoekbaar(naam).replace(/[^a-z0-9]/g, "");
      const lijktOp = data.lijst.filter((a) => zoekbaar(a.naam).replace(/[^a-z0-9]/g, "") === sleutel &&
        (!park || !a.park || zoekbaar(a.park) === zoekbaar(park)));
      if (lijktOp.length && dubbelGezien !== naam + "|" + park) {
        dubbelGezien = naam + "|" + park;
        veld("nieuw-dubbel").innerHTML = `<p class="fout">Staat hij er misschien al in? ${lijktOp.slice(0, 5).map((a) =>
          `<a href="${pagina(a)}">${esc(a.naam)}${a.park ? ` (${esc(a.park)})` : ""}</a>`).join(", ")}. Kies nog een keer Toevoegen als het echt een andere is.</p>`;
        return;
      }

      const bekendPark = parken.get(park);
      const basisId = "x-" + ([slug(naam), slug(park)].filter(Boolean).join("-") || "achtbaan");
      let id = basisId;
      for (let i = 2; data.perId.has(id) || data.extra.some((x) => x.id === id); i++) id = `${basisId}-${i}`;
      const nieuw = {
        id, naam,
        park: park || undefined,
        parkId: bekendPark && bekendPark.parkId ? bekendPark.parkId : undefined,
        land: veld("nieuw-land").value.trim() || undefined,
        fabrikant: veld("nieuw-fabrikant").value.trim() || undefined,
        status: veld("nieuw-status").value,
        geopend: jaar ? Number(jaar) : undefined,
        lat, lon,
      };
      const ookRit = !!veld("nieuw-gereden")?.checked;
      const gelukt = await metKnop(veld("nieuw-opslaan"), fout, "Opslaan…", async () => {
        await wijzigJson("data/extra.json", "achtbanen", (lijst) => {
          if (lijst.some((x) => x && x.id === id)) return lijst;
          return [...lijst, nieuw];
        }, `Achtbaan toegevoegd aan extra.json: ${naam}`);
        if (ookRit && sbAan) await sbVraag(sb.from("ritten").insert(naarRij({ id })), "De achtbaan staat erin, maar je rit opslaan lukte niet");
        else if (ookRit) await wijzigJson("data/gereden.json", "gereden", (ritten) => [...ritten, { id }], `Rit toegevoegd: ${naam}`);
      });
      if (!gelukt) return;
      d.close();
      toast(`${naam} is toegevoegd. Bezoekers zien hem over een paar minuten.`, true);
      location.href = `achtbaan.html?id=${encodeURIComponent(id)}`;
    });
  }

  /* ---------- Sporen en verbergen (beheer) ---------- */

  const wikidataVan = (a) => (/^Q\d+$/.test(a.wikidata || "") ? a.wikidata : /^Q\d+$/.test(a.id) ? a.id : "");

  function sporenHtml(a, data) {
    const sporen = data.sporenVan.get(a.deelVan) || [];
    const andere = sporen.filter((s) => s !== a && data.perId.get(s.id) === s);
    return `<p class="spoor-info">Spoor ${a.spoor} van ${sporen.length} van ${esc(a.heleNaam)}${andere.length
      ? `. Ook: ${andere.map((s) => `<a href="${pagina(s)}">${esc(s.naam)}</a>`).join(", ")}` : ""}</p>`;
  }

  // Een rit op de hele baan telt voor elk spoor. Bewerk of verwijder je hem bij één spoor,
  // dan wordt hij eerst een rit per spoor; daarna verandert alleen die van dit spoor.
  function ritVoorDitSpoor(data, lijst, rit, a) {
    if (!a.deelVan || rit.id === a.id) return rit;
    const sporen = banenVanRit(data, rit.id);
    if (sporen.length < 2) return rit;
    const i = vindRit(lijst, rit);
    if (i < 0) return rit;
    const kopieen = sporen.map((s) => ({ ...rit, id: s.id }));
    lijst.splice(i, 1, ...kopieen);
    return kopieen.find((k) => k.id === a.id) || rit;
  }

  function beheerBlokHtml(a, data) {
    if (data.verborgen.has(a.id)) {
      const v = data.verborgen.get(a.id);
      return `<section class="blok"><div class="mijn-rit beheer-blok">
        <p><strong>Deze baan is verborgen</strong>${v.reden ? ` (${esc(v.reden)})` : ""}. Bezoekers zien hem niet.</p>
        <button class="knop knop-licht" type="button" data-terugzetten>Terugzetten</button></div></section>`;
    }
    const voorstel = !a.deelVan && data.voorstellen[a.id];
    const foto = a.eigenFoto;
    return `<section class="blok"><h2>Beheer</h2><div class="mijn-rit beheer-blok">
      <div class="foto-kiezen">
        <span class="foto-kiezen-titel">Eigen foto</span>
        <div class="foto-kiezen-rij">
          <span class="foto-voorbeeld" id="beheer-voorbeeld">${foto ? `<img src="${esc(fotoBron(foto, 300))}" alt="Je foto"${eigenPad(foto) ? ` data-eigen="${esc(eigenPad(foto))}"` : ""}>` : ""}</span>
          <span class="foto-kiezen-knoppen">
            <label class="knop knop-licht knop-bestand"><span id="beheer-bestand-tekst">${foto ? "Andere foto kiezen" : "Kies een foto"}</span><input class="sr" type="file" id="beheer-bestand" accept="image/*"></label>
            <button class="knop-klein knop-gevaar" type="button" id="beheer-foto-weg"${foto ? "" : " hidden"}>Foto weghalen</button>
          </span>
        </div>
        <p class="klein" id="beheer-foto-info">Van je telefoon of computer. De site maakt hem kleiner (maximaal 1600 pixels breed) en haalt de gegevens uit de foto, zoals de plek. Je foto gaat op de hele site voor op die van Wikimedia Commons. Alleen jij kunt foto's toevoegen.</p>
        <p class="fout" id="beheer-foto-fout" role="alert"></p>
      </div>
      ${voorstel ? `<p>OpenStreetMap ziet hier ${voorstel.length} sporen met een eigen naam: ${voorstel.map(esc).join(", ")}.</p>` : ""}
      <div class="knoppen-rij">
        ${a.deelVan ? "" : `<button class="knop knop-licht" type="button" data-splits='${voorstel ? esc(JSON.stringify(voorstel)) : ""}'>Splitsen in losse sporen</button>`}
        <button class="knop knop-licht knop-gevaar" type="button" data-verberg>Verbergen</button>
      </div>
      <p class="klein">${a.deelVan
        ? "Dit spoor hoort bij een gesplitste baan. De sporen aanpassen kan in <code>data/splitsen.json</code>. "
        : "Splitsen is voor banen met twee of meer sporen, zoals een duelachtbaan. "}Verbergen is voor iets wat geen achtbaan is of dubbel staat; terugzetten kan op de beheerpagina.</p>
    </div></section>`;
  }

  // "Winja's Fear & Winja's Force" -> beide namen; "Max & Moritz" -> "Max & Moritz (Max)", ...
  function raadSporen(naam) {
    const delen = naam.split(/\s*(?:&|\/|\+)\s*/).map((s) => s.trim()).filter(Boolean);
    if (delen.length >= 2) return delen.every((d) => d.split(/\s+/).length >= 2) ? delen : delen.map((d) => `${naam} (${d})`);
    return [`${naam} (1)`, `${naam} (2)`];
  }

  function openSplitsVenster(a, data, voorstel) {
    const namen = voorstel && voorstel.length >= 2 ? voorstel : raadSporen(a.naam);
    const veldHtml = (naam, i) => `<label>Spoor ${i + 1} <input type="text" class="spoor-naam" maxlength="100" value="${esc(naam)}"></label>`;
    const d = maakVenster(`${a.naam} splitsen`, `
      <form method="dialog" class="formulier" id="splits-form">
        <p class="klein">Elk spoor wordt een eigen achtbaan die je los kunt afvinken.${a.ritten && a.ritten.length
          ? " Je rit op deze baan telt daarna voor elk spoor; heb je er één niet gereden, verwijder dan de rit op de pagina van dat spoor." : ""}</p>
        <div id="splits-namen">${namen.map(veldHtml).join("")}</div>
        <button class="knop-klein" type="button" id="splits-meer">Nog een spoor</button>
        <p class="fout" id="splits-fout" role="alert"></p>
        <div class="knoppen">
          <button class="knop" type="submit" id="splits-opslaan">Splitsen</button>
          <button class="knop knop-licht" type="button" id="splits-sluit">Annuleren</button>
        </div>
        <p class="klein">Komt in <code>data/splitsen.json</code> op GitHub.</p>
      </form>`);
    const veld = (id) => $(`#${id}`, d);
    veld("splits-sluit").addEventListener("click", () => d.close());
    veld("splits-meer").addEventListener("click", () => {
      const n = d.querySelectorAll(".spoor-naam").length;
      if (n < 8) veld("splits-namen").insertAdjacentHTML("beforeend", veldHtml(`${a.naam} (${n + 1})`, n));
    });
    veld("splits-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const sporen = [...d.querySelectorAll(".spoor-naam")].map((i) => i.value.trim().replace(/\s+/g, " ")).filter(Boolean);
      if (sporen.length < 2) { veld("splits-fout").textContent = "Vul minstens twee namen in."; return; }
      if (new Set(sporen.map((s) => s.toLowerCase())).size !== sporen.length) { veld("splits-fout").textContent = "Geef elk spoor een eigen naam."; return; }
      const gelukt = await metKnop(veld("splits-opslaan"), veld("splits-fout"), "Opslaan…", () =>
        wijzigJson("data/splitsen.json", "splitsen", (lijst) => [...lijst.filter((s) => s && s.id !== a.id), { id: a.id, sporen }],
          `Gesplitst in ${sporen.length} sporen: ${a.naam}`));
      if (!gelukt) return;
      d.close();
      location.href = `achtbaan.html?id=${encodeURIComponent(a.id + "-1")}`;
    });
  }

  // Alle codes waaronder iemand een rit op deze baan kan hebben: de baan zelf, de hele
  // baan als dit een spoor is, en oude codes die naar deze baan verwijzen
  function codesVoor(data, a) {
    const doel = new Set([a.id, a.deelVan].filter(Boolean));
    const codes = new Set(doel);
    for (const [oud, nieuw] of Object.entries(data.aliassen)) if (doel.has(nieuw) && !data.echteIds.has(oud)) codes.add(oud);
    return [...codes];
  }

  async function openVerbergVenster(a, data) {
    let reden = a.ritten && a.ritten.length && (!sbAan || inSupabase(data))
      ? `Deze baan staat op je lijst. Verwijder eerst je ${a.ritten.length === 1 ? "rit" : "ritten"}, dan kun je hem verbergen.` : "";
    if (!reden && sbAan) {
      try {
        const ritten = await sbVraag(sb.from("ritten").select("achtbaan").in("achtbaan", codesVoor(data, a)), "Controleren");
        if (ritten.some((r) => banenVanRit(data, r.achtbaan).includes(a))) {
          reden = "Iemand heeft deze baan op de lijst staan. Een baan die iemand gereden heeft, kun je niet verbergen.";
        }
      } catch (e) { toast(e.message, true); return; }
    }
    if (reden) {
      const d = maakVenster(`${a.naam} verbergen`, `<p>${esc(reden)}</p>
        <div class="knoppen"><button class="knop" type="button" id="verberg-sluit">Sluiten</button></div>`);
      $("#verberg-sluit", d).addEventListener("click", () => d.close());
      return;
    }
    const d = maakVenster(`${a.naam} verbergen`, `
      <form method="dialog" class="formulier" id="verberg-form">
        <label>Waarom? <select id="verberg-reden">
          <option>Geen achtbaan</option><option>Staat dubbel</option><option>Bestaat niet</option><option>Anders</option>
        </select></label>
        <label>Toelichting (mag leeg) <input type="text" id="verberg-notitie" maxlength="200" placeholder="Bijvoorbeeld: dubbel met Eurosat - CanCan Coaster"></label>
        <p class="fout" id="verberg-fout" role="alert"></p>
        <div class="knoppen">
          <button class="knop knop-gevaar" type="submit" id="verberg-opslaan">Verbergen</button>
          <button class="knop knop-licht" type="button" id="verberg-sluit">Annuleren</button>
        </div>
        <p class="klein">Komt in <code>data/verborgen.json</code>. Bezoekers zien hem daarna niet meer; terugzetten kan op de beheerpagina.</p>
      </form>`);
    const veld = (id) => $(`#${id}`, d);
    veld("verberg-sluit").addEventListener("click", () => d.close());
    veld("verberg-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const regel = { id: a.id, naam: a.naam, park: a.park || undefined, reden: veld("verberg-reden").value,
        notitie: veld("verberg-notitie").value.trim() || undefined };
      const gelukt = await metKnop(veld("verberg-opslaan"), veld("verberg-fout"), "Opslaan…", () =>
        wijzigJson("data/verborgen.json", "verborgen", (lijst) => [...lijst.filter((v) => v && v.id !== a.id), regel],
          `Verborgen: ${a.naam} (${regel.reden.toLowerCase()})`));
      if (!gelukt) return;
      d.close();
      toast(`${a.naam} is verborgen.`, true);
      location.href = a.parkId || a.park ? `./?park=${encodeURIComponent(a.parkId || a.park)}#overzicht` : "./#overzicht";
    });
  }

  // Eigen foto bij een achtbaan (beheer): verkleinen, uploaden naar fotos/ en vastleggen in data/fotos.json
  function koppelFotoBeheer(a, data, opnieuw) {
    const bestandVeld = $("#beheer-bestand");
    if (!bestandVeld) return;
    const info = $("#beheer-foto-info"), fout = $("#beheer-foto-fout");
    $("#beheer-voorbeeld").addEventListener("error", (e) => { if (e.target.tagName === "IMG") fotoMislukt(e.target); }, true);
    const legVast = (pad, bericht) => wijzigJson("data/fotos.json", "fotos",
      (lijst) => [...lijst.filter((f) => f && f.id !== a.id), ...(pad ? [{ id: a.id, foto: pad }] : [])], bericht)
      .then((nieuw) => zetFotos(data, nieuw.fotos || []));
    bestandVeld.addEventListener("change", async (e) => {
      const bestand = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!bestand) return;
      fout.textContent = "";
      try {
        info.textContent = "Foto verkleinen…";
        const klein = await verkleinFoto(bestand, 1600);
        info.textContent = `Foto uploaden (${getal(klein.blob.size / 1024)} kB)…`;
        const pad = await uploadFoto(a, klein.blob);
        info.textContent = "Opslaan…";
        await legVast(pad, `Foto bij ${a.naam}`);
        opnieuw();
        toast("Foto opgeslagen. Bezoekers zien hem over een paar minuten.", true);
      } catch (f) {
        console.error(f);
        info.textContent = "";
        fout.textContent = f.message;
      }
    });
    $("#beheer-foto-weg").addEventListener("click", (e) => {
      if (!confirm("Je eigen foto bij deze achtbaan weghalen? Het bestand blijft in de map fotos staan.")) return;
      metKnop(e.currentTarget, fout, "Bezig…", async () => {
        await legVast(null, `Foto weggehaald: ${a.naam}`);
        opnieuw();
      });
    });
  }

  function zetTerug(id, naam) {
    return wijzigJson("data/verborgen.json", "verborgen", (lijst) => lijst.filter((v) => v && v.id !== id), `Teruggezet: ${naam}`);
  }

  function tekenMiniKaart(a) {
    const vak = $("#minikaart");
    if (!vak) return;
    if (a.lat == null || !window.L) { vak.closest("section").remove(); return; }
    const kaart = L.map(vak, { scrollWheelZoom: false }).setView([a.lat, a.lon], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(kaart);
    const kleur = getComputedStyle(document.documentElement).getPropertyValue("--rail").trim() || "#cf2236";
    L.circleMarker([a.lat, a.lon], { radius: 10, color: "#fff", weight: 3, fillColor: kleur, fillOpacity: 1 }).addTo(kaart);
  }

  async function startAchtbaan() {
    const vak = $("#inhoud");
    const id = params.get("id") || "";
    let data;
    try { data = await laadAlles(); } catch (e) { toonFout(vak, e); return; }
    let a = data.perId.get(id);
    if (!a && beheer && data.verborgenBanen.has(id)) a = data.verborgenBanen.get(id);
    if (!a) {
      vak.innerHTML = `<div class="melding"><h1>Deze achtbaan staat niet in de lijst</h1>
        <p>Er is geen achtbaan met de code <code>${esc(id) || "(leeg)"}</code>.</p>
        <p><a href="./#overzicht">Zoek in alle achtbanen</a></p></div>`;
      return;
    }
    document.title = `${a.naam}${a.park ? ", " + a.park : ""} | ${SITE.naam}`;
    // Ingelogd: jouw ritten. Anders die van de eigenaar, zoals altijd.
    let persoon = null;
    if (ik) {
      try { persoon = await laadPersoon(data, ik); } catch (e) { console.warn(e); toast(e.message, true); }
    }
    zetPersoon(data, persoon || await laadEigenaar(data));
    if (data.details) {
      try { Object.assign(a, ((await haalJson(data.details, false)) || {})[a.id] || {}); } catch (e) { console.warn(e); }
    }
    tekenAchtbaan(a, data);
  }

  function tekenAchtbaan(a, data) {
    const vak = $("#inhoud");
    const eigenFoto = a.eigenFoto || a.rit?.foto;
    const fotoVeld = eigenFoto || a.foto;
    const src = fotoBron(fotoVeld, 1280);
    const eigen = eigenPad(fotoVeld);
    const fotoBijschrift = eigenFoto ? "Eigen foto"
      : a.foto && !isEigenFoto(a.foto) ? `Foto: <a href="${commonsPagina(a.foto)}">Wikimedia Commons</a>` : "";
    const plek = [
      a.park ? `<a href="./?park=${encodeURIComponent(a.parkId || a.park)}#overzicht">${esc(a.park)}</a>` : "",
      a.land ? esc(a.land) : "",
    ].filter(Boolean).join(", ");

    const stempel = a.rit
      ? `<div class="stempel">Gereden${a.creditDatum ? `<small>${esc(opDatumTekst(a.creditDatum))}</small>` : ""}</div>`
      : `<div class="stempel is-nog-niet">Nog niet gereden</div>`;

    vak.innerHTML = `
      <nav class="terug" aria-label="Terug"><a href="./#overzicht" id="terug">Alle achtbanen</a></nav>
      <figure class="foto-groot">
        ${src ? `<img src="${esc(src)}" alt="Foto van ${esc(a.naam)}" id="hoofdfoto"${eigen ? ` data-eigen="${esc(eigen)}"` : ""}>` : '<div class="foto-leeg" role="img" aria-label="Geen foto beschikbaar"></div>'}
        ${fotoBijschrift ? `<figcaption id="foto-bron">${fotoBijschrift}</figcaption>` : ""}
      </figure>
      <header class="titel">
        <div>
          <h1>${esc(a.naam)}</h1>
          ${a.deelVan ? sporenHtml(a, data) : ""}
          ${plek ? `<p class="plek">${plek}</p>` : ""}
          <p class="status status-${esc(a.status || "open")}">${esc(statusTekst(a))}</p>
        </div>
        ${stempel}
      </header>
      ${specsHtml(a)}
      ${ritHtml(a, data)}
      <section class="blok ook-gereden" id="ook-gereden" hidden></section>
      <div class="twee">
        <section class="over" id="over" hidden><h2>Over deze achtbaan</h2><div id="wiki"></div></section>
        <section class="plaats"><h2>Waar staat hij?</h2><div class="minikaart" id="minikaart" role="region" aria-label="Kaart"></div></section>
      </div>
      ${zelfdeParkHtml(a, data.lijst)}
      ${bronnenHtml(a)}
      ${beheer ? beheerBlokHtml(a, data) : ""}`;

    const foto = $("#hoofdfoto");
    if (foto) foto.addEventListener("error", () => fotoMislukt(foto, () => {
      foto.replaceWith(Object.assign(document.createElement("div"), { className: "foto-leeg" }));
      $("#foto-bron")?.remove();
    }));

    $("#terug").addEventListener("click", (e) => {
      if (document.referrer.startsWith(location.origin) && history.length > 1) { e.preventDefault(); history.back(); }
    });

    tekenMiniKaart(a);
    tekenOokGereden(a, data);

    const opnieuw = () => tekenAchtbaan(a, data);
    if (magRitten(data)) {
      vak.querySelectorAll("[data-rit-nieuw]").forEach((k) => k.addEventListener("click", () => openRitVenster(a, data, null, opnieuw)));
      vak.querySelectorAll("[data-rit-bewerk]").forEach((k) => k.addEventListener("click", () =>
        openRitVenster(a, data, a.ritten[Number(k.dataset.ritBewerk)], opnieuw)));
      vak.querySelectorAll("[data-rit-weg]").forEach((k) => k.addEventListener("click", () =>
        verwijderRit(a, data, a.ritten[Number(k.dataset.ritWeg)], k, opnieuw)));
    }
    if (beheer) {
      koppelFotoBeheer(a, data, opnieuw);
      $("[data-splits]", vak)?.addEventListener("click", (e) => openSplitsVenster(a, data, e.currentTarget.dataset.splits ? JSON.parse(e.currentTarget.dataset.splits) : null));
      $("[data-verberg]", vak)?.addEventListener("click", () => openVerbergVenster(a, data));
      $("[data-terugzetten]", vak)?.addEventListener("click", (e) => metKnop(e.currentTarget, null, "Bezig…", async () => {
        await zetTerug(a.id, a.naam);
        location.reload();
      }));
      // Vanaf de beheerpagina: ?splits=1 opent meteen het venster met het voorstel
      if (params.get("splits") === "1" && !a.deelVan && !data.verborgen.has(a.id)) openSplitsVenster(a, data, data.voorstellen[a.id] || null);
    }

    if (wikidataVan(a)) {
      onthoud(`wiki:${wikidataVan(a)}`, () => haalWikipedia(wikidataVan(a))).then((w) => {
        if (!w || !w.tekst) return;
        const alineas = w.tekst.split(/\n+/).map((p) => p.trim()).filter(Boolean).slice(0, 3);
        $("#wiki").innerHTML = alineas.map((p) => `<p>${esc(p)}</p>`).join("") +
          `<p class="bron-klein">Bron: <a href="${w.url}">${w.taal === "nl" ? "Wikipedia" : "Engelstalige Wikipedia"}</a>, CC BY-SA.</p>`;
        $("#over").hidden = false;
        const links = $(".links");
        if (links) links.insertAdjacentHTML("beforeend", `<li><a href="${w.url}">Wikipedia</a></li>`);
      }).catch((e) => console.warn("Wikipedia niet bereikbaar", e));
    }
    if (!eigenFoto && a.foto && !isEigenFoto(a.foto)) {
      onthoud(`foto:${a.foto}`, () => haalFotoInfo(a.foto)).then((info) => {
        const bron = $("#foto-bron");
        if (!bron || (!info.maker && !info.licentie)) return;
        bron.innerHTML = `Foto: ${esc(info.maker || "onbekende maker")}${info.licentie ? `, ${esc(info.licentie)}` : ""}, via <a href="${commonsPagina(a.foto)}">Wikimedia Commons</a>`;
      }).catch((e) => console.warn("Commons niet bereikbaar", e));
    }
  }

  /* ---------- Beheerpagina: token plakken, controleren en verwijderen ---------- */

  const TOKEN_LINK = "https://github.com/settings/personal-access-tokens/new?" + new URLSearchParams({
    name: "Achtbanensite",
    description: `Ritten opslaan vanaf ${location.host || "de achtbanensite"}`,
    target_name: SITE.githubGebruiker,
    expires_in: "366",
    contents: "write",
  });

  // Leest gereden.json en probeert hem terug te schrijven met een sha die zeker niet klopt.
  // Zegt GitHub "conflict", dan mag het token schrijven. Er verandert niets.
  async function controleerToken(token) {
    await github("", {}, token);
    const b = await haalBestand("data/gereden.json", token);
    if (!b) return { lezen: true, schrijven: null };
    try {
      await schrijfBestand("data/gereden.json", naarBase64(b.tekst), "0".repeat(40), "Controle van het token", token);
      return { lezen: true, schrijven: true };
    } catch (e) {
      if (e.status === 409 || e.status === 422) return { lezen: true, schrijven: true };
      if (e.status === 403) return { lezen: true, schrijven: false };
      throw e;
    }
  }

  function startBeheer() {
    const vak = $("#beheer-status");
    $("#token-link")?.setAttribute("href", TOKEN_LINK);
    document.querySelectorAll("[data-repo]").forEach((el) => { el.textContent = `${SITE.githubGebruiker}/${SITE.githubRepo}`; });
    if (!repoBekend) {
      vak.innerHTML = `<p>Vul eerst je GitHub-gebruikersnaam en de naam van de repository in bij <code>config.js</code>.</p>`;
      return;
    }

    function teken(melding) {
      const token = leesToken();
      vak.innerHTML = token
        ? `<p class="beheer-aan"><strong>Beheer staat aan op dit apparaat.</strong> ${sbAan
              ? "Je ziet nu de knoppen om achtbanen toe te voegen, foto's te kiezen en banen te splitsen of te verbergen. Je ritten sla je op met je account."
              : "Je ziet nu de knoppen om ritten op te slaan, te bewerken en te verwijderen."}</p>
           <p class="klein">Token: <code>${esc(token.slice(0, 15))}…${esc(token.slice(-4))}</code></p>
           <div id="token-uitslag" role="status">${melding || ""}</div>
           <div class="knoppen">
             <a class="knop" href="./#overzicht">Naar alle achtbanen</a>
             <button class="knop knop-licht" type="button" id="token-test">Token controleren</button>
             <button class="knop knop-licht knop-gevaar" type="button" id="token-weg">Token verwijderen</button>
           </div>
           <div id="beheer-onbekend"></div>
           <div id="beheer-lijsten"></div>`
        : `<p><strong>Beheer staat uit op dit apparaat.</strong> Plak je token hieronder. Hoe je dat maakt, staat verderop.</p>
           <form class="formulier" id="token-form">
             <label>Je fine-grained token <input type="password" id="token-veld" autocomplete="off" spellcheck="false" placeholder="github_pat_…" required></label>
             <p class="fout" id="token-fout" role="alert"></p>
             <div class="knoppen"><button class="knop" type="submit" id="token-opslaan">Token opslaan</button></div>
           </form>
           <div id="token-uitslag" role="status">${melding || ""}</div>`;

      if (token) {
        $("#token-weg").addEventListener("click", () => {
          if (!confirm("Token van dit apparaat verwijderen? De beheerknoppen verdwijnen dan. Op GitHub blijft het token bestaan tot je het daar verwijdert.")) return;
          opslag.wis(TOKEN_SLEUTEL);
          opslag.wis(GESCHREVEN);
          teken("<p>Het token is van dit apparaat verwijderd. Trek het ook in op GitHub als je het nergens meer gebruikt (zie hieronder).</p>");
        });
        $("#token-test").addEventListener("click", (e) => metKnop(e.currentTarget, null, "Controleren…", async () => {
          $("#token-uitslag").innerHTML = uitslagHtml(await controleerToken(token));
        }));
        toonOnbekend();
        return;
      }

      $("#token-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const nieuw = $("#token-veld").value.trim();
        const fout = $("#token-fout");
        if (/^gh[ps]_/.test(nieuw)) {
          fout.textContent = "Dit is een klassiek token. Dat geeft toegang tot al je repositories. Maak liever een fine-grained token (begint met github_pat_).";
          return;
        }
        if (!/^github_pat_\w{20,}$/.test(nieuw)) {
          fout.textContent = "Dit lijkt geen fine-grained token. Zo'n token begint met github_pat_.";
          return;
        }
        await metKnop($("#token-opslaan"), fout, "Controleren…", async () => {
          const uitslag = await controleerToken(nieuw);
          if (uitslag.schrijven === false) throw new Error("Het token werkt, maar mag niet schrijven. Zet Contents op Read and write en probeer het opnieuw.");
          if (!opslag.zet(TOKEN_SLEUTEL, nieuw)) throw new Error("Deze browser laat de site niets bewaren (privévenster?). Gebruik een gewoon venster.");
          location.reload();
        });
      });
    }

    function uitslagHtml(u) {
      return `<p class="goed">✓ Het token werkt: toegang tot ${esc(SITE.githubGebruiker)}/${esc(SITE.githubRepo)}.
        ${u.schrijven ? "Lezen en schrijven mag." : u.schrijven === false ? "</p><p class=\"fout\">Het token mag niet schrijven. Zet Contents op Read and write." : ""}</p>`;
    }

    async function toonOnbekend() {
      let data;
      try { data = await laadAlles(); } catch (e) { return; /* lijst niet beschikbaar */ }
      if (data.onbekend.length) {
        $("#beheer-onbekend").innerHTML = `<p class="fout">${data.onbekend.length} ${meervoud(data.onbekend.length, "rit verwijst", "ritten verwijzen")} naar een achtbaan die niet meer in de lijst staat:
          ${data.onbekend.map((r) => `<code>${esc(r.id)}</code>`).join(", ")}. Ze tellen niet mee. Kijk of de code in <code>data/gereden.json</code> klopt.</p>`;
      }
      // Met accounts: ook de ritten van iedereen in Supabase
      if (sbAan) {
        try {
          const iedereen = await laadIedereen();
          const naam = new Map(iedereen.profielen.map((p) => [p.id, p.weergavenaam]));
          const los = iedereen.ritten.filter((r) => !banenVanRit(data, r.achtbaan).length);
          if (los.length) {
            $("#beheer-onbekend").insertAdjacentHTML("beforeend", `<p class="fout">${los.length} ${meervoud(los.length, "rit in de accounts verwijst", "ritten in de accounts verwijzen")} naar een achtbaan die niet in de lijst staat:
              ${los.map((r) => `<code>${esc(r.achtbaan)}</code> (${esc(naam.get(r.gebruiker) || "?")})`).join(", ")}. Ze tellen niet mee. Staat de baan er weer in, dan tellen ze vanzelf weer.</p>`);
          }
        } catch (e) { console.warn(e); }
      }
      // Wat je hebt verborgen of gesplitst, en wat OpenStreetMap voorstelt om te splitsen
      const banenNaam = (id) => data.perId.get(id)?.heleNaam || data.perId.get(id)?.naam || id;
      const verborgen = [...data.verborgen.values()];
      const gesplitst = [...data.sporenVan.entries()];
      const voorstellen = Object.entries(data.voorstellen).filter(([id]) => !data.sporenVan.has(id) && data.perId.has(id));
      $("#beheer-lijsten").innerHTML = `
        <h3 class="beheer-kop">Verborgen (${verborgen.length})</h3>
        ${verborgen.length ? `<ul class="ritten ritten-beheer">${verborgen.map((v) => `<li>
          <span><a href="${pagina(v)}">${esc(v.naam || v.id)}</a>${v.park ? `, ${esc(v.park)}` : ""} <span class="klein">(${esc(v.reden || "verborgen")}${v.notitie ? `: ${esc(v.notitie)}` : ""})</span></span>
          <span class="knoppen-klein"><button class="knop-klein" type="button" data-terug="${esc(v.id)}">Terugzetten</button></span></li>`).join("")}</ul>`
          : `<p class="klein">Nog niets. Op de pagina van een baan kun je hem verbergen als het geen achtbaan is of als hij dubbel staat.</p>`}
        <h3 class="beheer-kop">In sporen gesplitst (${gesplitst.length})</h3>
        ${gesplitst.length ? `<ul class="ritten">${gesplitst.map(([, sporen]) => `<li><a href="${pagina(sporen[0])}">${esc(sporen[0].heleNaam)}</a>: ${sporen.map((s) => esc(s.naam)).join(", ")}</li>`).join("")}</ul>` : ""}
        ${voorstellen.length ? `<h3 class="beheer-kop">Misschien ook meer sporen (${voorstellen.length})</h3>
          <p class="klein">OpenStreetMap ziet bij deze banen sporen met een eigen naam.</p>
          <ul class="ritten ritten-beheer">${voorstellen.map(([id, sporen]) => `<li><span><a href="${pagina({ id })}">${esc(banenNaam(id))}</a>: ${sporen.map(esc).join(", ")}</span>
            <span class="knoppen-klein"><a class="knop-klein" href="achtbaan.html?id=${encodeURIComponent(id)}&splits=1">Splitsen…</a></span></li>`).join("")}</ul>` : ""}`;
      $("#beheer-lijsten").querySelectorAll("[data-terug]").forEach((k) => k.addEventListener("click", () =>
        metKnop(k, null, "Bezig…", async () => {
          const v = data.verborgen.get(k.dataset.terug);
          await zetTerug(v.id, v.naam || v.id);
          location.reload();
        })));
    }

    teken();
  }

  /* ---------- Delen ----------
     Op de telefoon het deelmenu van het toestel (WhatsApp, Berichten, …),
     anders de link kopiëren. */
  async function deel({ titel, tekst, url }) {
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: titel, text: tekst, url }); return; } catch (e) {
        if (e && e.name === "AbortError") return; // zelf geannuleerd
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link gekopieerd. Plak hem in WhatsApp, een mail of waar je maar wilt.", true);
    } catch (e) {
      window.prompt("Kopieer deze link:", url);
    }
  }

  // Knoppen onder de teller: delen, vergelijken, en bij je eigen profiel je account
  function tekenProfielKnoppen(data, profiel) {
    const vak = $("#profiel-knoppen");
    if (!vak || !sbAan) return;
    const eigen = !!(ik && profiel && ik.id === profiel.id);
    const thuis = PAGINA === "home";
    const url = thuis ? new URL("./", location.href).href : profielLink(profiel);
    const n = data.gereden.length;
    const vergelijk = !profiel ? "" : ik && !eigen
      ? `vergelijk.html?a=${encodeURIComponent(ik.gebruikersnaam)}&b=${encodeURIComponent(profiel.gebruikersnaam)}`
      : `vergelijk.html?a=${encodeURIComponent(profiel.gebruikersnaam)}`;
    vak.innerHTML = `<button class="knop" type="button" id="deel-knop">${thuis ? "Deel de site" : eigen ? "Deel mijn profiel" : "Deel dit profiel"}</button>
      ${vergelijk ? `<a class="knop knop-licht" href="${esc(vergelijk)}">${ik && !eigen ? "Vergelijk met mij" : "Vergelijken"}</a>` : ""}
      ${eigen && !thuis ? '<a class="knop knop-licht" href="account.html">Mijn account</a>' : ""}`;
    vak.hidden = false;
    $("#deel-knop").addEventListener("click", () => deel({
      titel: thuis ? SITE.naam : `${profiel.weergavenaam} | ${SITE.naam}`,
      tekst: thuis
        ? `${SITE.naam}: ${getal(n)} ${meervoud(n, "achtbaan", "achtbanen")} gereden.`
        : `${profiel.weergavenaam} heeft ${getal(n)} ${meervoud(n, "achtbaan", "achtbanen")} gereden.`,
      url,
    }));
  }

  /* ---------- Profielpagina: profiel.html?wie=gebruikersnaam ---------- */

  async function startProfiel() {
    const wie = (params.get("wie") || "").trim().toLowerCase();
    const melding = (titel, tekst) => {
      $("main").innerHTML = `<div class="melding"><h1>${esc(titel)}</h1><p>${tekst}</p><p><a href="./">Naar de startpagina</a></p></div>`;
    };
    if (!sbAan) { melding("Profielen staan nog uit", "Deze site gebruikt nog geen accounts."); return; }
    if (!wie) {
      if (ik) { location.replace(`profiel.html?wie=${encodeURIComponent(ik.gebruikersnaam)}`); return; }
      melding("Wiens profiel?", "In de link staat geen gebruikersnaam. Vraag je vriend om de link nog eens te sturen.");
      return;
    }
    startBaan();
    let data, profiel, persoon;
    try {
      [data, profiel] = await Promise.all([laadAlles(), GEBRUIKERSNAAM.test(wie) ? haalProfiel({ gebruikersnaam: wie }) : null]);
      if (profiel) persoon = await laadPersoon(data, profiel);
    } catch (e) {
      $("#resultaten-tekst").textContent = "";
      toonFout($("#raster"), e);
      return;
    }
    if (!profiel) {
      melding("Dit profiel bestaat niet", `Er is niemand met de gebruikersnaam <code>${esc(wie)}</code>. Misschien is de naam veranderd, of is het account verwijderd.`);
      return;
    }
    zetPersoon(data, persoon);
    const eigen = !!ik && ik.id === profiel.id;
    document.title = `${profiel.weergavenaam} | ${SITE.naam}`;
    $("#profiel-naam").textContent = profiel.weergavenaam;
    $("#kaart-titel").textContent = eigen ? "Waar ik heb gereden" : `Waar ${profiel.weergavenaam} heeft gereden`;
    $("#kaart").setAttribute("aria-label", `Kaart met parken waar ${eigen ? "ik heb" : `${profiel.weergavenaam} heeft`} gereden`);
    const vulBoven = () => {
      vulHero(data); vulFeiten(data.gereden); tekenKaart(data.gereden); tekenProfielKnoppen(data, profiel);
    };
    vulBoven();
    startOverzicht(data, vulBoven);
    if (data.bijgewerkt) $("#bijgewerkt").textContent = `, bijgewerkt op ${datum(data.bijgewerkt)}`;
  }

  /* ---------- Ranglijst op de startpagina ---------- */

  async function tekenRanglijst(data) {
    const sectie = $("#ranglijst");
    if (!sectie || !sbAan) return;
    let iedereen;
    try { iedereen = await laadIedereen(); } catch (e) {
      sectie.hidden = false;
      $("#ranglijst-vak").innerHTML = `<p class="fout">${esc(e.message)}</p>`;
      return;
    }
    const rijen = [...banenPerPersoon(data, iedereen).values()]
      .filter((x) => x.profiel.in_ranglijst)
      .map((x) => { const b = [...x.banen]; return { p: x.profiel, n: b.length, landen: telLanden(b), parken: telParken(b) }; })
      .sort((x, y) => y.n - x.n || y.landen - x.landen || y.parken - x.parken || opWeergavenaam(x.p, y.p));
    if (!rijen.length) return;
    let plaats = 0;
    const regels = rijen.map((x, i) => {
      if (!i || x.n !== rijen[i - 1].n) plaats = i + 1; // gelijk aantal: gedeelde plaats
      return `<tr${ik && ik.id === x.p.id ? ' class="is-ik"' : ""}>
        <td class="plaats">${plaats}</td>
        <td class="naam"><a href="${esc(profielLink(x.p))}">${esc(x.p.weergavenaam)}</a></td>
        <td class="getal credits">${getal(x.n)}</td>
        <td class="getal">${getal(x.landen)}</td>
        <td class="getal">${getal(x.parken)}</td></tr>`;
    }).join("");
    $("#ranglijst-tekst").textContent = `${rijen.length} ${meervoud(rijen.length, "persoon", "personen")}`;
    $("#ranglijst-vak").innerHTML = `
      <table class="ranglijst">
        <caption class="sr">Ranglijst op aantal credits</caption>
        <thead><tr><th scope="col"><span class="sr">Plaats</span></th><th scope="col">Naam</th><th scope="col" class="getal">Credits</th><th scope="col" class="getal">Landen</th><th scope="col" class="getal">Parken</th></tr></thead>
        <tbody>${regels}</tbody>
      </table>
      <p class="ranglijst-voet"><a href="vergelijk.html">Vergelijk twee vrienden</a>${ik && !ik.in_ranglijst
        ? ' <span class="klein">Jij staat er niet tussen. Dat kun je aanzetten bij <a href="account.html">Mijn account</a>.</span>' : ""}</p>`;
    sectie.hidden = false;
  }

  /* ---------- Attractiepagina: ook gereden door ---------- */

  async function tekenOokGereden(a, data) {
    const vak = $("#ook-gereden");
    if (!vak || !sbAan) return;
    let rijen, iedereen;
    try {
      [rijen, iedereen] = await Promise.all([
        sbVraag(metTijd(sb.from("ritten").select("id,gebruiker,achtbaan,datum,cijfer,notitie").in("achtbaan", codesVoor(data, a)).order("id")), "Ritten ophalen"),
        laadIedereen(),
      ]);
    } catch (e) { console.warn(e); return; }
    const profielen = new Map(iedereen.profielen.map((p) => [p.id, p]));
    const per = new Map();
    const voegToe = (p, rit) => { if (!per.has(p.id)) per.set(p.id, { p, ritten: [] }); per.get(p.id).ritten.push(rit); };
    for (const r of rijen) {
      const p = profielen.get(r.gebruiker);
      if (p && banenVanRit(data, r.achtbaan).includes(a)) voegToe(p, naarRit(r));
    }
    // De eigenaar die zijn credits nog niet heeft overgezet
    const eigenaar = iedereen.profielen.find((p) => p.gebruikersnaam === SITE.eigenaar);
    if (eigenaar && !iedereen.ritten.some((r) => r.gebruiker === eigenaar.id)) {
      for (const r of data.jsonRitten) if (banenVanRit(data, r.id).includes(a)) voegToe(eigenaar, r);
    }
    const zelf = data.persoon && data.persoon.profiel ? data.persoon.profiel.id : null;
    const lijst = [...per.values()].filter((x) => x.p.id !== zelf && x.p.in_ranglijst).map(({ p, ritten }) => {
      ritten.sort((x, y) => String(x.datum || "9999").localeCompare(String(y.datum || "9999")));
      const laatste = (veld) => ritten.map((r) => r[veld]).filter((w) => w != null && w !== "").pop();
      return { p, keer: ritten.length, eerste: ritten.every((r) => r.datum) ? ritten[0].datum : null, cijfer: laatste("cijfer"), notitie: laatste("notitie") };
    }).sort((x, y) => String(x.eerste || "9999").localeCompare(String(y.eerste || "9999")) || opWeergavenaam(x.p, y.p));
    if (!lijst.length) { vak.hidden = true; return; }
    vak.innerHTML = `<h2>${a.rit ? "Ook gereden door" : "Gereden door"}</h2>
      <ul class="ook-lijst">${lijst.map((x) => {
        const info = [x.eerste ? datum(x.eerste, true) : "", x.keer > 1 ? `${x.keer} keer` : "", x.cijfer ? `${getal(x.cijfer, 1)}/10` : ""].filter(Boolean).join(" · ");
        return `<li><a href="${esc(profielLink(x.p))}">${esc(x.p.weergavenaam)}</a>${info ? ` <span class="ook-info">${esc(info)}</span>` : ""}${x.notitie ? `<span class="ook-notitie">${esc(x.notitie)}</span>` : ""}</li>`;
      }).join("")}</ul>`;
    vak.hidden = false;
  }

  /* ---------- Vergelijken: vergelijk.html?a=…&b=… ---------- */

  async function startVergelijk() {
    const uit = $("#vergelijk-uitslag");
    if (!sbAan) { uit.innerHTML = '<div class="melding"><h1>Vergelijken staat nog uit</h1><p>Deze site gebruikt nog geen accounts.</p></div>'; return; }
    let data, iedereen;
    try { [data, iedereen] = await Promise.all([laadAlles(), laadIedereen()]); } catch (e) { toonFout(uit, e); return; }
    const per = banenPerPersoon(data, iedereen);
    const opNaam = new Map(iedereen.profielen.map((p) => [p.gebruikersnaam, p]));
    const eigenaar = opNaam.get(SITE.eigenaar);
    let a = opNaam.get((params.get("a") || "").toLowerCase()) || ik || eigenaar || iedereen.profielen[0];
    let b = opNaam.get((params.get("b") || "").toLowerCase());
    const keuzes = iedereen.profielen.filter((p) => p.in_ranglijst || p === a || p === b || (ik && ik.id === p.id)).sort(opWeergavenaam);
    if (!b || b === a) b = (a !== eigenaar && eigenaar) || keuzes.find((p) => p !== a);
    if (!a || !b) {
      $("#vergelijk-kies").hidden = true;
      uit.innerHTML = '<div class="melding"><h1>Nog niemand om mee te vergelijken</h1><p>Er is pas één profiel. Nodig een vriend uit!</p></div>';
      return;
    }
    const kies = [$("#kies-a"), $("#kies-b")];
    for (const k of kies) for (const p of keuzes) k.add(new Option(ik && ik.id === p.id ? `${p.weergavenaam} (ik)` : p.weergavenaam, p.gebruikersnaam));
    kies[0].value = a.gebruikersnaam;
    kies[1].value = b.gebruikersnaam;
    kies.forEach((k) => k.addEventListener("change", () => {
      a = opNaam.get(kies[0].value); b = opNaam.get(kies[1].value);
      history.replaceState(null, "", `vergelijk.html?a=${encodeURIComponent(a.gebruikersnaam)}&b=${encodeURIComponent(b.gebruikersnaam)}`);
      teken();
    }));
    const opNaamBaan = (x, y) => x.naam.localeCompare(y.naam, TAAL) || String(x.park || "").localeCompare(String(y.park || ""), TAAL);
    const lijstHtml = (banen) => (banen.length
      ? `<ul class="park-lijst vergelijk-lijst">${banen.map((x) => `<li><a href="${pagina(x)}">${esc(x.naam)}</a>${x.park ? `<span class="dicht">${esc(x.park)}</span>` : ""}</li>`).join("")}</ul>`
      : '<p class="klein">Geen.</p>');
    function teken() {
      document.title = `${a.weergavenaam} tegen ${b.weergavenaam} | ${SITE.naam}`;
      const A = per.get(a.id).banen, B = per.get(b.id).banen;
      const beide = [...A].filter((x) => B.has(x)).sort(opNaamBaan);
      const alleenA = [...A].filter((x) => !B.has(x)).sort(opNaamBaan);
      const alleenB = [...B].filter((x) => !A.has(x)).sort(opNaamBaan);
      const kant = (p, n) => `<a class="score-kant" href="${esc(profielLink(p))}"><span class="score-getal">${getal(n)}</span><span class="score-naam">${esc(p.weergavenaam)}</span></a>`;
      const blok = (titel, banen) => `<section class="blok"><h2>${esc(titel)} <span class="aantal">${getal(banen.length)}</span></h2>${lijstHtml(banen)}</section>`;
      uit.innerHTML = a === b
        ? '<p class="binnen">Kies twee verschillende personen.</p>'
        : `<section class="score" aria-label="Aantal credits">${kant(a, A.size)}<span class="score-midden">tegen</span>${kant(b, B.size)}</section>
          ${blok("Allebei gereden", beide)}
          ${blok(`Alleen ${a.weergavenaam}`, alleenA)}
          ${blok(`Alleen ${b.weergavenaam}`, alleenB)}`;
    }
    teken();
  }

  /* ---------- Accountpagina: inloggen, profiel, uitloggen ---------- */

  const sessieOpslag = {
    lees(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    zet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* geen opslag */ } },
    wis(k) { try { sessionStorage.removeItem(k); } catch (e) { /* geen opslag */ } },
  };
  const LOGIN_ADRES = "achtbanen-login-adres"; // alleen in dit tabblad, voor de code uit de mail
  const MELDING = "achtbanen-melding"; // een bericht voor de volgende pagina
  const profielLink = (p) => new URL(`profiel.html?wie=${encodeURIComponent(p.gebruikersnaam)}`, location.href).href;
  const naarGebruikersnaam = (s) => slug(s).slice(0, 24).replace(/-+$/, "");

  function startAccountPagina() {
    const vak = $("#account-vak");
    if (!sbAan) {
      vak.innerHTML = `<p><strong>Accounts staan nog niet aan op deze site.</strong></p>
        <p class="klein">Ben jij de eigenaar? Vul <code>supabaseUrl</code> en <code>supabaseSleutel</code> in bij <code>config.js</code>. Hoe dat gaat, staat in de README.</p>`;
      return;
    }
    const melding = sessieOpslag.lees(LOGIN_MELDING) || "";
    sessieOpslag.wis(LOGIN_MELDING);
    if (accountFout) {
      vak.innerHTML = `<p class="fout">${esc(accountFout)}</p>
        <div class="knoppen"><button class="knop" type="button" id="opnieuw">Opnieuw proberen</button></div>`;
      $("#opnieuw").addEventListener("click", () => location.reload());
      return;
    }
    if (!sessie) { tekenInloggen(vak, melding); return; }
    if (!ik) { tekenNieuwProfiel(vak); return; }
    tekenAccount(vak);
  }

  function tekenInloggen(vak, melding) {
    const adres = sessieOpslag.lees(LOGIN_ADRES) || "";
    vak.innerHTML = `
      ${melding ? `<p class="fout">${esc(melding)}</p>` : ""}
      <div id="login-stap1"${adres ? " hidden" : ""}>
        <p><strong>Inloggen gaat zonder wachtwoord.</strong> Vul je e-mailadres in. Je krijgt een mail met een link: tik erop en je bent ingelogd op het apparaat waar je hem opent.</p>
        <form class="formulier" id="login-form" novalidate>
          <label>Je e-mailadres <input type="email" id="login-email" autocomplete="email" inputmode="email" maxlength="254" required value="${esc(adres)}"></label>
          <p class="fout" id="login-fout" role="alert"></p>
          <div class="knoppen"><button class="knop" type="submit" id="login-knop">Stuur me een inloglink</button></div>
        </form>
        <p class="klein">Alleen wie een uitnodiging heeft gekregen, kan inloggen. Je e-mailadres wordt alleen gebruikt om in te loggen en staat nergens op de site.</p>
      </div>
      <div id="login-stap2"${adres ? "" : " hidden"}>
        <p class="goed">Kijk in je mail. Tik op de link in de mail om in te loggen.</p>
        <p class="klein">Geen mail binnen een paar minuten? Kijk bij je spam en controleer of je het adres goed hebt getypt. Heb je nog geen uitnodiging, vraag er dan om.</p>
        <form class="formulier" id="code-form" novalidate>
          <label>Staat er een code van 6 cijfers in de mail? Dan kan het ook zo: <input type="text" id="login-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456"></label>
          <p class="fout" id="code-fout" role="alert"></p>
          <div class="knoppen">
            <button class="knop" type="submit" id="code-knop">Inloggen met de code</button>
            <button class="knop knop-licht" type="button" id="login-anders">Ander e-mailadres</button>
          </div>
        </form>
      </div>`;

    $("#login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#login-email").value.trim();
      const fout = $("#login-fout");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) { fout.textContent = "Vul je e-mailadres in, bijvoorbeeld naam@voorbeeld.nl."; return; }
      const gelukt = await metKnop($("#login-knop"), fout, "Versturen…", async () => {
        const { error } = await sb.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: new URL("account.html", location.href).href },
        });
        // Een adres zonder uitnodiging krijgt hetzelfde bericht als een bekend adres,
        // zodat niemand kan uitproberen wie er een account heeft.
        if (error && !/otp_disabled|signup_disabled|user_not_found/.test(String(error.code || "")) && !/signups not allowed/i.test(error.message || "")) {
          throw sbFout(error, "Versturen lukte niet");
        }
      });
      if (!gelukt) return;
      sessieOpslag.zet(LOGIN_ADRES, email);
      $("#login-stap1").hidden = true;
      $("#login-stap2").hidden = false;
      $("#login-code").focus();
    });

    $("#code-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const code = $("#login-code").value.replace(/\s/g, "");
      const fout = $("#code-fout");
      if (!/^\d{6}$/.test(code)) { fout.textContent = "De code bestaat uit 6 cijfers."; return; }
      const gelukt = await metKnop($("#code-knop"), fout, "Controleren…", async () => {
        const { error } = await sb.auth.verifyOtp({ email: sessieOpslag.lees(LOGIN_ADRES) || "", token: code, type: "email" });
        if (error) throw /expired|invalid/i.test(`${error.code} ${error.message}`) ? new Error("Deze code klopt niet of is verlopen. Vraag een nieuwe aan.") : sbFout(error);
      });
      if (!gelukt) return;
      sessieOpslag.wis(LOGIN_ADRES);
      location.replace("account.html");
    });

    $("#login-anders").addEventListener("click", () => {
      sessieOpslag.wis(LOGIN_ADRES);
      $("#login-stap2").hidden = true;
      $("#login-stap1").hidden = false;
      $("#login-email").focus();
    });
  }

  function profielVeldenHtml(p, nieuw) {
    return `
      <label>Je naam op de site <input type="text" id="p-naam" maxlength="40" required autocomplete="nickname" placeholder="Bijvoorbeeld Anna" value="${esc(p.weergavenaam || "")}"></label>
      <label>Gebruikersnaam voor je link <input type="text" id="p-gebruiker" maxlength="24" required autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="anna" value="${esc(p.gebruikersnaam || "")}"></label>
      <p class="klein link-voorbeeld">3 tot 24 tekens: kleine letters, cijfers en streepjes. Je link wordt <code id="p-link"></code></p>
      <label class="vinkje"><input type="checkbox" id="p-ranglijst"${p.in_ranglijst === false ? "" : " checked"}> Laat mij zien in de ranglijst en bij "Ook gereden door"</label>
      <p class="klein">Zet je dit uit, dan sta je daar niet tussen. Je profiel is dan alleen te vinden met je eigen link.</p>
      <p class="fout" id="p-fout" role="alert"></p>
      <div class="knoppen"><button class="knop" type="submit" id="p-opslaan">${nieuw ? "Profiel maken" : "Wijzigingen opslaan"}</button></div>`;
  }

  // Leest en controleert het profielformulier; zelfde regels als in de database
  function koppelProfielFormulier(form, nieuw, opslaan) {
    const naam = $("#p-naam", form), gebruiker = $("#p-gebruiker", form), link = $("#p-link", form);
    let zelfGekozen = !nieuw;
    const toonLink = () => { link.textContent = profielLink({ gebruikersnaam: gebruiker.value.trim().toLowerCase() || "…" }); };
    naam.addEventListener("input", () => { if (!zelfGekozen) { gebruiker.value = naarGebruikersnaam(naam.value); toonLink(); } });
    gebruiker.addEventListener("input", () => { zelfGekozen = true; toonLink(); });
    toonLink();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fout = $("#p-fout", form);
      const p = {
        weergavenaam: netteTekst(naam.value),
        gebruikersnaam: gebruiker.value.trim().toLowerCase(),
        in_ranglijst: $("#p-ranglijst", form).checked,
      };
      if (!p.weergavenaam) { fout.textContent = "Vul je naam in."; return; }
      if (p.weergavenaam.length > 40) { fout.textContent = "Je naam mag hooguit 40 tekens hebben."; return; }
      if (!GEBRUIKERSNAAM.test(p.gebruikersnaam) || p.gebruikersnaam.includes("--")) {
        fout.textContent = "Een gebruikersnaam heeft 3 tot 24 tekens: kleine letters, cijfers en streepjes (niet aan het begin of eind).";
        return;
      }
      if (ik && ik.gebruikersnaam === SITE.eigenaar && p.gebruikersnaam !== ik.gebruikersnaam &&
        !confirm(`Jij bent de eigenaar van de site (eigenaar: "${SITE.eigenaar}" in config.js). Verander je je gebruikersnaam, pas dan ook config.js aan. Anders toont de startpagina je credits niet meer. Doorgaan?`)) return;
      naam.value = p.weergavenaam;
      await metKnop($("#p-opslaan", form), fout, "Opslaan…", () => opslaan(p));
    });
  }

  function tekenNieuwProfiel(vak) {
    vak.innerHTML = `<h2>Welkom!</h2>
      <p>${welkeLink === "invite" ? "Je uitnodiging is gelukt. " : ""}Kies nog hoe je heet. Daarna kun je je credits afvinken.</p>
      <form class="formulier" id="profiel-form" novalidate>${profielVeldenHtml({}, true)}</form>
      <p class="klein"><a href="#" id="uitloggen">Uitloggen</a></p>`;
    koppelProfielFormulier($("#profiel-form"), true, async (p) => {
      ik = await sbVraag(sb.from("profielen").insert({ id: sessie.user.id, ...p }).select(PROFIEL_VELDEN).single(), "Profiel maken");
      tekenAccount(vak);
      toast("Je profiel staat klaar.", true);
    });
    $("#uitloggen").addEventListener("click", (e) => { e.preventDefault(); logUit("local"); });
  }

  function tekenAccount(vak) {
    const menu = $(".kop nav .nav-ik");
    if (menu) { menu.textContent = ik.weergavenaam; menu.title = "Mijn credits"; menu.href = profielLink(ik); }
    vak.innerHTML = `
      <p class="beheer-aan"><strong>Je bent ingelogd als ${esc(ik.weergavenaam)}.</strong></p>
      <div class="knoppen">
        <a class="knop" href="${esc(profielLink(ik))}">Naar mijn credits</a>
        <button class="knop knop-licht" type="button" id="uitloggen">Uitloggen</button>
      </div>
      <h2 class="beheer-kop">Profiel</h2>
      <form class="formulier" id="profiel-form" novalidate>${profielVeldenHtml(ik, false)}</form>
      <div id="account-extra"></div>
      <h2 class="beheer-kop">Uitloggen op al je apparaten</h2>
      <p class="klein">Telefoon kwijt, of ingelogd op een computer van iemand anders? Hiermee log je overal uit. Je gegevens blijven bewaard.</p>
      <div class="knoppen"><button class="knop knop-licht" type="button" id="overal-uit">Overal uitloggen</button></div>
      <h2 class="beheer-kop">Account verwijderen</h2>
      <p>Hiermee verdwijnen meteen je account, je e-mailadres, je profiel en al je ritten. Dat kan niet ongedaan worden. <a href="privacy.html">Wat er bewaard wordt</a></p>
      ${ik.gebruikersnaam === SITE.eigenaar ? '<p class="fout">Jij bent de eigenaar. Verwijder je je account, dan toont de startpagina weer de reservekopie uit gereden.json.</p>' : ""}
      <form class="formulier" id="weg-form" novalidate>
        <label><span>Typ je gebruikersnaam (<strong>${esc(ik.gebruikersnaam)}</strong>) om te bevestigen</span> <input type="text" id="weg-naam" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="24"></label>
        <p class="fout" id="weg-fout" role="alert"></p>
        <div class="knoppen"><button class="knop knop-licht knop-gevaar" type="submit" id="weg-knop">Mijn account verwijderen</button></div>
      </form>`;
    koppelProfielFormulier($("#profiel-form"), false, async (p) => {
      ik = await sbVraag(sb.from("profielen").update(p).eq("id", ik.id).select(PROFIEL_VELDEN).single(), "Opslaan");
      tekenAccount(vak);
      toast("Opgeslagen.");
    });
    tekenOverzetten();
    $("#uitloggen").addEventListener("click", () => logUit("local"));
    $("#overal-uit").addEventListener("click", () => {
      if (confirm("Op al je apparaten uitloggen? Daarna log je overal opnieuw in met een link per mail.")) logUit("global");
    });
    $("#weg-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fout = $("#weg-fout");
      if ($("#weg-naam").value.trim().toLowerCase() !== ik.gebruikersnaam) { fout.textContent = "Typ precies je gebruikersnaam om te bevestigen."; return; }
      if (!confirm("Weet je het zeker? Je account en al je ritten worden nu verwijderd.")) return;
      const gelukt = await metKnop($("#weg-knop"), fout, "Verwijderen…", () => sbVraag(sb.rpc("verwijder_mijn_account"), "Verwijderen lukte niet"));
      if (!gelukt) return;
      sessieOpslag.zet(MELDING, "Je account en al je gegevens zijn verwijderd.");
      await logUit("local");
    });
  }

  // Eenmalig: de credits van de eigenaar uit data/gereden.json naar zijn account.
  // gereden.json blijft daarna staan als reservekopie.
  async function tekenOverzetten() {
    const vak = $("#account-extra");
    if (!vak || !ik || ik.gebruikersnaam !== SITE.eigenaar) return;
    let data, mijn;
    try { [data, mijn] = await Promise.all([laadAlles(), haalRitten(ik.id)]); } catch (e) {
      vak.innerHTML = `<p class="fout">${esc(e.message)}</p>`;
      return;
    }
    if (mijn.length) {
      vak.innerHTML = `<p class="klein">Je ${getal(mijn.length)} ritten staan in je account. <code>data/gereden.json</code> blijft als reservekopie in de repository staan.</p>`;
      return;
    }
    const json = data.jsonRitten;
    if (!json.length) return;
    const goed = json.filter((r) => ACHTBAAN_ID.test(r.id) && geldigeDatum(r.datum));
    const mis = json.filter((r) => !goed.includes(r));
    vak.innerHTML = `<h2 class="beheer-kop">Je credits overzetten</h2>
      <p>In <code>data/gereden.json</code> staan ${getal(json.length)} ritten. Zet ze één keer over naar je account. Daarna vink je af zoals je vrienden dat doen. <code>gereden.json</code> blijft staan als reservekopie.</p>
      ${mis.length ? `<p class="fout">${mis.length} ${meervoud(mis.length, "rit heeft", "ritten hebben")} een code of datum die niet klopt en ${meervoud(mis.length, "wordt", "worden")} overgeslagen: ${mis.map((r) => `<code>${esc(r.id)}${r.datum ? ` (${esc(r.datum)})` : ""}</code>`).join(", ")}</p>` : ""}
      <p class="fout" id="overzetten-fout" role="alert"></p>
      <div class="knoppen"><button class="knop" type="button" id="overzetten">Zet ${getal(goed.length)} ${meervoud(goed.length, "credit", "credits")} over</button></div>`;
    $("#overzetten").addEventListener("click", (e) => metKnop(e.currentTarget, $("#overzetten-fout"), "Overzetten…", async () => {
      if ((await haalRitten(ik.id)).length) throw new Error("Er staan intussen al ritten in je account. Laad de pagina opnieuw.");
      const rijen = goed.map(naarRij);
      for (let i = 0; i < rijen.length; i += 500) {
        await sbVraag(sb.from("ritten").insert(rijen.slice(i, i + 500)), "Overzetten lukte niet");
      }
      const nu = await haalRitten(ik.id);
      vak.innerHTML = `<h2 class="beheer-kop">Je credits overzetten</h2>
        <p class="goed">✓ ${getal(nu.length)} ritten staan nu in je account.</p>
        <div class="knoppen"><a class="knop" href="./">Naar de startpagina</a></div>`;
      toast("Je credits zijn overgezet.", true);
    }));
  }

  async function logUit(waar) {
    try { await sb.auth.signOut({ scope: waar }); } catch (e) { console.warn(e); }
    // Lukt het afmelden bij Supabase niet (geen internet), dan in elk geval op dit apparaat.
    // Ook je afvinkkeuze en het mailadres van het inloggen gaan weg.
    try {
      for (const k of Object.keys(localStorage)) if (k === "achtbanen-sessie" || k.startsWith("achtbanen-sessie-") || k.startsWith("achtbanen-afvink-")) localStorage.removeItem(k);
    } catch (e) { /* geen opslag */ }
    sessieOpslag.wis(LOGIN_ADRES);
    location.replace("./");
  }

  /* ---------- Menu en voet ---------- */

  function tekenMenu() {
    const nav = $(".kop nav");
    if (nav && sbAan) {
      nav.insertAdjacentHTML("beforeend", `<a href="${PAGINA === "home" ? "" : "./"}#ranglijst">Vrienden</a>`);
      nav.insertAdjacentHTML("beforeend", ik
        ? `<a href="${esc(profielLink(ik))}" class="nav-ik" title="Mijn credits">${esc(ik.weergavenaam)}</a>`
        : '<a href="account.html" class="nav-ik">Inloggen</a>');
    }
    if (nav && beheer && PAGINA !== "beheer") nav.insertAdjacentHTML("beforeend", '<a href="beheer.html" class="nav-beheer">Beheer</a>');
    const voet = $(".voet");
    if (voet && sbAan) {
      voet.insertAdjacentHTML("beforeend", `<p class="voet-links">${PAGINA === "account" ? "" : `<a href="account.html">${ik ? "Mijn account" : "Inloggen"}</a>`}
        ${PAGINA === "privacy" ? "" : '<a href="privacy.html">Privacy</a>'}</p>`);
    }
  }

  /* ---------- Starten ---------- */
  document.querySelectorAll("[data-sitenaam]").forEach((el) => { el.textContent = SITE.naam; });
  if (["home", "achtbaan", "profiel", "vergelijk"].includes(PAGINA)) laadAlles().catch(() => { /* de pagina toont de fout */ });
  (async () => {
    if (!(await startAccount())) return;
    if (sessie) sessieOpslag.wis(LOGIN_ADRES);
    const melding = sessieOpslag.lees(MELDING);
    if (melding) { sessieOpslag.wis(MELDING); setTimeout(() => toast(melding, true), 300); }
    if (sbAan && ["home", "achtbaan", "profiel", "vergelijk"].includes(PAGINA)) laadIedereen().catch(() => { /* de pagina toont de fout */ });
    tekenMenu();
    if (PAGINA === "home") { document.title = SITE.naam; startPagina(); }
    if (PAGINA === "achtbaan") startAchtbaan();
    if (PAGINA === "beheer") startBeheer();
    if (PAGINA === "account") startAccountPagina();
    if (PAGINA === "profiel") startProfiel();
    if (PAGINA === "vergelijk") startVergelijk();
  })();
})();
