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

  /* ---------- Beheermodus: alleen jij ziet de knop "Zet op mijn lijst" ----------
     Zet hem aan door één keer ?beheer=aan achter het adres te zetten,
     en uit met ?beheer=uit. Je browser onthoudt de keuze. */
  try {
    if (params.get("beheer") === "aan") localStorage.setItem("beheer", "1");
    if (params.get("beheer") === "uit") localStorage.removeItem("beheer");
  } catch (e) { /* opslag niet beschikbaar */ }
  const beheer = (() => { try { return localStorage.getItem("beheer") === "1"; } catch (e) { return false; } })();

  /* ---------- Hulpfuncties ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const getal = (n, dec = 0) => Number(n).toLocaleString(TAAL, { maximumFractionDigits: dec });
  const zoekbaar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const meervoud = (n, een, veel) => (n === 1 ? een : veel);
  const pagina = (a) => `achtbaan.html?id=${encodeURIComponent(a.id)}`;

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

  // Eigen foto (pad of link) of een bestandsnaam op Wikimedia Commons
  function isEigenFoto(foto) { return /^(https?:|\.{0,2}\/|fotos\/)/.test(foto || ""); }
  function fotoBron(foto, breedte) {
    if (!foto) return null;
    if (isEigenFoto(foto)) return foto;
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(foto)}?width=${breedte}`;
  }
  const commonsPagina = (bestand) =>
    `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(bestand.replace(/ /g, "_"))}`;

  function statusTekst(a) {
    if (a.status === "gesloten") return a.gesloten ? `Gesloten in ${a.gesloten}` : "Gesloten";
    if (a.status === "gepland") return a.geopend ? `Opent in ${a.geopend}` : "Komt nog";
    return a.geopend ? `Open sinds ${a.geopend}` : "Open";
  }

  function toast(tekst) {
    const t = document.createElement("div");
    t.className = "toast";
    t.setAttribute("role", "status");
    t.textContent = tekst;
    (document.querySelector("dialog[open]") || document.body).appendChild(t);
    setTimeout(() => t.remove(), 3200);
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

  /* ---------- Gegevens laden ---------- */

  async function haalJson(pad, verplicht) {
    let r;
    try { r = await fetch(pad, { cache: "no-cache" }); } catch (e) { r = null; }
    if (!r || !r.ok) {
      if (verplicht) throw new Error(`Het bestand ${pad} kon niet geladen worden${r ? ` (fout ${r.status})` : ""}.`);
      return null;
    }
    const tekst = await r.text();
    try {
      // Een komma te veel na de laatste regel is geen probleem
      return JSON.parse(tekst.replace(/,(\s*[\]}])/g, "$1"));
    } catch (e) {
      throw new Error(`In ${pad} zit een typefout: ${e.message}`);
    }
  }

  let geladen = null;
  function laadAlles() {
    geladen = geladen || (async () => {
      const [basis, extra, mijn] = await Promise.all([
        haalJson("data/achtbanen.json", true),
        haalJson("data/extra.json", false),
        haalJson("data/gereden.json", false),
      ]);
      const lijst = [...(basis.achtbanen || []), ...((extra && extra.achtbanen) || [])]
        .filter((a) => a && a.id && a.naam);
      const perId = new Map(lijst.map((a) => [a.id, a]));

      const ritten = ((mijn && mijn.gereden) || []).filter((r) => r && r.id);
      const onbekend = [];
      for (const rit of ritten) {
        const a = perId.get(rit.id);
        if (!a) { onbekend.push(rit.id); continue; }
        (a.ritten = a.ritten || []).push(rit);
      }
      for (const a of lijst) {
        if (a.ritten) {
          a.ritten.sort((x, y) => String(x.datum || "9999").localeCompare(String(y.datum || "9999")));
          // Eerste rit telt; cijfer, notitie en foto mogen in een latere regel staan
          a.rit = Object.assign({}, ...a.ritten.slice().reverse(), { datum: a.ritten[0].datum });
        }
        a._zoek = zoekbaar([a.naam, a.park, a.land, a.fabrikant, a.type].join(" "));
      }
      if (onbekend.length) console.warn("Deze codes uit gereden.json staan niet in de lijst:", onbekend);
      return { lijst, perId, bijgewerkt: basis.bijgewerkt, onbekend };
    })();
    return geladen;
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
        ? "De teller staat nog op nul. Open een achtbaan en kies Zet op mijn lijst."
        : "De teller staat nog op nul.";
  }

  function vulFeiten(gereden) {
    const vak = $("#feiten");
    if (!gereden.length) return;
    const hoogste = (veld) => gereden.filter((a) => a[veld]).sort((a, b) => b[veld] - a[veld])[0];
    const opDatum = gereden.filter((a) => a.rit.datum)
      .sort((a, b) => String(a.rit.datum).localeCompare(String(b.rit.datum)));
    const favoriet = gereden.filter((a) => Number(a.rit.cijfer))
      .sort((a, b) => b.rit.cijfer - a.rit.cijfer)[0];
    const eerste = opDatum[0];
    const laatste = opDatum.length > 1 ? opDatum[opDatum.length - 1] : null;

    const feiten = [
      ["Hoogste", hoogste("hoogte"), (a) => `${getal(a.hoogte, 1)} m`],
      ["Snelste", hoogste("snelheid"), (a) => `${getal(a.snelheid)} km/u`],
      ["Langste", hoogste("lengte"), (a) => `${getal(a.lengte)} m`],
      ["Favoriet", favoriet, (a) => `${getal(a.rit.cijfer, 1)}/10`],
      ["Eerste credit", eerste, (a) => datum(a.rit.datum, true)],
      ["Nieuwste credit", laatste, (a) => datum(a.rit.datum, true)],
    ].filter(([, a]) => a);

    vak.innerHTML = feiten.map(([label, a, waarde]) => `
      <a class="feit" href="${pagina(a)}">
        <span class="feit-label">${label}</span>
        <span class="feit-waarde">${esc(waarde(a))}</span>
        <span class="feit-naam">${esc(a.naam)}</span>
      </a>`).join("");
    vak.hidden = false;
  }

  function tekenKaart(gereden) {
    const sectie = $("#kaart-sectie");
    const metPlek = gereden.filter((a) => a.lat != null && a.lon != null);
    if (!metPlek.length || !window.L) return;
    sectie.hidden = false;

    const groepen = new Map();
    for (const a of metPlek) {
      const sleutel = a.parkId || a.park || `${a.lat},${a.lon}`;
      if (!groepen.has(sleutel)) groepen.set(sleutel, { naam: a.park || a.land || "", lat: a.lat, lon: a.lon, banen: [] });
      groepen.get(sleutel).banen.push(a);
    }

    const kaart = L.map("kaart", { scrollWheelZoom: false, worldCopyJump: true });
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
  const SORTERINGEN = {
    naam: opNaam,
    nieuw: (a, b) => (b.geopend || 0) - (a.geopend || 0) || opNaam(a, b),
    oud: (a, b) => (a.geopend || 9999) - (b.geopend || 9999) || opNaam(a, b),
    hoog: (a, b) => (b.hoogte || 0) - (a.hoogte || 0) || opNaam(a, b),
    snel: (a, b) => (b.snelheid || 0) - (a.snelheid || 0) || opNaam(a, b),
    rit: (a, b) => String(b.rit?.datum || "").localeCompare(String(a.rit?.datum || "")) || opNaam(a, b),
  };

  function kaartHtml(a) {
    const src = fotoBron(a.rit?.foto || a.foto, 500);
    const plek = [a.park, a.land].filter(Boolean).join(", ");
    return `
      <a class="kaart${a.rit ? " is-gereden" : ""}" href="${pagina(a)}">
        <span class="kaart-foto">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">` : ""}</span>
        <span class="kaart-tekst">
          <span class="kaart-naam">${esc(a.naam)}</span>
          ${plek ? `<span class="kaart-plek">${esc(plek)}</span>` : ""}
          <span class="kaart-meta">${esc(statusTekst(a))}</span>
          ${a.rit ? `<span class="kaart-rit">✓ Gereden${a.rit.datum ? " " + esc(datum(a.rit.datum, true)) : ""}</span>` : ""}
        </span>
      </a>`;
  }

  function startOverzicht(data) {
    const { lijst } = data;
    const el = {
      zoek: $("#zoek"), land: $("#land"), status: $("#status"), sorteer: $("#sorteer"),
      gereden: $("#alleen-gereden"), raster: $("#raster"), meer: $("#meer"),
      tekst: $("#resultaten-tekst"), park: $("#park-filter"),
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
          <button class="knop knop-licht" type="button" id="wis-alles">Filters wissen</button></div>`;
        $("#wis-alles").addEventListener("click", wisAlles);
        el.meer.hidden = true;
        return;
      }
      if (alleenNieuwe) {
        el.raster.insertAdjacentHTML("beforeend", resultaat.slice(st.toon - PER_KEER, st.toon).map(kaartHtml).join(""));
      } else {
        el.raster.innerHTML = resultaat.slice(0, st.toon).map(kaartHtml).join("");
      }
      const over = n - st.toon;
      el.meer.hidden = over <= 0;
      el.meer.textContent = `Toon meer (nog ${getal(over)})`;
    }

    function ververs() { st.toon = PER_KEER; bereken(); toon(false); bewaarInAdres(); }
    function wisAlles() {
      Object.assign(st, { q: "", land: "", status: "", park: "", gereden: false });
      el.zoek.value = ""; el.land.value = ""; el.status.value = ""; el.gereden.checked = false;
      ververs();
    }

    let wacht;
    el.zoek.addEventListener("input", () => {
      clearTimeout(wacht);
      wacht = setTimeout(() => { st.q = el.zoek.value.trim(); ververs(); }, 150);
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
  }

  async function startPagina() {
    startBaan();
    let data;
    try { data = await laadAlles(); } catch (e) {
      $("#resultaten-tekst").textContent = "";
      toonFout($("#raster"), e);
      return;
    }
    const gereden = data.lijst.filter((a) => a.rit);
    vulHero(gereden);
    vulFeiten(gereden);
    tekenKaart(gereden);
    startOverzicht(data);
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

  function ritHtml(a) {
    if (!a.rit) {
      return beheer
        ? `<section class="blok"><div class="mijn-rit"><p>Deze staat nog niet op je lijst.</p>
             <button class="knop" type="button" data-rit-knop>Zet op mijn lijst</button></div></section>`
        : "";
    }
    const r = a.rit;
    const meer = a.ritten.length > 1
      ? `<p>${a.ritten.length} keer gereden:</p><ul class="ritten">${a.ritten.map((x) =>
          `<li>${esc(datum(x.datum) || "datum onbekend")}${x.notitie ? `, ${esc(x.notitie)}` : ""}</li>`).join("")}</ul>`
      : "";
    return `<section class="blok"><h2>Mijn rit</h2><div class="mijn-rit">
        ${r.notitie && a.ritten.length === 1 ? `<p class="notitie">${esc(r.notitie)}</p>` : ""}
        ${r.cijfer ? `<p><strong>Mijn cijfer: ${getal(r.cijfer, 1)}/10</strong></p>` : ""}
        ${meer}
        ${beheer ? `<button class="knop knop-licht" type="button" data-rit-knop>Nog een rit toevoegen</button>` : ""}
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
    if (a.lat != null) links.push(`<a href="https://www.openstreetmap.org/?mlat=${a.lat}&mlon=${a.lon}#map=16/${a.lat}/${a.lon}">OpenStreetMap</a>`);
    return `<section class="blok"><h2>Meer weten</h2><ul class="links">${links.map((l) => `<li>${l}</li>`).join("")}</ul></section>`;
  }

  function startRitVenster(a) {
    const knoppen = document.querySelectorAll("[data-rit-knop]");
    if (!knoppen.length) return;
    const editLink = SITE.githubGebruiker && !/JOUW-/.test(SITE.githubGebruiker)
      ? `https://github.com/${SITE.githubGebruiker}/${SITE.githubRepo}/edit/${SITE.branch}/data/gereden.json`
      : null;
    const vandaag = new Date().toISOString().slice(0, 10);

    const d = document.createElement("dialog");
    d.className = "dialoog";
    d.setAttribute("aria-labelledby", "rit-titel");
    d.innerHTML = `
      <h2 id="rit-titel">${esc(a.naam)} op je lijst zetten</h2>
      <label>Datum van je rit <input type="date" id="rit-datum" value="${vandaag}"></label>
      <label>Cijfer van 1 tot 10 (mag leeg) <input type="text" id="rit-cijfer" inputmode="decimal" placeholder="bijvoorbeeld 8,5"></label>
      <label>Notitie (mag leeg) <input type="text" id="rit-notitie" maxlength="200" placeholder="Bijvoorbeeld: voorste rij, regen"></label>
      <label>Eigen foto in de map fotos (mag leeg) <input type="text" id="rit-foto" placeholder="bijvoorbeeld baron.jpg"></label>
      <p class="klein">Deze regel komt in <code>data/gereden.json</code>:</p>
      <pre id="rit-regel"></pre>
      <div class="knoppen">
        <button class="knop" type="button" id="rit-kopieer">Kopieer regel</button>
        ${editLink ? `<a class="knop knop-licht" id="rit-github" href="${editLink}" target="_blank" rel="noopener">Open gereden.json op GitHub</a>` : ""}
        <button class="knop knop-licht" type="button" id="rit-sluit">Sluiten</button>
      </div>
      <p class="klein">Plak de regel op een nieuwe regel direct onder <code>"gereden": [</code> en kies <strong>Commit changes</strong>. Na een paar minuten staat hij op je teller.
      ${editLink ? "" : " Vul eerst je GitHub-gebruikersnaam in bij config.js, dan verschijnt hier een directe link."}</p>`;
    document.body.appendChild(d);

    const veld = (id) => $(`#${id}`, d);
    function regel() {
      const rit = { id: a.id, datum: veld("rit-datum").value || undefined };
      const cijfer = parseFloat(String(veld("rit-cijfer").value).replace(",", "."));
      if (cijfer >= 1 && cijfer <= 10) rit.cijfer = cijfer;
      const notitie = veld("rit-notitie").value.trim();
      if (notitie) rit.notitie = notitie;
      const foto = veld("rit-foto").value.trim().replace(/^fotos\//, "");
      if (foto) rit.foto = `fotos/${foto}`;
      return `    ${JSON.stringify(rit).replace(/,"/g, ', "').replace(/":/g, '": ')},`;
    }
    const werkBij = () => { veld("rit-regel").textContent = regel().trim(); };
    d.addEventListener("input", werkBij);
    werkBij();

    veld("rit-kopieer").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(regel());
        toast("Gekopieerd. Plak de regel in gereden.json op GitHub.");
      } catch (e) {
        const bereik = document.createRange();
        bereik.selectNodeContents(veld("rit-regel"));
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(bereik);
        toast("Kopiëren lukte niet automatisch. De regel is geselecteerd, kopieer hem met Ctrl+C.");
      }
    });
    veld("rit-sluit").addEventListener("click", () => d.close());
    knoppen.forEach((k) => k.addEventListener("click", () => d.showModal()));
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
    const eigenFoto = a.rit?.foto;
    const fotoVeld = eigenFoto || a.foto;
    const src = fotoBron(fotoVeld, 1280);
    const fotoBijschrift = eigenFoto ? "Eigen foto"
      : a.foto && !isEigenFoto(a.foto) ? `Foto: <a href="${commonsPagina(a.foto)}">Wikimedia Commons</a>` : "";
    const plek = [
      a.park ? `<a href="./?park=${encodeURIComponent(a.parkId || a.park)}#overzicht">${esc(a.park)}</a>` : "",
      a.land ? esc(a.land) : "",
    ].filter(Boolean).join(", ");

    const stempel = a.rit
      ? `<div class="stempel">Gereden${a.rit.datum ? `<small>op ${esc(datum(a.rit.datum))}</small>` : ""}</div>`
      : `<div class="stempel is-nog-niet">Nog niet gereden</div>`;

    vak.innerHTML = `
      <nav class="terug" aria-label="Terug"><a href="./#overzicht" id="terug">Alle achtbanen</a></nav>
      <figure class="foto-groot">
        ${src ? `<img src="${esc(src)}" alt="Foto van ${esc(a.naam)}" id="hoofdfoto">` : '<div class="foto-leeg" role="img" aria-label="Geen foto beschikbaar"></div>'}
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
    if (foto) foto.addEventListener("error", () => {
      foto.replaceWith(Object.assign(document.createElement("div"), { className: "foto-leeg" }));
      $("#foto-bron")?.remove();
    });

    $("#terug").addEventListener("click", (e) => {
      if (document.referrer.startsWith(location.origin) && history.length > 1) { e.preventDefault(); history.back(); }
    });

    tekenMiniKaart(a);
    startRitVenster(a);

    if (/^Q\d+$/.test(a.id)) {
      haalWikipedia(a.id).then((w) => {
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
      haalFotoInfo(a.foto).then((info) => {
        const bron = $("#foto-bron");
        if (!bron || (!info.maker && !info.licentie)) return;
        bron.innerHTML = `Foto: ${esc(info.maker || "onbekende maker")}${info.licentie ? `, ${esc(info.licentie)}` : ""}, via <a href="${commonsPagina(a.foto)}">Wikimedia Commons</a>`;
      }).catch((e) => console.warn("Commons niet bereikbaar", e));
    }
  }

  /* ---------- Starten ---------- */
  document.querySelectorAll("[data-sitenaam]").forEach((el) => { el.textContent = SITE.naam; });
  if (document.body.dataset.pagina === "home") { document.title = SITE.naam; startPagina(); }
  if (document.body.dataset.pagina === "achtbaan") startAchtbaan();
})();
