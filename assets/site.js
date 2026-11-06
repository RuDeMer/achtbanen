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
      .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
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
      const [basis, extra, mijn] = await Promise.all([
        haalJson("data/achtbanen.json", true),
        laadEigen("data/extra.json"),
        laadEigen("data/gereden.json"),
      ]);
      // Verwijzingen: oude ids (bijvoorbeeld een OSM-baan die nu in Wikidata staat, of een
      // regel uit extra.json die nu in de bronnen staat) wijzen naar de achtbaan van nu
      const aliassen = basis.aliassen || {};
      const lijst = [...(basis.achtbanen || []), ...((extra && extra.achtbanen) || []).filter((a) => a && !aliassen[a.id])]
        .filter((a) => a && a.id && a.naam);
      const perId = new Map(lijst.map((a) => [a.id, a]));
      for (const [oud, nieuw] of Object.entries(aliassen)) if (!perId.has(oud) && perId.has(nieuw)) perId.set(oud, perId.get(nieuw));
      for (const a of lijst) a._zoek = zoekbaar([a.naam, a.park, a.land, a.fabrikant, a.type].join(" "));
      const data = { lijst, perId, bijgewerkt: basis.bijgewerkt, details: basis.details, extra: (extra && extra.achtbanen) || [] };
      zetRitten(data, (mijn && mijn.gereden) || []);
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
      const a = data.perId.get(rit.id);
      if (!a) { data.onbekend.push(rit); continue; }
      (a.ritten = a.ritten || []).push(rit);
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

  async function bewaarRitten(data, wijzig, bericht) {
    const nieuw = await wijzigJson("data/gereden.json", "gereden", wijzig, bericht);
    zetRitten(data, nieuw.gereden);
  }

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

  function vulHero(gereden) {
    const n = gereden.length;
    $("#aantal").textContent = getal(n);
    $("#teller-uitleg").textContent = meervoud(n, "achtbaan gereden", "achtbanen gereden");
    const landen = new Set(gereden.map((a) => a.land).filter(Boolean)).size;
    const parken = new Set(gereden.map((a) => a.parkId || a.park).filter(Boolean)).size;
    $("#teller-sub").textContent = n
      ? `in ${landen} ${meervoud(landen, "land", "landen")} en ${parken} ${meervoud(parken, "park", "parken")}`
      : beheer
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
    const foto = a.rit?.foto || a.foto;
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
      if (st.q) u.set("q", st.q);
      if (st.land) u.set("land", st.land);
      if (st.status) u.set("status", st.status);
      if (st.sorteer !== "naam") u.set("sorteer", st.sorteer);
      if (st.gereden) u.set("gereden", "1");
      if (st.park) u.set("park", st.park);
      const qs = u.toString();
      history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    }

    function parkNaam() {
      const a = lijst.find((x) => x.parkId === st.park || x.park === st.park);
      return a ? a.park : st.park;
    }

    function bereken() {
      const woorden = zoekbaar(st.q).split(/\s+/).filter(Boolean);
      resultaat = lijst.filter((a) =>
        (!st.gereden || a.rit) &&
        (!st.land || a.land === st.land) &&
        (!st.status || a.status === st.status) &&
        (!st.park || a.parkId === st.park || a.park === st.park) &&
        woorden.every((w) => a._zoek.includes(w)));
      resultaat.sort(SORTERINGEN[st.sorteer]);
    }

    function toon(alleenNieuwe) {
      const n = resultaat.length;
      const gefilterd = st.q || st.land || st.status || st.park || st.gereden;
      el.tekst.textContent = st.gereden
        ? `${getal(n)} ${meervoud(n, "credit", "credits")}`
        : `${getal(n)} ${meervoud(n, "achtbaan", "achtbanen")}${gefilterd ? " gevonden" : " in de lijst"}`;

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

    /* ---------- Afvinkmodus (alleen beheer) ----------
       Een vinkje op elk kaartje. Je keuze blijft bewaard als je filtert of de pagina
       herlaadt. Opslaan zet alles in één keer (één commit) in gereden.json. */
    const AFVINK = "achtbanen-afvink";
    const af = { aan: false, gekozen: new Set() };
    if (beheer) {
      try {
        const b = JSON.parse(opslag.lees(AFVINK) || "null");
        if (b) { af.aan = !!b.aan; af.gekozen = new Set((b.ids || []).filter((id) => data.perId.has(id))); }
      } catch (e) { /* begin leeg */ }
      el.filters.insertAdjacentHTML("afterend", '<div class="beheer-balk" id="beheer-balk"></div>');
      $("#overzicht").insertAdjacentHTML("beforeend", '<div class="afvink-balk" id="afvink-balk" hidden></div>');
    }
    const bewaarAfvink = () => opslag.zet(AFVINK, JSON.stringify({ aan: af.aan, ids: [...af.gekozen] }));
    const nogTeKiezen = () => resultaat.filter((a) => !a.rit && !af.gekozen.has(a.id));

    function tekenAfvink() {
      if (!beheer) return;
      const balk = $("#beheer-balk"), onder = $("#afvink-balk");
      if (!af.aan) {
        balk.innerHTML = `<button class="knop knop-licht" type="button" id="afvink-aan">Afvinken</button>
          <button class="knop knop-licht" type="button" id="ontbreekt">Achtbaan ontbreekt</button>
          <span class="klein">Snel een hele rij achtbanen op je lijst zetten, of er zelf een toevoegen.</span>`;
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
      const gelukt = await metKnop(knop, fout, "Opslaan…", () => bewaarRitten(data, (ritten) => {
        // Staat een baan intussen al op je lijst (bijvoorbeeld via je telefoon), dan niet nog een keer
        const al = new Set(ritten.map((r) => r && data.perId.get(r.id)).filter(Boolean));
        return [...ritten, ...banen.filter((a) => !al.has(a)).map((a) => (jaar ? { id: a.id, datum: jaar } : { id: a.id }))];
      }, bericht));
      if (!gelukt) return;
      af.gekozen.clear();
      bewaarAfvink();
      naWijziging();
      bereken();
      toon(false);
      toast(`${getal(banen.length)} ${meervoud(banen.length, "credit", "credits")} opgeslagen. Bezoekers zien het over een paar minuten.`, true);
    }

    if (beheer) {
      $("#overzicht").addEventListener("click", (e) => {
        const knop = e.target.closest("button");
        if (!knop) return;
        if (knop.id === "afvink-aan") { af.aan = true; bewaarAfvink(); toon(false); }
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
        if (knop.id === "ontbreekt" || knop.id === "ontbreekt-leeg") openOntbreektVenster(data, st.q);
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
      Object.assign(st, { q: "", land: "", status: "", park: "", gereden: false });
      el.zoek.value = ""; el.land.value = ""; el.status.value = ""; el.gereden.checked = false;
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
    const vulBoven = () => { vulHero(data.gereden); vulFeiten(data.gereden); tekenKaart(data.gereden); };
    vulBoven();
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

  function ritHtml(a) {
    if (!a.rit) {
      return beheer
        ? `<section class="blok"><div class="mijn-rit"><p>Deze staat nog niet op je lijst.</p>
             <button class="knop" type="button" data-rit-nieuw>Zet op mijn lijst</button></div></section>`
        : "";
    }
    const r = a.rit;
    let lijst = "";
    if (beheer) {
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
        ${beheer ? `<button class="knop knop-licht" type="button" data-rit-nieuw>Nog een rit toevoegen</button>` : ""}
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
    if (/^Q\d+$/.test(a.id)) links.push(`<a href="https://www.wikidata.org/wiki/${a.id}">Wikidata</a>`);
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
        <div class="foto-kiezen">
          <span class="foto-kiezen-titel">Eigen foto (mag leeg)</span>
          <div class="foto-kiezen-rij">
            <span class="foto-voorbeeld" id="rit-voorbeeld">${v.foto ? `<img src="${esc(fotoBron(v.foto, 300))}" alt="Je foto"${eigenPad(v.foto) ? ` data-eigen="${esc(eigenPad(v.foto))}"` : ""}>` : ""}</span>
            <span class="foto-kiezen-knoppen">
              <label class="knop knop-licht knop-bestand"><span id="rit-bestand-tekst">${v.foto ? "Andere foto kiezen" : "Kies een foto"}</span><input class="sr" type="file" id="rit-bestand" accept="image/*"></label>
              <button class="knop-klein knop-gevaar" type="button" id="rit-foto-weg"${v.foto ? "" : " hidden"}>Foto weghalen</button>
            </span>
          </div>
          <p class="klein" id="rit-foto-info">${v.foto ? "" : "Van je telefoon of computer. De site maakt hem eerst kleiner (maximaal 1600 pixels breed)."}</p>
        </div>
        <p class="fout" id="rit-fout" role="alert"></p>
        <div class="knoppen">
          <button class="knop" type="submit" id="rit-opslaan">${oud ? "Wijziging opslaan" : "Zet op mijn lijst"}</button>
          <button class="knop knop-licht" type="button" id="rit-sluit">Annuleren</button>
        </div>
        <p class="klein">Wordt meteen opgeslagen in <code>data/gereden.json</code> op GitHub. Bezoekers zien het na een paar minuten.</p>
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
      zet("notitie", veld("rit-notitie").value.trim());
      if (fotoKeuze.weg) delete rit.foto;
      for (const k of Object.keys(rit)) if (rit[k] === undefined) delete rit[k];
      return rit;
    }

    // Eigen foto: meteen verkleinen in de browser, uploaden pas bij Opslaan
    const fotoKeuze = { blob: null, weg: false };
    const voorbeeld = veld("rit-voorbeeld");
    voorbeeld.addEventListener("error", (e) => { if (e.target.tagName === "IMG") fotoMislukt(e.target); }, true);
    veld("rit-bestand").addEventListener("change", async (e) => {
      const bestand = e.target.files && e.target.files[0];
      if (!bestand) return;
      const info = veld("rit-foto-info");
      info.textContent = "Foto verkleinen…";
      veld("rit-fout").textContent = "";
      try {
        const klein = await verkleinFoto(bestand, 1600);
        fotoKeuze.blob = klein.blob;
        fotoKeuze.weg = false;
        voorbeeld.innerHTML = "";
        voorbeeld.appendChild(Object.assign(new Image(), { src: URL.createObjectURL(klein.blob), alt: "Je foto" }));
        info.textContent = `Klaar: ${klein.breedte} × ${klein.hoogte} pixels, ${getal(klein.blob.size / 1024)} kB. Wordt geüpload als je opslaat.`;
        veld("rit-foto-weg").hidden = false;
        veld("rit-bestand-tekst").textContent = "Andere foto kiezen";
      } catch (fout) {
        console.error(fout);
        info.textContent = "";
        veld("rit-fout").textContent = fout.message;
      }
      e.target.value = "";
    });
    veld("rit-foto-weg").addEventListener("click", () => {
      fotoKeuze.blob = null;
      fotoKeuze.weg = true;
      voorbeeld.innerHTML = "";
      veld("rit-foto-weg").hidden = true;
      veld("rit-bestand-tekst").textContent = "Kies een foto";
      veld("rit-foto-info").textContent = v.foto ? "De foto wordt van deze rit gehaald als je opslaat. Het bestand blijft in de map fotos staan." : "";
    });

    veld("rit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      let rit;
      try { rit = leesFormulier(); } catch (fout) { veld("rit-fout").textContent = fout.message; return; }
      const knop = veld("rit-opslaan");
      const gelukt = await metKnop(knop, veld("rit-fout"), "Opslaan…", async () => {
        if (fotoKeuze.blob) {
          knop.textContent = "Foto uploaden…";
          rit.foto = await uploadFoto(a, fotoKeuze.blob);
          fotoKeuze.blob = null; // niet nog eens uploaden als het opslaan hierna mislukt
          knop.textContent = "Opslaan…";
        }
        await bewaarRitten(data, (lijst) => {
          if (!oud) return [...lijst, rit];
          const i = vindRit(lijst, oud);
          if (i < 0) throw new Error("Deze rit is intussen op een andere plek gewijzigd. Laad de pagina opnieuw en probeer het nog eens.");
          lijst[i] = rit;
          return lijst;
        }, `${oud ? "Rit bewerkt" : "Rit toegevoegd"}: ${a.naam}`);
      });
      if (!gelukt) return;
      d.close();
      klaar();
      toast("Opgeslagen. Over een paar minuten staat het ook op de openbare site.", true);
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
    const gelukt = await metKnop(knop, null, "Bezig…", () =>
      bewaarRitten(data, (lijst) => {
        const i = vindRit(lijst, rit);
        if (i < 0) throw new Error("Deze rit staat niet meer in gereden.json. Laad de pagina opnieuw.");
        lijst.splice(i, 1);
        return lijst;
      }, `Rit verwijderd: ${a.naam}`));
    if (!gelukt) return;
    klaar();
    toast("Verwijderd. Over een paar minuten is het ook van de openbare site af.", true);
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
        <label class="vinkje"><input type="checkbox" id="nieuw-gereden" checked> Meteen op mijn lijst zetten (zonder datum)</label>
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
      const ookRit = veld("nieuw-gereden").checked;
      const gelukt = await metKnop(veld("nieuw-opslaan"), fout, "Opslaan…", async () => {
        await wijzigJson("data/extra.json", "achtbanen", (lijst) => {
          if (lijst.some((x) => x && x.id === id)) return lijst;
          return [...lijst, nieuw];
        }, `Achtbaan toegevoegd aan extra.json: ${naam}`);
        if (ookRit) await wijzigJson("data/gereden.json", "gereden", (ritten) => [...ritten, { id }], `Rit toegevoegd: ${naam}`);
      });
      if (!gelukt) return;
      d.close();
      toast(`${naam} is toegevoegd. Bezoekers zien hem over een paar minuten.`, true);
      location.href = `achtbaan.html?id=${encodeURIComponent(id)}`;
    });
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
    const a = data.perId.get(id);
    if (!a) {
      vak.innerHTML = `<div class="melding"><h1>Deze achtbaan staat niet in de lijst</h1>
        <p>Er is geen achtbaan met de code <code>${esc(id) || "(leeg)"}</code>.</p>
        <p><a href="./#overzicht">Zoek in alle achtbanen</a></p></div>`;
      return;
    }
    document.title = `${a.naam}${a.park ? ", " + a.park : ""} | ${SITE.naam}`;
    if (data.details) {
      try { Object.assign(a, ((await haalJson(data.details, false)) || {})[a.id] || {}); } catch (e) { console.warn(e); }
    }
    tekenAchtbaan(a, data);
  }

  function tekenAchtbaan(a, data) {
    const vak = $("#inhoud");
    const eigenFoto = a.rit?.foto;
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
          ${plek ? `<p class="plek">${plek}</p>` : ""}
          <p class="status status-${esc(a.status || "open")}">${esc(statusTekst(a))}</p>
        </div>
        ${stempel}
      </header>
      ${specsHtml(a)}
      ${ritHtml(a)}
      <div class="twee">
        <section class="over" id="over" hidden><h2>Over deze achtbaan</h2><div id="wiki"></div></section>
        <section class="plaats"><h2>Waar staat hij?</h2><div class="minikaart" id="minikaart" role="region" aria-label="Kaart"></div></section>
      </div>
      ${zelfdeParkHtml(a, data.lijst)}
      ${bronnenHtml(a)}`;

    const foto = $("#hoofdfoto");
    if (foto) foto.addEventListener("error", () => fotoMislukt(foto, () => {
      foto.replaceWith(Object.assign(document.createElement("div"), { className: "foto-leeg" }));
      $("#foto-bron")?.remove();
    }));

    $("#terug").addEventListener("click", (e) => {
      if (document.referrer.startsWith(location.origin) && history.length > 1) { e.preventDefault(); history.back(); }
    });

    tekenMiniKaart(a);

    if (beheer) {
      const opnieuw = () => tekenAchtbaan(a, data);
      vak.querySelectorAll("[data-rit-nieuw]").forEach((k) => k.addEventListener("click", () => openRitVenster(a, data, null, opnieuw)));
      vak.querySelectorAll("[data-rit-bewerk]").forEach((k) => k.addEventListener("click", () =>
        openRitVenster(a, data, a.ritten[Number(k.dataset.ritBewerk)], opnieuw)));
      vak.querySelectorAll("[data-rit-weg]").forEach((k) => k.addEventListener("click", () =>
        verwijderRit(a, data, a.ritten[Number(k.dataset.ritWeg)], k, opnieuw)));
    }

    if (/^Q\d+$/.test(a.id)) {
      onthoud(`wiki:${a.id}`, () => haalWikipedia(a.id)).then((w) => {
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
        ? `<p class="beheer-aan"><strong>Beheer staat aan op dit apparaat.</strong> Je ziet nu de knoppen om ritten op te slaan, te bewerken en te verwijderen.</p>
           <p class="klein">Token: <code>${esc(token.slice(0, 15))}…${esc(token.slice(-4))}</code></p>
           <div id="token-uitslag" role="status">${melding || ""}</div>
           <div class="knoppen">
             <a class="knop" href="./#overzicht">Naar alle achtbanen</a>
             <button class="knop knop-licht" type="button" id="token-test">Token controleren</button>
             <button class="knop knop-licht knop-gevaar" type="button" id="token-weg">Token verwijderen</button>
           </div>
           <div id="beheer-onbekend"></div>`
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
      try {
        const data = await laadAlles();
        if (!data.onbekend.length) return;
        $("#beheer-onbekend").innerHTML = `<p class="fout">${data.onbekend.length} ${meervoud(data.onbekend.length, "rit verwijst", "ritten verwijzen")} naar een achtbaan die niet meer in de lijst staat:
          ${data.onbekend.map((r) => `<code>${esc(r.id)}</code>`).join(", ")}. Ze tellen niet mee. Kijk of de code in <code>data/gereden.json</code> klopt.</p>`;
      } catch (e) { /* lijst niet beschikbaar */ }
    }

    teken();
  }

  /* ---------- Starten ---------- */
  document.querySelectorAll("[data-sitenaam]").forEach((el) => { el.textContent = SITE.naam; });
  if (beheer && PAGINA !== "beheer") {
    $(".kop nav")?.insertAdjacentHTML("beforeend", '<a href="beheer.html" class="nav-beheer">Beheer</a>');
  }
  if (PAGINA === "home") { document.title = SITE.naam; startPagina(); }
  if (PAGINA === "achtbaan") startAchtbaan();
  if (PAGINA === "beheer") startBeheer();
})();
