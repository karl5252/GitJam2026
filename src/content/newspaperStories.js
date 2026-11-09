/**
 * TASK 034: LA VOZ DE SAN PAPI's editorial stories, as data. Pure: no Phaser, no clock,
 * no randomness. src/content/newspaper.js chooses from them; NewspaperLayer draws.
 *
 * The paper is the government's. El Presidente is always right, every decree is a
 * historic success, and the evidence is reported without comment. The decrees concern
 * the rest of the Republic: they are news, never orders to the player.
 *
 * LEADS     the front page: one per issue, in this order, round again after the last.
 *           The order is the joke's continuity: the artillery is dismantled before it
 *           is restored, and the paper never mentions either afterwards.
 *           headline, subhead (one line on a phone), body (the desktop story) and brief
 *           (the phone's: about four short lines, its own last sentence the punchline).
 * COLUMNS   the desktop's three short columns (a phone has none): world news, rotating,
 *           and, every other issue, at most one about something that really happened
 *           at the player's outpost last Night, chosen only when `when(facts)` holds.
 *           Facts are the settlement report's: power, pollution, threat, counts, delivered.
 *
 * Fit: a lead's subhead stays within about 43 characters, its brief within four lines of
 * 43, its body within six of 74; a column's headline within 18 characters (about 240 px) and its
 * body within four lines of 30. tests/unit/newspaper.test.js checks each with fitLines,
 * and tests/e2e/newspaper.spec.js measures every issue as drawn.
 */

const DECREE = 'DECRETO PRESIDENCIAL';

export const LEADS = Object.freeze([
    {
        id: 'maintenance-ban',
        kicker: DECREE,
        headline: 'NATIONAL MAINTENANCE BAN A RESOUNDING SUCCESS!',
        subhead: 'Repair spending falls to historic lows',
        body: 'The Ministry of Industrial Excellence reports that maintenance expenditure has fallen to historic lows since El Presidente suspended all repairs for two nights. Several remote facilities exceeded their savings targets by more than 400%. Communication with these facilities has not yet been restored. The Presidential Office considers the program a complete success.',
        brief: 'Remote facilities exceeded their savings targets by 400%. Communication with them has not yet been restored.',
    },
    {
        id: 'artillery-conservation',
        kicker: DECREE,
        headline: 'ARTILLERY CONSERVATION ACT: CANNONS AT REST',
        subhead: 'Siege Cannons switched off for two nights',
        body: 'Under the Artillery Conservation Act, every Siege Cannon in the Republic was switched off for two nights to extend its service life. The Ministry of Defence reports that not a single shell was wasted. Wear on barrels fell by one hundred per cent. The Eastern Garrison has asked for a meeting, which has been scheduled for the third night.',
        brief: 'Every Siege Cannon rested for two nights, and not one shell was wasted. The Eastern Garrison will be seen on the third night.',
    },
    {
        id: 'great-disarmament',
        kicker: DECREE,
        headline: 'ALL ARTILLERY DISMANTLED! REPUBLIC SAFER THAN EVER!',
        subhead: 'The Great Disarmament Initiative is done',
        body: 'The government announces a historic reduction in military spending following the nationwide dismantling of defensive artillery. Military officials report unprecedented savings in ammunition, fuel and maintenance. Provincial governors have praised the quiet nights. The Ministry of Defence declined to comment on the current location of the Eastern Garrison.',
        brief: 'Defensive artillery has been dismantled, with record savings. The Ministry of Defence declined to say where the Eastern Garrison is.',
    },
    {
        id: 'military-parade',
        kicker: DECREE,
        headline: 'SOLDIERS RECALLED FOR GLORIOUS PARADE!',
        subhead: "The largest march in San Papi's history",
        body: "Thousands of soldiers have been recalled from industrial outposts to take part in the largest military parade in San Papi's history. The route passed the Presidential Palace eleven times. The Minister of Defence confirms that the nation's remaining defensive positions are operating with significantly improved personnel efficiency. Some positions now require no personnel whatsoever.",
        brief: 'Soldiers were recalled from the outposts for the largest parade in history. Some positions now require no personnel whatsoever.',
    },
    {
        id: 'green-revolution',
        kicker: DECREE,
        headline: 'THE GREAT GREEN REVOLUTION BEGINS',
        subhead: 'Deforestation quotas raised by 400%',
        body: 'El Presidente has launched the Great Green Revolution, raising the deforestation quota of every industrial facility by 400%. The Ministry of National Prosperity explains that the revolution is green because the jungle is green, and there is a great deal of it. The Southern Agricultural Collective has already met its quota, and cleared most of its farmland.',
        brief: 'Deforestation quotas are up by 400%. The Southern Agricultural Collective has met its quota, and cleared most of its farmland.',
    },
    {
        id: 'power-conservation',
        kicker: DECREE,
        headline: 'NATIONAL POWER CONSERVATION PROGRAM LAUNCHED',
        subhead: 'Less electricity and more output, by decree',
        body: 'Factories across the Republic have been ordered to halve their electricity use while doubling their output. The Ministry of Industrial Excellence reports full compliance in the Northern Industrial District, where consumption has fallen to zero. Output figures will be published as soon as the lights are back on.',
        brief: 'Factories must use half the power for twice the output. Figures will be published as soon as the lights are back on.',
    },
    {
        id: 'presidential-efficiency',
        kicker: DECREE,
        headline: 'PRESIDENTIAL EFFICIENCY ACT ENDS WASTE',
        subhead: 'All reports now required in triplicate',
        body: 'To eliminate administrative waste, El Presidente has decreed that every report be completed in triplicate before any work may begin. The Ministry of Information has received a record number of reports. Each one confirms that no work has been wasted. Paper mills in the north are now working three shifts.',
        brief: 'Every report must be completed in triplicate before work begins. Each one confirms that no work has been wasted.',
    },
    {
        id: 'banana-ketchup',
        kicker: 'COMERCIO NACIONAL',
        headline: 'EL PAPI BANANA KETCHUP NAMED EXPORT OF THE YEAR!',
        subhead: 'Approved personally by El Presidente',
        body: 'The Ministry of Commerce has declared EL PAPI™ Banana Ketchup the Republic\'s most prestigious export. El Presidente Colonel Papi personally approved the recipe, packaging, pricing and results of the national taste test. Official inspectors described the product as "MUY DELICIOSO!" Independent testing was postponed due to a shortage of independent inspectors.',
        brief: 'Official inspectors called it "MUY DELICIOSO!" Independent testing was postponed for want of independent inspectors.',
    },
    {
        id: 'industrial-excellence',
        kicker: DECREE,
        headline: 'EVERY OUTPOST TO EXPAND PRODUCTION AT ONCE',
        subhead: 'The Industrial Excellence Decree',
        body: 'Under the Industrial Excellence Decree, every outpost in the Republic must expand production immediately, regardless of available resources. Governors who reported a shortage of resources have been reminded that shortages are a state of mind. The Northern Industrial District has already doubled its production of reports about production.',
        brief: 'Every outpost must expand production, whatever its resources. The north has doubled its output of reports about production.',
    },
    {
        id: 'defense-restoration',
        kicker: DECREE,
        headline: 'ARTILLERY RETURNS! NATION DEFENDED AS NEVER BEFORE',
        subhead: 'The National Defense Restoration Plan',
        body: "Every facility in the Republic has been ordered to build new artillery at once under the National Defense Restoration Plan. The Ministry of Defence describes the plan as the natural next step in El Presidente's long-term strategy. Construction is proceeding rapidly on the sites where the old cannons stood. The Eastern Garrison is invited to report for duty.",
        brief: 'Every facility must build new artillery, on the very sites where the old cannons stood. The Eastern Garrison is invited to report for duty.',
    },
    {
        id: 'economic-acceleration',
        kicker: DECREE,
        headline: 'QUOTAS DOUBLED IN GREAT ECONOMIC ACCELERATION',
        subhead: 'Production up, transport cut for speed',
        body: 'The Great Economic Acceleration has doubled every production quota in the Republic while reducing transport to save fuel. The Ministry of National Prosperity reports that warehouses have never been so full. Deliveries to the capital will resume once the warehouses have been emptied by hand.',
        brief: 'Quotas are doubled and transport is cut to save fuel. Deliveries will resume once the warehouses are emptied by hand.',
    },
]);

/** World news from the rest of the Republic, rotating. */
export const WORLD_COLUMNS = Object.freeze([
    {id: 'banana-harvest', headline: 'BANANA CROP RECORD', body: 'Remote plantations report a record harvest. It will be counted when the counters return.'},
    {id: 'governor-promoted', headline: 'GOVERNOR PROMOTED', body: 'The Governor of the North is promoted for reporting no problems. His reports continue.'},
    {id: 'new-ministry', headline: 'NEW MINISTRY OPENS', body: 'The Ministry of Ministries opened today. Its first task is to find the Ministry of Defence.'},
    {id: 'weather', headline: 'OFFICIAL WEATHER', body: 'Tomorrow will be sunny by Presidential decree. Citizens are asked not to look up.'},
    {id: 'letters', headline: 'LETTERS PAGE', body: 'Every letter this week agreed with El Presidente. The others were lost in the post.'},
]);

/**
 * Columns about something that really happened at the player's outpost last Night, so a
 * story is true whenever it runs. Facts: {power, emitted, threat, producers, delivered}.
 */
export const CONTEXT_COLUMNS = Object.freeze([
    {id: 'grid-thrift', when: (f) => f.power !== 'normal', headline: 'THRIFT ON THE GRID', body: 'An outpost ran short of power last night. The Ministry calls it a model of thrift.'},
    {id: 'rich-air', when: (f) => f.emitted >= 20, headline: 'AIR RICHER STILL', body: 'Industry gave the air a fuller flavour last night. Citizens may breathe in moderation.'},
    {id: 'patient-trucks', when: (f) => f.producers > 0 && f.delivered === 0, headline: 'PATIENT TRUCKS', body: 'An outpost delivered no goods last night. Officials praise its sense of restraint.'},
    {id: 'night-visitors', when: (f) => f.threat >= 3, headline: 'NIGHT VISITORS UP', body: 'Outposts report record numbers of night visitors. The Ministry of Tourism is delighted.'},
]);

/** The desktop's small box: a government notice, never an advertisement. */
export const NOTICE = Object.freeze({
    headline: 'PUBLIC NOTICE',
    body: 'Complaints are accepted in triplicate only.',
});
