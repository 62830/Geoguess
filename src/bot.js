// path: Geoguess/src/bot.js

import { GAME_MODE } from './constants';
import 'firebase/database';
import { getScore } from './utils/game/score';
import { getSelectedPos, getAreaCodeNameFromLatLng } from './utils';
const MaxBotCount = 10;
let mode = null;
let room = null;

// Store references to Vue component instances
let streetViewComponentInstance = null;
let botCount = 0;
let botPoints = new Array(MaxBotCount).fill(0); // points
let botScore = new Array(MaxBotCount).fill(0); // distance
let botfinalPoints = new Array(MaxBotCount).fill(0); // points
let botfinalScore = new Array(MaxBotCount).fill(0); // distance
let botGuess = new Array(MaxBotCount).fill(null); // guess
let RoundAnswer = null;

export function registerStreetViewComponent(instance) {
    streetViewComponentInstance = instance;
    if (instance) {
        console.log('Bot: StreetView.vue component registered successfully.');
    } else {
        console.log('Bot: StreetView.vue component unregistered.');
    }
}

export function setBotCount(Count) {
    botCount = Count;
    console.log('Bot: Count set to ', botCount);
}

export function getBotCount() {
    return botCount;
}

export async function setRoundAnswer(RoundLatLng) {
    RoundAnswer = RoundLatLng;
    console.log('Bot: RoundAnswer set to ', RoundAnswer);
    await botSelectRandomLocationOnMap();
    console.log('Bot: Random Answers done');
    return;
}

export function getBotInfo(botIndex) {
    console.log('Bot', botIndex, ': Info given');
    return {
        finalPoints: botfinalPoints[botIndex],
        finalScore: botfinalScore[botIndex],
    };
}

// --- Methods in bot.js that can be CALLED BY Vue components ---

/**
 * Generic function for Vue components to send information or events to the bot.
 * @param {string} eventType - A string describing the event (e.g., "mapLoaded", "userAction").
 * @param {any} [payload] - Optional data associated with the event.
 * @returns {string} A confirmation or response from the bot.
 */
export function notifyBot(eventType, payload) {
    console.log(`Bot: Received notification from Vue component. Type: "${eventType}", Payload:`, payload);
}

/**
 * Instructs the Maps.vue component to select a random location.
 * This typically calls the `selectRandomLocation` method in Maps.vue.
 * @param {object} randomLatLng - The LatLng object (e.g., from Google Maps API) for the random location.
 */
export async function botSelectRandomLocationOnMap() {
    if (!streetViewComponentInstance) {
        console.log('Bot: Cannot determine guess. Maps.vue or StreetView.vue instance not registered.');
        return;
    }
    else {
        mode = streetViewComponentInstance.mode;
        room = streetViewComponentInstance.room;
    }
    for(let i = 0; i < botCount; i++){
        // repeat for every bot
        const randomPoint = streetViewComponentInstance.streetViewService.getRandomLatLng().position;
        // make a guess
        if ([GAME_MODE.COUNTRY, GAME_MODE.CUSTOM_AREA].includes(mode)) {
            // area
            const areaPath =
                mode === GAME_MODE.CUSTOM_AREA && streetViewComponentInstance.areaParams?.data?.pathKey
                    ? streetViewComponentInstance.areaParams.data.pathKey
                    : 'address.country_code';

            try {
                botGuess[i] = await getAreaCodeNameFromLatLng(randomPoint, {
                    nominatimResultPath: areaPath,
                });

                if (!botGuess[i]) {
                    console.log('Bot', i, ': Could not resolve area from location, setting null.');
                }
            } catch (err) {
                console.error('Bot', i, ': Failed to fetch area from coordinates:', err);
                botGuess[i] = null;
            }
        }
        else {
            // location
            botGuess[i] = randomPoint;
        }
        
        console.log('Bot', i, ': Triggering random location selection on map with:', botGuess[i]);

        // time need adjustment
        const timePassed = 3000000;

        // calculate score
        if (
            [GAME_MODE.COUNTRY, GAME_MODE.CUSTOM_AREA].includes(mode)
        ) {
            botPoints[i] = +(streetViewComponentInstance.area === botGuess[i]);
            botScore[i] = null;
        } else {
            botScore[i] = Math.floor(
                google.maps.geometry.spherical.computeDistanceBetween(
                    RoundAnswer,
                    botGuess[i]
                )
            );

            botPoints[i] = getScore(
                botScore[i],
                streetViewComponentInstance.difficulty,
                timePassed,
                streetViewComponentInstance.scoreMode
            );
        }
        // Update the score
        botfinalPoints[i] += botPoints[i];
        botfinalScore[i] += botScore[i];

        try {
            await Promise.all([
                room.child(`finalScore/bot${i + 1}`).set(botfinalScore[i]),
                room.child(`finalPoints/bot${i + 1}`).set(botfinalPoints[i]),
                room.child(`round${streetViewComponentInstance.round}/bot${i + 1}`).set({
                    ...getSelectedPos(botGuess[i], mode),
                    distance: botScore[i],
                    points: botPoints[i],
                    timePassed
                }),
                room.child(`botguess/bot${i + 1}`).set(getSelectedPos(botGuess[i], mode))
            ]);
        } catch (err) {
            console.error(`Bot ${i}: Firebase update failed`, err);
        }
    }
    return;
}