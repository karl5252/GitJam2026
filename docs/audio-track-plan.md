# PAPI INDUSTRIES — music track mapping (planned, not integrated)

**Status: documentation only.** No music files are included in the wall-art patch. Do not implement audio loading, playback, or SoundManager migration as part of TASK 025/art integration.

The two candidate WAV masters supplied by the developer are:

| Proposed track ID | Source master (developer-provided) | Suggested future game asset | Proposed usage | Status |
|---|---|---|---|---|
| `music.day` | `Spanish - Océano Loop.wav` | `public/assets/audio/music/oceano-loop.ogg` | Day / building / work shift | **Provisional: confirm on listening** |
| `music.night` | `Spanish - Como Versace Loop.wav` | `public/assets/audio/music/como-versace-loop.ogg` | Night / defense | **Provisional: confirm on listening** |

There is **no chosen menu track** and **no chosen dusk transition** yet. Those slots must not silently reuse either song without a separate decision.

## When migrating SoundManager from BarrelStorm

1. Confirm the two assignments by actually listening to both tracks; do not treat filenames as evidence of musical mood.
2. Keep the WAV masters out of `public/` and out of the browser build. Convert them to browser-friendly OGG (and optionally MP3 fallback) before integration, without changing the original WAVs.
3. Keep the future audio directory separate from sprite assets:

   ```text
   public/assets/audio/music/
     oceano-loop.ogg
     como-versace-loop.ogg
   ```

4. Map game-facing track IDs (`music.day`, `music.night`) to URLs in the future SoundManager config. Loop, volume, and crossfades belong there, **not** in rendering layers.
5. Use the existing game phase events for transitions when the active Day / Dusk / Night changes are implemented. Do not infer or add a new clock from the music.
6. Confirm commercial/public-distribution rights for the recordings before including them in a release.

**This plan is not implementation approval.** The current game intentionally remains silent.
