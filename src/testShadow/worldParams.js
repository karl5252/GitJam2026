// testShadow/worldParams.js
//
// TEST_MODE-only map overrides. The caller must guard this with TEST_MODE, so a
// shipped build always plays the default map on its fixed seed.
//
//   ?map=open|jungle  which map to play. Unknown ids are ignored.
//   ?worldSeed=N      the terrain's seed, on a map that has terrain. It is separate
//                     from ?seed, which is the wave RNG.

import {parseSeed} from '../core/seededRandom.js';
import {getWorldMap} from '../core/worldMap.js';

/** @returns {{map: object|null, worldSeed: number|null}} */
export function parseWorldParams(search) {
    const params = new URLSearchParams(search);
    return {map: getWorldMap(params.get('map')), worldSeed: parseSeed(params.get('worldSeed'))};
}
