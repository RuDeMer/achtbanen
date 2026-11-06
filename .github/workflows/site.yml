name: Site bouwen en publiceren

on:
  # Elke keer dat je iets wijzigt (bijvoorbeeld gereden.json)
  push:
    branches: [main]
  # Met de hand starten via het tabblad Actions
  workflow_dispatch:
  # Elke eerste dag van de maand om 04:17 (UTC) nieuwe achtbanen ophalen
  schedule:
    - cron: "17 4 1 * *"

permissions:
  contents: write
  pages: write
  id-token: write
  actions: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  bouwen:
    runs-on: ubuntu-latest
    steps:
      - name: Bestanden ophalen
        uses: actions/checkout@v5
        with:
          # Altijd de nieuwste versie, ook als er net een andere run iets heeft opgeslagen
          ref: main

      - name: Achtbanen ophalen bij Wikidata en opslaan
        # Bij een gewone wijziging alleen als de lijst er nog niet is,
        # bij de maandelijkse of handmatige run altijd.
        if: github.event_name != 'push' || hashFiles('data/achtbanen.json') == ''
        run: |
          python3 scripts/haal_achtbanen.py
          # Nieuwe lijst apart zetten, de nieuwste versie van GitHub ophalen
          # en de lijst er daarna overheen zetten. Zo kan er geen conflict ontstaan.
          cp data/achtbanen.json "$RUNNER_TEMP/achtbanen.json"
          git fetch origin main
          git reset --hard origin/main
          cp "$RUNNER_TEMP/achtbanen.json" data/achtbanen.json
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data/achtbanen.json
          if ! git diff --cached --quiet; then
            git commit -m "Achtbanen bijgewerkt vanuit Wikidata"
            git push origin HEAD:main
          fi

      - name: Pages voorbereiden
        uses: actions/configure-pages@v5

      - name: Site inpakken
        uses: actions/upload-pages-artifact@v4
        with:
          path: .

  publiceren:
    needs: bouwen
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Op GitHub Pages zetten
        id: deployment
        uses: actions/deploy-pages@v4
