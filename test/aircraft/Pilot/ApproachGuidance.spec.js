import test from 'ava';
import { speech_say } from "../../../src/assets/scripts/client/speech";
import AircraftModel from '../../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftCommander from '../../../src/assets/scripts/client/aircraft/AircraftCommander';
import AircraftTypeDefinitionModel from '../../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../../src/assets/scripts/client/airport/AirportModel';
import { parseAirportDat } from '../../../src/assets/scripts/client/airport/dat/parseAirportDat';
import { buildDatScope, resolveWaypoints } from '../../../src/assets/scripts/client/airport/dat/buildDatScope';
import CommandParser from '../../../src/assets/scripts/client/commands/parsers/CommandParser';
import TimeKeeper from '../../../src/assets/scripts/client/engine/TimeKeeper';
import NavigationLibrary from '../../../src/assets/scripts/client/navigationLibrary/NavigationLibrary';
import a320 from '../../../assets/aircraft/a320.json';

test.serial('accepts RNAV and visual clearances, preserves a clearance after a bad command, and lands on a non-ILS runway', (t) => {
    const data = parseAirportDat([
        'RWY:RW18, , ,00010, , , , ;S37000000,E145000000,0000;',
        'RWY:RW36, , ,00010, , , , ;S37010000,E145000000,0000;'
    ].join('\n'), 'YTES.dat');
    const scope = buildDatScope(data, resolveWaypoints(data));
    const airport = new AirportModel(scope);
    airport.data = scope;
    AirportController.current = airport;
    const runway = airport.getRunway('18');
    const pointOnFinal = (distance) => runway.positionModel.generateCoordinatesFromBearingAndDistance(runway.oppositeAngle, distance);
    scope.rnavApproaches = [{
        id: 'R18', runway: '18', points: [
            { name: 'ENTRY', coordinates: pointOnFinal(15), altitude: 4000 },
            { name: 'FAFIX', coordinates: pointOnFinal(7), altitude: 2200 },
            { name: 'RW18', coordinates: runway.positionModel.gps }
        ]
    }];
    NavigationLibrary.init(scope);
    const commander = new AircraftCommander();
    const frameTime = TimeKeeper.getDeltaTimeForGameStateAndTimewarp;
    TimeKeeper.getDeltaTimeForGameStateAndTimewarp = () => 1;
    try {
        for (const clearance of ['rnav entry 18', 'vis 18', 'vis 36']) {
            const aircraft = new AircraftModel({
                airline: 'jst', callsign: '123', airlineCallsign: 'jetstar', category: 'arrival', origin: '', destination: 'YTES',
                altitude: 4500, speed: 200, heading: runway.angle,
                model: new AircraftTypeDefinitionModel(a320), routeString: '_SIMIN.._SIMFINAL',
                positionModel: runway.positionModel.generateDynamicPositionFromBearingAndDistance(runway.oppositeAngle + 0.8, 24)
            });
            aircraft.trueAirspeed = aircraft.speed;
            const transmit = (command) => {
                const [name, ...args] = new CommandParser(`jst123 ${command}`).parse().args[0];
                return commander.run(aircraft, name, args);
            };
            t.true(transmit(clearance)[0]);
            const guidance = aircraft.pilot.approachGuidance;
            t.false(transmit('rnav missing 18')[0]);
            t.is(aircraft.pilot.approachGuidance, guidance);
            t.true(transmit('h 270')[0]);
            t.is(aircraft.pilot.approachGuidance, null);
            t.true(transmit(clearance)[0]);
            for (let i = 0; i < 1800 && !aircraft.isOnGround(); i++) {
                aircraft.updateFlightPhase();
                aircraft.updateTarget();
                aircraft.updatePhysics();
            }
            t.is(aircraft.flightPhase, 'LANDING');
            t.true(aircraft.isOnGround());
            const assignedRunway = airport.getRunway(clearance.split(' ').pop());
            t.true(aircraft.positionModel.distanceToPosition(assignedRunway.positionModel) < 0.2);
        }
    } finally {
        TimeKeeper.getDeltaTimeForGameStateAndTimewarp = frameTime;
        airport.releaseWindListener();
        NavigationLibrary.reset();
        AirportController.reset();
    }
});

test.serial('sends ar nav and phonetic registrations to the speech synthesizer', (t) => {
    const previousSpeech = prop.speech;
    const previousUtterance = global.SpeechSynthesisUtterance;
    let text;
    global.SpeechSynthesisUtterance = class {
        constructor(words) { this.text = words; }
    };
    prop.speech = { enabled: true, synthesis: { getVoices: () => [], speak: (utterance) => { text = utterance.text; } } };
    try {
        const plane = Object.assign(Object.create(AircraftModel.prototype), {
            airlineId: 'vh', flightNumber: 'ABC', model: { getRadioWeightClass: () => '' }
        });
        speech_say([{ type: 'callsign', content: plane }, { type: 'text', content: 'cleared RNAV approach' }], {});
        t.regex(text, /alpha bravo charlie\s+cleared ar nav approach/);
    } finally {
        prop.speech = previousSpeech;
        global.SpeechSynthesisUtterance = previousUtterance;
    }
});
