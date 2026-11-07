# PAPI INDUSTRIES — Turret Muzzle Flash Patch v4

**Zakres:** wyłącznie prezentacja strzałów Autocannona i Siege Cannona. Nie zmienia obrażeń, zasięgu, celowania w symulacji, przeładowania, kosztów, zapisu, QA ani plików `src/core/`.

## Wymagania

- Repo z poprawnie zastosowanymi patchami **v1 Art Integration**, **v2 Buildings**, **v3 Walls** i **v3.1 Fortifications**.
- Arkusze wieżyczek z v1 pozostają bez zmian: **Autocannon 8× 32×32**, **Siege Cannon 8× 32×35**. Używamy **wyłącznie 8 klatek `pristine`**. Nie używamy nieobecnych w PNG klatek `damaged` ani `shooting` z nowszych JSON-ów Aseprite.

## Nowe zasoby

```text
public/assets/sprites/turrets/autocannon-flash.png     (256×512, 8 kierunków × 4 klatki, 64×64)
public/assets/sprites/turrets/siege-cannon-flash.png    (256×512, 8 kierunków × 4 klatki, 64×64)
```

Rzędy obu arkuszy: **N, NE, E, SE, S, SW, W, NW**. Klatki w każdym rzędzie: 0..3. Efekt ma `origin=0.5,0.5` i pozycję **center-center wieżyczki**. Brak obracania bitmap, brak skalowania PNG źródłowych, brak wbudowania efektu w 32×32/32×35 bazowego działka.

## Timing (zegar symulacji, 60 ticków/s przy prędkości 1×)

| Wieżyczka | Klatki | Czas klatki | Całość | Mechanika, bez zmian |
|---|---:|---:|---:|---|
| Autocannon | 4 | 3 ticki, 50 ms | **12 ticków, 200 ms** | Strzał co 30 ticków |
| Siege Cannon | 4 | 6 ticków, 100 ms | **24 ticki, 400 ms** | Przeładowanie 300 ticków |

- Animacja zaczyna się **w chwili rzeczywistego strzału**, a nie w chwili rozpoczęcia przeładowania albo samego wykrycia celu.
- `frame = kierunek*4 + floor((tick - firedTick)/frameTicks)`.
- Po 12/24 tickach efekt jest **niewidoczny** (`visible=false`). Nie zamraża ostatniej klatki przez pozostałą część cooldownu.
- Kolejny wystrzał uruchamia jednorazową animację od nowa. Po zmianie na dzień, wyłączeniu działa lub zniszczeniu nie zostają osierocone efekty.
- Grafika kadłuba działa pozostaje na wybranym kierunku (8× `pristine`). Flash i bazowe działko mają osobne sprite’y.
- Przy 2×/4× animacja skraca się w czasie rzeczywistym wraz z symulacją. Podane milisekundy są dla 1×.

## Instalacja (PowerShell, katalog repo)

1. Upewnij się, że robocze zmiany w repo są zabezpieczone (`git status`).
2. Rozpakuj ten ZIP do **roota repo** (zachowując podkatalog `public/`). Paczka nie nadpisuje oryginalnych PNG wieżyczek.
3. Sprawdź i nałóż patch kodu:

   ```powershell
   git apply --check .\papi-turret-flash-v4.patch
   git apply .\papi-turret-flash-v4.patch
   ```

4. Lokalny eye check:
   - autocannon strzela seriami, błysk trwa krócej od 30-tickowego cooldownu;
   - siege cannon: po pocisku błysk gaśnie **po 24 tickach**, nawet gdy pasek przeładowania wciąż się napełnia;
   - sprawdź kierunki N/E/S/W i jeden ukośny;
   - sprawdź dzień/noc, wyłączenie, wyburzenie, a przy zoomie 1× i 2× centrowanie błysku.

**Jeśli `git apply --check` zgłasza konflikt, nie wymuszaj patchowania.** Porównaj `AutocannonLayer.js`, `SiegeLayer.js`, `GameScene.js` i `SpriteArt.js` z lokalną wersją.

## Testy wykonane na otrzymanym snapshotcie

- 8/8 ukierunkowanych testów jednostkowych w `tests/unit/turretFlash.test.js`: PASS.
- `node --check` dla plików JS: PASS.
- PNG: oba **256×512**, wszystkie 32 klatki niepuste; sprawdzone również 8 klatek wieżyczek.
- Patch sprawdzony względem `src(3).zip` + v1 + v2 + v3 + v3.1.
- **Nie wykonano** pełnego browser/E2E ani renderowania Phasera (brak kompletnego projektu Vite i zależności w przesłanym archiwum). Nie wykonywano szerokiej regresji.

**Nie dodano muzyki, SoundManagera, świateł bramy ani efektów dymu wykraczających poza dostarczone flash sheets.**
