// path: Geoguess/src/bot.js
/* eslint-disable */
import { GAME_MODE } from './constants';
import 'firebase/database';
import { getScore } from './utils/game/score';
import { getSelectedPos, getAreaCodeNameFromLatLng } from './utils';
import { COUNTRIES_MEDALS_DATA } from './utils/game/medals';
import { GoogleGenAI } from "@google/genai";
export const MaxBotCount = 5;
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


function initbot() {
    streetViewComponentInstance = null;
    botPoints = new Array(MaxBotCount).fill(0); // points
    botScore = new Array(MaxBotCount).fill(0); // distance
    botfinalPoints = new Array(MaxBotCount).fill(0); // points
    botfinalScore = new Array(MaxBotCount).fill(0); // distance
    botGuess = new Array(MaxBotCount).fill(null); // guess
    RoundAnswer = null;
}

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
    initbot();
    console.log('Bot: Count set to ', botCount);
}

export function getBotCount() {
    return botCount;
}

export async function setRoundAnswer(RoundLatLng) {
    RoundAnswer = RoundLatLng;
    console.log('Bot: RoundAnswer set to ', RoundAnswer);
    await geminiSelectLocationOnMap();
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

function getRandomCountryCode() {
  const randomIndex = Math.floor(Math.random() * COUNTRIES_MEDALS_DATA.length);
  return COUNTRIES_MEDALS_DATA[randomIndex].iso_a2;
}


function _arrayBufferToBase64( buffer ) {
    var binary = '';
    var bytes = new Uint8Array( buffer );
    var len = bytes.byteLength;
    for (var i = 0; i < len; i++) {
        binary += String.fromCharCode( bytes[ i ] );
    }
    return window.btoa( binary );
}

function getRandomArbitrary(min, max) {
    return Math.random() * (max - min) + min;
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
        console.log("the randomPoint->",randomPoint);
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
                    // random country to gurantee a guess
                    botGuess[i] = getRandomCountryCode();
                    console.log('Bot', i, ': Could not resolve area from location, setting null.');
                }
            } catch (err) {
                console.error('Bot', i, ': Failed to fetch area from coordinates:', err);
                botGuess[i] = null;
            }
            botGuess[i] = botGuess[i].toUpperCase();
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

export async function geminiSelectLocationOnMap() {
    if (!streetViewComponentInstance) {
        console.log('Bot: Cannot determine guess. Maps.vue or StreetView.vue instance not registered.');
        return;
    }
    else {
        mode = streetViewComponentInstance.mode;
        room = streetViewComponentInstance.room;
    }
    // Fetch the API key from environment variables
    const mapApiKey = process.env.VUE_APP_API_KEY;
    const geminiApiKey = process.env.VUE_APP_GEMINI_API_KEY;
    const geminiPrompt = process.env.VUE_APP_GEMINI_PROMPT;

    // get the base64 image
    const lat = RoundAnswer.lat();
    const lng = RoundAnswer.lng();
    console.log("lat: ",lat, "lng: ", lng);

    const response = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${lat},${lng}&key=${mapApiKey}`);
    const imageArrayBuffer = await response.arrayBuffer();
    const base64Image = _arrayBufferToBase64(imageArrayBuffer);
    
    //genai testing 
    console.log("prompt: ",geminiPrompt);
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const genaiResponse = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [
            {
              inlineData: {
                mimeType: 'image/jpeg',
                data: base64Image,
              },
            },
            { text: geminiPrompt }
          ],
    });
    console.log("the response->",genaiResponse.text);
    let res_lat = parseFloat(genaiResponse.text?.split("(")[1]?.split(",")[0] || "200");
    let res_lng = parseFloat(genaiResponse.text?.split("(")[1]?.split(",")[1]?.split(")")[0] || "200");
    if(res_lat > 90 || res_lat < -90){
        console.log("the latitude is out of range, using random");
        res_lat = getRandomArbitrary(-90, 90);
    }
    if(res_lng > 180 || res_lng < -180){
        console.log("the longtitude is out of range, using random");
        res_lat = getRandomArbitrary(-180, 180);
    }
    console.log("the res_lat->",res_lat);
    console.log("the res_lng->",res_lng);
    // note: gemini response

    for(let i = 0; i < botCount; i++){
        // repeat for every bot
        // random within -10,10
        let point = null
        if (i == 0) {
            point = new google.maps.LatLng(res_lat, res_lng);
            console.log("using gemini for bot 1->");
        }
        else {
            point = streetViewComponentInstance.streetViewService.getRandomLatLng().position;
        }
        // make a guess
        if ([GAME_MODE.COUNTRY, GAME_MODE.CUSTOM_AREA].includes(mode)) {
            // area
            const areaPath =
                mode === GAME_MODE.CUSTOM_AREA && streetViewComponentInstance.areaParams?.data?.pathKey
                    ? streetViewComponentInstance.areaParams.data.pathKey
                    : 'address.country_code';

            try {
                botGuess[i] = await getAreaCodeNameFromLatLng(point, {
                    nominatimResultPath: areaPath,
                });

                if (!botGuess[i]) {
                    // random country to gurantee a guess
                    botGuess[i] = getRandomCountryCode();
                    console.log('Bot', i, ': Could not resolve area from location, setting null.');
                }
            } catch (err) {
                console.error('Bot', i, ': Failed to fetch area from coordinates:', err);
                botGuess[i] = null;
            }
            botGuess[i] = botGuess[i].toUpperCase();
        }
        else {
            // location
            botGuess[i] = point;
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