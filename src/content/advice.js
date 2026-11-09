/**
 * TASK 033.3: Presidential Advice, as data. Pure: no Phaser, no simulation.
 *
 * Each tip:
 *   id        stable; what "seen" remembers
 *   priority  higher shows first when several apply at once
 *   urgent    may follow another tip after a short gap instead of the full cooldown
 *   title, text
 *   book      the Little Yellow Book page its BOOK button opens, by heading
 *   voice     TASK 033.4: the stem of El Presidente's recorded line (sound/VOICES/<stem>.ogg and
 *             .m4a). It speaks only once the line is in the sound map: see src/audio/adviceNarrator.js
 *   when      (facts) => boolean: the advice applies right now. It is asked again while
 *             the tip shows: once it no longer applies, the player has done it, and the
 *             tip goes. It never says to do what the rules forbid at that moment.
 *
 * Facts are what GameScene reports (see GameScene.adviceFacts): deployment (Day 0),
 * activeDay (a timed Day after it), day (any Day), hqBuilt, defences, factories, mines,
 * barracksWithoutFlag, workFlag, ap, power, powerWarning, pollution, deliveries, protest,
 * depositRevealed, minePlacing. Edit a tip here; nothing else needs to change.
 */
export const ADVICE = Object.freeze([
    {
        id: 'build-hq',
        priority: 100,
        title: 'A NATION NEEDS A HEADQUARTERS!',
        text: 'Open BUILD, select HQ and place it on clear ground. Every glorious republic needs somewhere to begin!',
        book: 'Headquarters first',
        voice: 'papi_hq',
        when: (f) => f.deployment && !f.hqBuilt,
    },
    {
        id: 'low-power',
        priority: 95,
        urgent: true,
        title: 'THE REPUBLIC DEMANDS ELECTRICITY!',
        text: 'Some buildings require Power to operate. Build or restore Power Plants to keep your industry running.',
        book: 'Power',
        voice: 'papi_power',
        // Not while the placement warning about LOW POWER is up: that one already says it.
        when: (f) => f.hqBuilt && f.power !== 'normal' && !f.powerWarning,
    },
    {
        id: 'night-defence',
        priority: 90,
        title: 'THE NIGHT IS FULL OF OPPORTUNITIES!',
        text: 'Night brings hostile mutants. Prepare your defenses before ending deployment. Autocannons can help protect your Headquarters.',
        book: 'Cannons',
        voice: 'papi_defense',
        when: (f) => f.deployment && f.hqBuilt && f.defences === 0,
    },
    {
        id: 'ecologists',
        priority: 85,
        urgent: true,
        title: 'UNAUTHORIZED ENVIRONMENTAL CONCERNS!',
        text: 'Protesters can interfere with your logistics. Workers and Loudspeakers provide ways to deal with demonstrations.',
        book: 'Ecologists and Loudspeakers',
        voice: 'papi_ecologists',
        when: (f) => f.protest,
    },
    {
        id: 'workers',
        priority: 80,
        title: 'PUT THE PEOPLE TO WORK!',
        // Workers are HQ's squad: HQ is what the player selects, and SEND WORKERS sets the flag.
        text: 'Select HQ and press SEND WORKERS to set a work flag by the jungle. More clear ground means more room for industry!',
        book: 'Workers and the work flag',
        voice: 'papi_workers',
        when: (f) => f.activeDay && f.hqBuilt && !f.workFlag, // never in Day 0: workers cannot go out then
    },
    {
        id: 'logistics',
        priority: 70,
        title: 'PROSPERITY MUST BE DELIVERED!',
        text: 'Factories produce goods that must reach Headquarters by truck. Roads and working deliveries turn production into Credits.',
        book: 'Factories, roads and trucks',
        voice: 'papi_logistics',
        when: (f) => f.factories > 0 && f.deliveries === 0,
    },
    {
        id: 'action-points',
        priority: 65,
        title: 'EVEN PROGRESS HAS LIMITS!',
        text: 'Construction and orders consume Action Points. Your AP is restored at dawn, so plan your remaining actions carefully.',
        book: 'Credits and AP',
        voice: 'papi_ap',
        when: (f) => f.day && f.hqBuilt && f.ap === 0,
    },
    {
        id: 'barracks',
        priority: 60,
        title: 'THE FINEST ARMY IN THE WORLD!',
        text: 'Soldiers operate during Night. Set a defensive position for your Barracks and prepare for their deployment.',
        book: 'Barracks',
        voice: 'papi_barracks',
        commentary: 'OUR SOLDIERS ARE UNDERGOING ADVANCED MILITARY TRAINING! THEY ARE PLAYING COUNTRY STROKE!', // for the voice, later
        when: (f) => f.day && f.barracksWithoutFlag > 0,
    },
    {
        id: 'mining',
        priority: 55,
        title: 'THE EARTH OWES US MONEY!',
        // A Mine needs four cleared deposit tiles and a road at its bottom-side dock.
        text: "Mines extract resources from deposits. Clear the jungle over a deposit, and give the Mine's bottom-side dock a road to HQ.",
        book: 'The Mine',
        voice: 'papi_mining',
        when: (f) => f.day && f.mines === 0 && (f.depositRevealed || f.minePlacing),
    },
    {
        id: 'pollution',
        priority: 50,
        title: 'POLLUTION IS PROOF OF PROGRESS!',
        text: 'Industry generates pollution, and pollution can increase the danger facing San Papi. Expand carefully and prepare stronger defenses.',
        book: 'Pollution and Threat',
        voice: 'papi_pollution',
        when: (f) => f.day && f.pollution > 0,
    },
]);
