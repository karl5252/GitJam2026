# PAPI Industries — Art Integration Patch v2

## Wymagania

- Wczesniej zastosowany **PAPI Art Integration Patch v1** (`src/scenes/SpriteArt.js`, `BootScene.js` i pozostale warstwy sprite'ow juz istnieja).
- Ten patch jest przygotowany na podstawie przeslanego archiwum `src(3).zip` po zastosowaniu v1. Nie obejmuje innych lokalnych zmian w Twoim repozytorium.

## Instalacja (Windows / PowerShell)

1. Zrob `git status` i najlepiej zapisz biezace zmiany osobno.
2. Rozpakuj cala zawartosc ZIP do katalogu glownego repozytorium (tak, by pliki trafily pod `public/assets/sprites/...`).
3. W katalogu repozytorium wykonaj:

```powershell
git apply --check .\papi-buildings-art-v2.patch
git apply .\papi-buildings-art-v2.patch
```

4. Uruchom lokalna gre (`npm run dev`) i ocen sprite'y w praktyce. Opcjonalnie test jednostkowy:

```powershell
node --test tests/unit/spriteArt.test.js
```

Jesli `git apply --check` zglosi konflikt, nie wymuszaj aplikacji. Najpierw porownaj roznice, bo Twoje repo moze miec nowsze pliki.

## Nowe pliki

```
public/assets/sprites/buildings/
  hq.png           # dwie klatki ulozone pionowo: dzien/noc, 32x40
  barracks.png     # dwie klatki poziomo: rifle/rocket, 32x29
  power-plant.png  # dwie klatki poziomo: OFF/ON, 32x34
  factory.png      # jedna klatka, 32x32

public/assets/sprites/units/
  rifleman.json    # metadane Aseprite (informacyjne)
  rocketman.json   # metadane Aseprite (informacyjne)
```

Do tego nowe `src/scenes/BuildingArtLayer.js` i `tests/unit/spriteArt.test.js` przez patch.

## Co zmienia kod

- **HQ:** 2 klatki przelaczane automatycznie po zmianie dnia/nocy (zgodnie z aktualnym cyklem gry).
- **Barracks:** wyglad rifleman / rocketman zaleznie od `building.role`, takze po reficie.
- **Factory:** grafika zamiast pelnego szarego prostokata.
- **Power Plant:** wybor kadru OFF/ON, plus przyciemnienie gdy wylaczona.
- **Rifleman i Rocketman:** cztery kadry `action` ze spritesheetow Aseprite (oryginalne PNG z v1), 6 tickow na kadr. To *tylko* animacja odpalana przez istniejacy event strzalu: Rifleman wizualnie strzela seria, Rocketman pojedynczym strzalem, bez dodatkowych obrazen, pociskow ani triggerow.
- **Siege Cannon:** skala obrazu 2.0, tylko wyglad. Brak nowego muzzle flash, bo to asset planowany na pozniej.
- **Nienaruszone:** `src/core`, obrazenia, pathfinding, footprinty budynkow, selekcja, koszty, power, fog, QA snapshoty, logika animacji innych obiektow.

## Aktualne ograniczenia

- Dostarczone dwie klatki `power-plant.png` sa obecnie **wizualnie identyczne**. Kod je przelacza, ale roznica bedzie widoczna dopiero po podmianie artu.
- Dwa warianty koszar roznia sie na razie minimalnie (kilka pikseli). W przyszlosci mozna je mocniej rozroznic graficznie.
- Po zmianie skal warto sprawdzic zakrywanie sasiadow i Fog of War na mapie 48x32.
- Strzelanie Riflemanow jest animacja serii, lecz gameplay nadal nalicza **jeden hit na jedno zdarzenie strzalu**.
- Nie obejmuje napraw mutant facing, skali Brute ani animacji jego ataku. To osobne tematy z eye checku.

## Weryfikacja

- Patch sprawdzony na czystym baseline v1: `git apply --check` i `git apply` bez konfliktow.
- 3/3 docelowych testow Node przechodza.
- Wszystkie nowe PNG i JSON zweryfikowane co do rozmiarow, plikow i klatek.
- **Nie wykonano runtime eye check w Phaserze ani E2E**, bo przeslany wycinek `src` nie zawiera instalowalnego projektu (`package.json`, node_modules itp.).

---

*Ministry of Architecture: buildings are now slightly more expensive-looking. The actual prices are unchanged.*
