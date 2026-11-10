// Instellingen voor je achtbanensite.
// Dit is het enige bestand dat je hoeft aan te passen.

window.SITE = {
  // Naam bovenaan de site en in het tabblad van je browser
  naam: "Rubens Achtbanen",

  // Je GitHub-gebruikersnaam en de naam van deze repository.
  // Die worden gebruikt voor beheer: achtbanen toevoegen, foto's, splitsen en verbergen.
  githubGebruiker: "RuDeMer",
  githubRepo: "achtbanen",
  branch: "main",

  // Accounts voor vrienden (Supabase). Laat leeg zolang je Supabase nog niet hebt
  // ingesteld: de site werkt dan zoals altijd met data/gereden.json.
  // Beide waarden vind je in Supabase bij Project Settings > API Keys (de sleutel)
  // en Project Settings > Data API (de URL).
  // Alleen de publieke sleutel (sb_publishable_…) hoort hier. De geheime sleutel
  // (sb_secret_… of service_role) komt NOOIT in dit bestand of ergens anders in de code.
  supabaseUrl: "https://zroovksrqzrufekbitjc.supabase.co/rest/v1/",
  supabaseSleutel: "sb_publishable_ag2SFfCD9z3pAajJNCymfA_FNxamJlY",

  // Jouw gebruikersnaam op de site. De startpagina toont de credits van dit profiel.
  eigenaar: "ruben",
};
