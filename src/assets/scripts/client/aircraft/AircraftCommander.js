import _has from 'lodash/has';
import _isNil from 'lodash/isNil';
import _map from 'lodash/map';
import _round from 'lodash/round';
import { clearOrbit } from './Pilot/VfrArrival';
import TimeKeeper from '../engine/TimeKeeper';
import AirportController from '../airport/AirportController';
import EventBus from '../lib/EventBus';
import GameController from '../game/GameController';
import NavigationLibrary from '../navigationLibrary/NavigationLibrary';
import UiController from '../ui/UiController';
import { MCP_MODE } from './ModeControl/modeControlConstants';
import {
    FLIGHT_PHASE,
    FLIGHT_RULES
} from '../constants/aircraftConstants';
import {
    CONTROLLER_TYPE,
    HANDOFF_STATE,
    frequenciesEqual,
    isAustralianAirport,
    normalizeFrequency
} from '../constants/controllerConstants';
import { AIRCRAFT_EVENT, EVENT } from '../constants/eventNames';
import { radians_normalize } from '../math/circle';
import { round } from '../math/core';
import { AIRCRAFT_COMMAND_MAP } from '../commands/aircraftCommand/aircraftCommandMap';
import { speech_say } from '../speech';
import {
    radio_runway,
    radio_spellOut,
    radio_heading,
    radio_altitude,
    radio_frequencySpoken,
    radio_squawkSpoken,
    radio_speedSpoken,
    radio_spokenText
} from '../utilities/radioUtilities';
import { heading_to_string, radiansToDegrees, degreesToRadians } from '../utilities/unitConverters';

/**
 *
 *
 * @class AircraftCommander
 */
export default class AircraftCommander {
    constructor(onChangeTransponderCode, findAircraftById) {
        this._eventBus = EventBus;
        this._findAircraftById = findAircraftById;
        this._onChangeTransponderCode = onChangeTransponderCode;
    }

    /**
     * @for AircraftCommander
     * @method runCommands
     * @param aircraft {AircraftModel}
     * @param commands {array<AircraftCommandParser>}
     * @param isPreSpawn {boolean}
     */
    runCommands(aircraft, commands, isPreSpawn = false) {
        if (!isPreSpawn && !aircraft.isPlayerControlled()) {
            if (aircraft.isAustralianOperation && aircraft.isAustralianOperation()) {
                const reason = this._getOwnershipRejectionReason(aircraft);
                UiController.ui_log(`${aircraft.readbackCallsign}, unable — ${reason}`, true);
                return false;
            }

            return true;
        }

        let response = [];
        let response_end = '';
        let redResponse = false;
        const deferred = [];

        for (let i = 0; i < commands.length; i++) {
            const command = commands[i][0];
            const args = commands[i].splice(1);

            if (command === FLIGHT_PHASE.TAKEOFF) {
                deferred.push([command, args]);

                continue;
            }

            const wasTransferredToCentre = aircraft.transferredToCentre;
            let retval = this.run(aircraft, command, args);

            // A successful legacy `centre` handoff produces its radio call via AIRSPACE_EXIT.
            if (command === 'centre' && !wasTransferredToCentre && aircraft.transferredToCentre) {
                break;
            }

            if (retval) {
                if (!retval[0]) {
                    redResponse = true;
                }

                if (!_has(retval[1], 'log') || !_has(retval[1], 'say')) {
                    // TODO: reassigning a value using itself is dangerous. this should be re-wroked
                    retval = [
                        retval[0],
                        {
                            log: retval[1],
                            say: retval[1]
                        }
                    ];
                }

                response.push(retval[1]);

                if (retval[2]) {
                    // eslint-disable-next-line prefer-destructuring
                    response_end = retval[2];
                }
            }

            if (aircraft.transferredToCentre || !aircraft.isPlayerControlled()) {
                break;
            }
        }

        for (let i = 0; i < deferred.length && !aircraft.transferredToCentre && aircraft.isPlayerControlled(); i += 1) {
            const command = deferred[i][0];
            const args = deferred[i][1];
            const retval = this.run(aircraft, command, args);

            if (retval) {
                if (!retval[0]) {
                    redResponse = true;
                }
                // TODO: fix the logic here this very purposly using `!=`. length is not an object and thus,
                // never null but by using coercion it evaluates to falsey if its not an array
                // true if array, and not log/say object
                if (retval[1].length != null) {
                    // make into log/say object
                    retval[1] = {
                        say: retval[1],
                        log: retval[1]
                    };
                }

                response.push(retval[1]);
            }
        }

        if (isPreSpawn) {
            return true;
        }

        if (commands.length === 0) {
            response = [{
                say: 'say again',
                log: 'say again'
            }];
        }

        if (response.length >= 1) {
            if (response_end) {
                response_end = `, ${response_end}`;
            }

            const r_log = _map(response, (r) => r.log).join(', ');
            const r_say = _map(response, (r) => r.say).join(', ');

            UiController.ui_log(`${aircraft.readbackCallsign}, ${r_log} ${response_end}`, redResponse);
            speech_say(
                [
                    { type: 'callsign', content: aircraft },
                    { type: 'text', content: ` ${radio_spokenText(`${r_say} ${response_end}`)}` }
                ],
                aircraft.pilotVoice
            );
        }

        return true;
    }

    /**
     * @for AircraftCommander
     * @method run
     * @param aircraft {AircraftModel}
     * @param command {string}
     * @param data {array}
     * @return {function}
     */
    run(aircraft, command, data) {
        const { functionName } = AIRCRAFT_COMMAND_MAP[command];

        if (typeof functionName === 'undefined') {
            return [false, 'say again?'];
        }

        if (functionName === 'runCircuit') {
            if (aircraft.rules !== 'vfr' || !/^Y/i.test(AirportController.current.icao)) return [false, 'VFR arrivals only'];
            return aircraft.pilot.joinApproach(aircraft, data[0], null, command, data[1]);
        }
        const result = this[functionName](aircraft, data);
        if (result && result[0] && aircraft.rules === FLIGHT_RULES.VFR) aircraft.nextOctaCheck = 0;
        // Successful lateral clearances supersede the approach. Preserve any
        // new LNAV mode selected by the command.
        if (result && result[0] && aircraft.pilot && aircraft.pilot.approachGuidance &&
            ['direct', 'hold', 'reroute', 'expectArrivalRunway', 'descendViaStar'].includes(command)) {
            const lnav = aircraft.mcp.headingMode === MCP_MODE.HEADING.LNAV;
            const vnav = aircraft.mcp.altitudeMode === MCP_MODE.ALTITUDE.VNAV;
            const { altitude } = aircraft.mcp;
            aircraft.pilot.cancelApproachClearance(aircraft);
            if (lnav) aircraft.mcp.setHeadingLnav();
            if (vnav) {
                aircraft.mcp.setAltitudeFieldValue(altitude);
                aircraft.mcp.setAltitudeVnav();
            }
        }
        return result;
    }

    /**
     * Aborts an action. Deprecated.
     *
     * @for AircraftCommander
     * @method runAbort
     * @return {array} [success of operation, readback]
     */
    runAbort() {
        return [false, "the 'abort' command has been deprecated, please see documentation for help"];
    }

    /**
     * Set the aircraft to maintain an assigned altitude, and provide a readback
     *
     * @for AircraftCommander
     * @method runAltitude
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array}  [success of operation, readback]
     */
    runAltitude(aircraft, data) {
        const altitudeRequested = data[0];
        const expediteRequested = data[1];
        const shouldUseSoftCeiling = GameController.game.option.getOptionByName('softCeiling') === 'yes';
        const airport = AirportController.airport_get();

        return aircraft.pilot.maintainAltitude(
            altitudeRequested,
            expediteRequested,
            shouldUseSoftCeiling,
            airport,
            aircraft
        );
    }

    /**
     * Direct an aircraft to fly and maintain a specific heading
     *
     * @for AircraftCommander
     * @method runHeading
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, readback]
     */
    runHeading(aircraft, data) {
        let direction = data[0];
        const heading = data[1];
        const incremental = data[2];
        const readback = aircraft.pilot.maintainHeading(aircraft, heading, direction, incremental);

        if (!direction) {
            direction = '';
        }

        aircraft.target.turn = direction;

        if (aircraft.hasApproachClearance) {
            aircraft.pilot.cancelApproachClearance(aircraft);
        }

        return readback;
    }

    /**
     * Activate the flightplan stored in the FMS
     *
     * @for AircraftCommander
     * @method runClearedAsFiled
     * @param aircraft {AircraftModel}
     * @return {array} [success of operation, readback]
     */
    runClearedAsFiled(aircraft) {
        return aircraft.pilot.clearedAsFiled();
    }

    /**
     * @for AircraftCommander
     * @method runClimbViaSID
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, readback]
     */
    runClimbViaSID(aircraft, data) {
        const altitude = data[0];

        return aircraft.pilot.climbViaSid(aircraft, altitude);
    }

    /**
     * @for AircraftCommander
     * @method runCross
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, readback]
     */
    runCross(aircraft, data) {
        const fix = data[0].toUpperCase();
        const altitude = data[1];
        const speed = data[2];

        return aircraft.pilot.crossFix(aircraft, fix, altitude, speed);
    }

    /**
     * @for AircraftCommander
     * @method runDescendViaStar
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, readback]
     */
    runDescendViaStar(aircraft, data = []) {
        const altitude = data[0];

        return aircraft.pilot.descendViaStar(aircraft, altitude);
    }

    /**
     * @for AircraftCommander
     * @method runSpeed
     * @param aircraft {AircraftModel}
     * @param data {array}
     */
    runSpeed(aircraft, data) {
        const nextSpeed = data[0];

        return aircraft.pilot.maintainSpeed(nextSpeed, aircraft);
    }

    /**
     * Setup the Fms to enter a holding pattern,
     *
     * Can be used to hold at:
     * - A Waypoint in the current flight plan: which will be made the currentWaypoint via `fms.skipToWaypointName()`
     * - A Fix not in the flight plan: a new `LegModel` will be created and prepended thus making it the currentWaypoint
     * - The current position: a new `LegModel` will be created and prepended thus making it the currentWaypoint
     *
     * @for AircraftCommander
     * @method runHold
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, readback]
     */
    runHold(aircraft, data) {
        const [turnDirection, legLength, fixName, radial] = data;

        if (!fixName) {
            return [false, 'unable to hold over present position, we can only hold over fixes'];
        }

        const fixModel = NavigationLibrary.findFixByName(fixName);

        if (!fixModel) {
            return [false, `unable to hold at unknown fix ${fixName}`];
        }

        const holdParameters = {};
        let fallbackInboundHeading;

        // Instead of using DEFAULT_HOLD_PARAMETERS here, we only pass the values
        // provided by the player. These then are used to patch the _holdParameters as
        // specified in the `WaypointModel`
        if (turnDirection !== null) {
            holdParameters.turnDirection = turnDirection;
        }

        if (legLength !== null) {
            holdParameters.legLength = legLength;
        }

        if (radial !== null) {
            // Radial is given as the outbound course, so it needs to be inverted
            holdParameters.inboundHeading = radians_normalize(degreesToRadians(radial) + Math.PI);
        } else {
            // As radial has not been explicitly requested, we need to pass a "fallback"
            // inboundHeading, as it's possible that a default inboundHeading doesn't exist for
            // the `WaypointModel`s _holdParameters (eg. if the procedure JSON has no holds)
            fallbackInboundHeading = fixModel.positionModel.bearingFromPosition(aircraft.positionModel);
        }

        const readback = aircraft.pilot.initiateHoldingPattern(fixName, holdParameters, fallbackInboundHeading);

        if (readback[0] && aircraft.vfrOrbit) {
            aircraft.vfrOrbit = null;
            aircraft.mcp.setHeadingLnav();
        }

        return readback;
    }

    /**
     * Exit holding pattern and resume navigation
     *
     * @for AircraftCommander
     * @method runCancelHoldingPattern
     * @param aircraft {AircraftModel}
     * @param args {array}
     * @return {array} [success of operation, readback]
     */
    runCancelHoldingPattern(aircraft, args) {
        const fixName = args[0];

        return aircraft.pilot.cancelHoldingPattern(fixName);
    }

    /**
     * Skip forward to a particular fix that already exists further along the aircraft's route
     *
     * @for AircraftCommander
     * @method runDirect
     * @param data
     */
    runDirect(aircraft, data) {
        // TODO: maybe handle with parser?
        const fixName = data[0].toUpperCase();

        aircraft.target.turn = null;

        return aircraft.pilot.proceedDirect(fixName, aircraft);
    }

    /**
     * Set the arrival runway to expect for approach and landing
     *
     * @for AircraftCommander
     * @method runExpectArrivalRunway
     * @param aircraft {AircraftModel}
     * @param data {array}
     * @return {array} [success of operation, response]
     */
    runExpectArrivalRunway(aircraft, data) {
        const airportModel = AirportController.airport_get();
        const runwayName = data[0];
        const runwayModel = airportModel.getRunway(runwayName);

        if (_isNil(runwayModel)) {
            const previousRunwayModel = aircraft.fms.arrivalRunwayModel;
            const readback = {};
            readback.log = `unable to find Runway ${runwayName} on our charts, ` +
                `expecting Runway ${previousRunwayModel.name} instead`;
            readback.say = `unable to find Runway ${radio_runway(runwayName)} on our ` +
                `charts, expecting Runway ${previousRunwayModel.getRadioName()} instead`;

            return [false, readback];
        }

        return aircraft.pilot.updateStarLegForArrivalRunway(aircraft, runwayModel);
    }

    /**
     * @for AircraftCommander
     * @method runFlyPresentHeading
     * @param aircraft {AircraftModel}
     */
    runFlyPresentHeading(aircraft) {
        if (aircraft.flightPhase === FLIGHT_PHASE.APRON) {
            return [false, 'we\'re still at the gate'];
        }

        if (aircraft.flightPhase === FLIGHT_PHASE.TAXI) {
            const runway = aircraft.fms.departureRunwayModel;
            const readback = {};
            readback.log = `we're still taxiing to Runway ${runway.name}`;
            readback.say = `we're still taxiing to Runway ${radio_runway(runway.name)}`;

            return [false, readback];
        }

        return aircraft.pilot.maintainPresentHeading(aircraft);
    }

    /**
     * @for AircraftCommander
     * @method runSayRoute
     * @param aircraft {AircraftModel}
     * @return {array}   [success of operation, readback]
     */
    runSayRoute(aircraft) {
        return aircraft.pilot.sayRoute();
    }

    /**
     * @for AircraftCommander
     * @method runSID
     * @param aircraft {AircraftModel}
     * @param data {array<string>} a string representation of the SID (may also include exit, eg sid.exit)
     * @return {array}   [success of operation, readback]
     */
    runSID(aircraft, data) {
        const routeString = data[0];
        const airportModel = AirportController.airport_get();

        return aircraft.pilot.applyDepartureProcedure(routeString, airportModel.icao);
    }

    /**
     * @for AircraftCommander
     * @method runSTAR
     * @param data {array<string>} a string representation of the STAR, ex: `QUINN.BDEGA2.KSFO`
     * @return {array}   [success of operation, readback]
     */
    runSTAR(aircraft, data) {
        const routeString = data[0];
        const airportModel = AirportController.airport_get();

        return aircraft.pilot.applyArrivalProcedure(routeString, airportModel.name);
    }

    /**
     * @for AircraftCommander
     * @method runMoveDataBlock
     * @deprecated
     */
    runMoveDataBlock() {
        return [false, 'moving data blocks is now a scope command; see documentation for help'];
    }

    /**
     * Adds a new Leg to fms with a user specified route
     * Note: See notes on 'runReroute' for how to format input for this command
     *
     * @for AircraftCommander
     * @method runRoute
     * @param data
     * @return {array}   [success of operation, readback]
     */
    runRoute(aircraft, data) {
        // TODO: is this .toUpperCase() necessary??
        const routeString = data[0].toUpperCase();

        return aircraft.pilot.applyPartialRouteAmendment(routeString);
    }

    /**
      * Removes all legs, and replaces them with the specified route
      * Note: Input data needs to be provided with single dots connecting all
      * procedurally-linked points (eg KSFO.OFFSH9.SXC or SGD.V87.MOVER), and
      * all other points that will be simply a fix direct to another fix need
      * to be connected with double-dots (eg HLI..SQS..BERRA..JAN..KJAN)
      *
      * @for AircraftCommander
      * @method runReroute
      * @param data
      * @return {array}   [success of operation, readback]
      */
    runReroute(aircraft, data) {
        // TODO: is this .toUpperCase() necessary??
        const routeString = data[0].toUpperCase();
        const readback = aircraft.pilot.replaceFlightPlanWithNewRoute(routeString);

        // Only change to LNAV mode if the route was applied successfully, else
        // continue with the previous instructions (whether a heading, etc)
        if (readback[0]) {
            aircraft.vfrOrbit = null;
            aircraft.mcp.setHeadingLnav();
        }

        return readback;
    }

    /**
     * @for AircraftCommander
     * @method runSayAltitude
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayAltitude(aircraft) {
        const altitude = _round(aircraft.altitude, -2);
        const isClimbingOrDescending = aircraft.trend !== 0;
        const readback = {};
        let altitudeChangeString = 'at ';

        if (isClimbingOrDescending) {
            altitudeChangeString = 'leaving ';
        }

        readback.log = `${altitudeChangeString}${altitude}`;
        readback.say = `${altitudeChangeString}${radio_altitude(altitude)}`;

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runSayAssignedAltitude
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayAssignedAltitude(aircraft) {
        const altitude = _round(aircraft.mcp.altitude, -2);
        const readback = {};

        if (altitude === 0) {
            return [false, 'we haven\'t been assigned an altitude'];
        }

        readback.log = `assigned ${altitude}`;
        readback.say = `assigned ${radio_altitude(altitude)}`;

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runSayHeading
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayHeading(aircraft) {
        const heading = heading_to_string(aircraft.heading);
        const readback = {};

        readback.log = `heading ${heading}`;
        readback.say = `heading ${radio_heading(heading)}`;

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runSayAssignedHeading
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayAssignedHeading(aircraft) {
        if (aircraft.mcp.headingMode !== MCP_MODE.HEADING.HOLD) {
            return [false, 'we haven\'t been assigned a heading'];
        }

        const heading = heading_to_string(aircraft.mcp.heading);
        const readback = {};

        readback.log = `assigned heading ${heading}`;
        readback.say = `assigned heading ${radio_heading(heading)}`;

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runSaySpeed
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayIndicatedAirspeed(aircraft) {
        const speed = _round(aircraft.speed);
        const readback = {};

        readback.log = `indicating ${speed} knots`;
        readback.say = `indicating ${radio_speedSpoken(speed)} knots`;

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runSayAssignedSpeed
     * @param aircraft
     * @return {array} [success of operation, readback]
     */
    runSayAssignedSpeed(aircraft) {
        if (aircraft.mcp.speedMode !== MCP_MODE.SPEED.HOLD) {
            return [false, 'we haven\'t been assigned a speed'];
        }

        const speed = _round(aircraft.mcp.speed);
        const readback = {};

        readback.log = `assigned ${speed} knots`;
        readback.say = `assigned ${radio_speedSpoken(speed)} knots`;

        return [true, readback];
    }

    /**
     * Taxi to the specified destination. Currently only supports taxiing to runways.
     *
     * If a runway is requested but doesn't exist, an error is returned.
     *
     * @for AircraftCommander
     * @method runTaxi
     * @param {AircraftModel} aircraftModel
     * @param {array<string>} data
     * @return {array} [success of operation, readback]
     */
    runTaxi(aircraftModel, data) {
        const airportModel = AirportController.airport_get();
        const requestedRunwayName = data[0];

        if (!requestedRunwayName) {
            const readback = 'we don\'t know which runway to taxi to';

            return [false, readback];
        }

        const runwayModel = airportModel.getRunway(requestedRunwayName.toUpperCase());

        if (!runwayModel) {
            const readback = {};
            readback.log = `unable to find Runway ${requestedRunwayName.toUpperCase()} on our charts`;
            readback.say = `unable to find Runway ${radio_runway(requestedRunwayName)} on our charts`;

            return [false, readback];
        }

        return aircraftModel.taxiToRunway(runwayModel);
    }

    /**
     * @for AircraftCommander
     * @method runTakeoff
     * @param aircraft {AircraftModel}
     * @return {array}   [success of operation, readback]
     */
    runTakeoff(aircraft) {
        // TODO: update some of this queue logic to live in the RunwayModel
        const airport = AirportController.airport_get();
        const runway = aircraft.fms.departureRunwayModel;
        const spotInQueue = runway.getAircraftQueuePosition(aircraft.id);
        const isInQueue = spotInQueue > -1;
        const aircraftAhead = this._findAircraftById(runway.queue[spotInQueue - 1]);
        const wind = airport.getWindAtAltitude();
        const roundedWindAngleInDegrees = round(radiansToDegrees(wind.angle) / 10) * 10;
        const roundedWindSpeed = round(wind.speed);
        const readback = {};

        if (aircraft.isAirborne()) {
            return [false, 'unable to take off, we\'re already airborne'];
        }

        if (aircraft.flightPhase === FLIGHT_PHASE.APRON) {
            return [false, 'unable to take off, we\'re still at the gate'];
        }

        if (aircraft.flightPhase === FLIGHT_PHASE.TAXI) {
            readback.log = `unable to take off, we're still taxiing to Runway ${runway.name}`;
            readback.say = `unable to take off, we're still taxiing to Runway ${radio_runway(runway.name)}`;

            return [false, readback];
        }

        if (aircraft.flightPhase === FLIGHT_PHASE.TAKEOFF) {
            return [false, 'already taking off'];
        }

        if (!isInQueue) {
            return [false, 'unable to take off, we\'re not at any runway'];
        }

        if (spotInQueue > 0) {
            readback.log = `number ${spotInQueue} behind ${aircraftAhead.readbackCallsign}`;
            readback.say = `number ${spotInQueue} behind ${aircraftAhead.getRadioCallsign()}`;

            return [false, readback];
        }

        if (!aircraft.pilot.hasDepartureClearance) {
            return [false, 'unable to take off, we never received an IFR clearance'];
        }

        // see #1154, we may have been rerouted since we started taxiing.
        if (!aircraft.fms.isRunwayModelValidForSid(runway)) {
            readback.log = `according to our charts, Runway ${runway.name} ` +
                `is not valid for the ${aircraft.fms.getSidIcao()} departure`;
            readback.say = `according to our charts, Runway ${runway.getRadioName()} ` +
                `is not valid for the ${aircraft.fms.getSidName()} departure`;

            return [false, readback];
        }

        runway.removeAircraftFromQueue(aircraft.id);
        aircraft.takeoff(runway);

        readback.log = `wind ${roundedWindAngleInDegrees} at ${roundedWindSpeed}, ` +
            `Runway ${runway.name}, cleared for takeoff`;

        // We have to make it say winned to make it sound like "Wind" and not "Whined"
        readback.say = `winned ${radio_spellOut(roundedWindAngleInDegrees)} at ` +
            `${radio_spellOut(roundedWindSpeed)}, Runway ${radio_runway(runway.name)}, ` +
            'cleared for takeoff';

        return [true, readback];
    }

    /**
     * @for AircraftCommander
     * @method runIls
     * @param aircraft {AircraftModel}
     * @param data {array}
     */
    runIls(aircraft, data) {
        const approachType = 'ils';
        const runwayName = data[1].toUpperCase();
        const runwayModel = AirportController.airport_get().getRunway(runwayName);

        return aircraft.pilot.conductInstrumentApproach(aircraft, approachType, runwayModel);
    }

    runOutbound(aircraft, [waypoint]) {
        if (!aircraft.isDeparture()) return [false, 'outbound fixes apply to departures'];
        const fix = NavigationLibrary.findFixByName(waypoint.toUpperCase());
        if (!fix || !fix.isRealFix) return [false, `unknown outbound waypoint ${waypoint.toUpperCase()}`];
        const ground = aircraft.isOnGround();
        aircraft.fms.setDepartureOutbound(fix.name, ground);
        if (!ground) {
            aircraft.target.turn = null;
            aircraft.mcp.setHeadingLnav();
        }
        const readback = (name) => (ground ? `outbound fix ${name}` : `direct ${name} for Centre`);
        return [true, { log: readback(fix.name), say: readback(NavigationLibrary.getFixSpokenName(fix.name)) }];
    }

    /**
     * Build a clear player-facing reason why an Australian aircraft cannot be commanded.
     *
     * @for AircraftCommander
     * @method _getOwnershipRejectionReason
     * @param {AircraftModel} aircraft
     * @return {string}
     * @private
     */
    _getOwnershipRejectionReason(aircraft) {
        const cs = aircraft.controllerState || {};

        if (cs.currentController === CONTROLLER_TYPE.TWR) {
            return aircraft.isDeparture() ?
                'is under Tower control' :
                'is on Tower frequency and not under your control';
        }

        if (cs.currentController === CONTROLLER_TYPE.CTR || aircraft.transferredToCentre) {
            return 'has already been transferred to Centre';
        }

        if (cs.currentController === CONTROLLER_TYPE.UNICOM ||
            cs.communicationReleased ||
            cs.handoffState === HANDOFF_STATE.RELEASED) {
            return 'has already been released from your frequency';
        }

        return 'is not currently on your frequency';
    }

    /**
     * Transfer an aircraft to Tower or Centre on an explicit VHF frequency.
     *
     * @for AircraftCommander
     * @method runContact
     * @param {AircraftModel} aircraft
     * @param {Array<string>} data - [controllerType ('twr'|'ctr'), frequency]
     * @return {Array}
     */
    runContact(aircraft, data = []) {
        const airport = AirportController.airport_get();

        if (!airport || !isAustralianAirport(airport.icao)) {
            return [false, 'contact command is only available at Australian airports'];
        }

        if (!aircraft.isPlayerControlled()) {
            return [false, `unable, aircraft ${this._getOwnershipRejectionReason(aircraft)}`];
        }

        const controllerToken = String((data && data[0]) || '').trim().toLowerCase();

        if (controllerToken !== 'twr' && controllerToken !== 'ctr') {
            return [false, "unable, expected controller type 'twr' or 'ctr'"];
        }

        const normalizedFreq = normalizeFrequency(data && data[1]);

        if (!normalizedFreq) {
            return [false, 'invalid frequency; expected VHF frequency between 118.000 and 136.975'];
        }

        if (controllerToken === 'twr') {
            return this._handoffToTower(aircraft, airport, normalizedFreq);
        }

        return this._handoffToCentre(aircraft, airport, normalizedFreq);
    }

    /**
     * Validate and execute an arrival handoff to Tower.
     *
     * @for AircraftCommander
     * @method _handoffToTower
     * @param {AircraftModel} aircraft
     * @param {AirportModel} airport
     * @param {string} normalizedFreq
     * @return {Array}
     * @private
     */
    _handoffToTower(aircraft, airport, normalizedFreq) {
        if (!aircraft.isArrival()) {
            return [false, 'unable, Tower handoff applies to arrivals only'];
        }

        if (aircraft.isOnGround()) {
            return [false, 'unable, already on the ground'];
        }

        const cs = aircraft.controllerState || {};

        if (cs.currentController === CONTROLLER_TYPE.TWR) {
            return [false, 'already transferred to Tower'];
        }

        const runwayModel = aircraft.fms && aircraft.fms.arrivalRunwayModel;

        if (!runwayModel) {
            return [false, 'unable, no arrival runway assigned'];
        }

        const config = airport.controllerConfig;

        if (!config || !Array.isArray(config.tower) || config.tower.length === 0) {
            return [false, 'unable, no Tower frequency configured'];
        }

        const matchesAnyTower = config.tower.some((t) => frequenciesEqual(normalizedFreq, t.frequency));

        if (!matchesAnyTower) {
            return [false, `unable, ${normalizedFreq} is not a valid Tower frequency`];
        }

        const expectedTower = config.getTowerForRunway(runwayModel.name);

        if (!expectedTower || !frequenciesEqual(normalizedFreq, expectedTower.frequency)) {
            const expectedLabel = expectedTower ?
                `${expectedTower.callsign} on ${expectedTower.frequency}` :
                'a different Tower frequency';
            return [false, `unable, Runway ${runwayModel.name} uses ${expectedLabel}`];
        }

        if (aircraft.rules === FLIGHT_RULES.VFR && aircraft.octaRequired && !aircraft.entryClearance) {
            return [false, 'remaining OCTA, request controlled airspace entry before transfer'];
        }

        if (aircraft.rules !== FLIGHT_RULES.VFR) {
            const eligible = airport.towerController ?
                airport.towerController.isArrivalEligibleForTowerHandoff(aircraft) :
                Boolean(aircraft.pilot && aircraft.pilot.hasApproachClearance && aircraft.isEstablishedOnCourse());

            if (!eligible) {
                if (!(aircraft.pilot && aircraft.pilot.hasApproachClearance)) {
                    return [false, 'unable, not cleared for approach'];
                }

                return [false, 'unable, not yet established on final approach'];
            }
        }

        const eventKey = cs.handoffEventId || aircraft.generateHandoffEventId('twr');

        aircraft.setControllerState({
            currentController: CONTROLLER_TYPE.TWR,
            currentFrequency: expectedTower.frequency,
            handoffState: HANDOFF_STATE.COMPLETED,
            targetController: CONTROLLER_TYPE.TWR,
            targetFrequency: expectedTower.frequency,
            handoffRequired: false,
            handoffCompleted: true,
            handoffDeadline: null,
            communicationReleased: false
        });

        if (!aircraft.projected) {
            if (airport.towerController && airport.towerController.acceptArrival) {
                airport.towerController.acceptArrival(aircraft);
            }

            EventBus.trigger(AIRCRAFT_EVENT.TOWER_HANDOFF, {
                aircraft,
                eventKey,
                frequency: expectedTower.frequency,
                controller: expectedTower.callsign
            });
        }

        const spokenName = config.getRadioNameForController(expectedTower, CONTROLLER_TYPE.TWR) || expectedTower.callsign;
        const log = `contact ${expectedTower.callsign} on ${expectedTower.frequency}`;
        const say = `contact ${spokenName} on ${radio_frequencySpoken(expectedTower.frequency)}`;

        return [true, { log, say }];
    }

    /**
     * Validate and execute a departure handoff to Centre.
     * Shared by `contact ctr [freq]` and Australian `centre`/`center`.
     *
     * @for AircraftCommander
     * @method _handoffToCentre
     * @param {AircraftModel} aircraft
     * @param {AirportModel} airport
     * @param {string|null} normalizedFreq
     * @param {Object} [options={}]
     * @return {Array}
     * @private
     */
    _handoffToCentre(aircraft, airport, normalizedFreq, options = {}) {
        if (!aircraft.isDeparture()) {
            return [false, 'unable, Centre handoff applies to departures only'];
        }

        if (!aircraft.isAirborne()) {
            return [false, 'unable until airborne and tracking the outbound fix'];
        }

        const cs = aircraft.controllerState || {};

        if (cs.currentController === CONTROLLER_TYPE.CTR || aircraft.transferredToCentre) {
            return [false, 'already transferred to Centre'];
        }

        const config = airport.controllerConfig;
        const hasCentres = Boolean(config && Array.isArray(config.centre) && config.centre.length > 0);
        let targetSector = null;

        if (hasCentres) {
            if (!normalizedFreq) {
                return [false, 'invalid frequency; expected VHF frequency between 118.000 and 136.975'];
            }

            const matchedSector = config.centre.find((sector) => frequenciesEqual(normalizedFreq, sector.frequency));

            if (!matchedSector) {
                return [false, `unable, ${normalizedFreq} is not a valid Centre frequency`];
            }

            const expectedSector = typeof config.selectCentreSector === 'function' ?
                config.selectCentreSector(aircraft, airport) :
                config.getPrimaryCentre();

            if (expectedSector && !frequenciesEqual(normalizedFreq, expectedSector.frequency)) {
                return [false, `unable, expected ${expectedSector.callsign} on ${expectedSector.frequency}`];
            }

            targetSector = matchedSector;
        } else {
            targetSector = {
                callsign: 'Centre',
                frequency: normalizedFreq
            };
        }

        const eligible = airport.centreController ?
            airport.centreController.isDepartureEligibleForCentreHandoff(aircraft) :
            (aircraft.isTrackingOutbound() || !aircraft.isInsideAirspace(airport));

        if (!eligible) {
            return [false, 'unable until airborne and tracking the outbound fix'];
        }

        const eventKey = cs.handoffEventId || aircraft.generateHandoffEventId('ctr');

        aircraft.setControllerState({
            currentController: CONTROLLER_TYPE.CTR,
            currentFrequency: targetSector.frequency,
            handoffState: HANDOFF_STATE.COMPLETED,
            targetController: CONTROLLER_TYPE.CTR,
            targetFrequency: targetSector.frequency,
            handoffRequired: false,
            handoffCompleted: true,
            handoffDeadline: null,
            communicationReleased: false
        });
        if (!aircraft.projected) {
            aircraft.transferredToCentre = true;
            aircraft.syncControllabilityFromControllerState();

            if (!aircraft.isInsideAirspace(airport)) {
                aircraft.setIsRemovable();
            }

            if (airport.centreController && airport.centreController._aircraft) {
                airport.centreController._aircraft.add(aircraft.id);
            }

            EventBus.trigger(AIRCRAFT_EVENT.CENTRE_HANDOFF, {
                aircraft,
                eventKey,
                frequency: targetSector.frequency,
                controller: targetSector.callsign
            });
            EventBus.trigger(AIRCRAFT_EVENT.AIRSPACE_EXIT, aircraft);
        }

        if (options.legacyReadback) {
            return [true, 'roger'];
        }

        const spokenName = (config && typeof config.getRadioNameForController === 'function' &&
            config.getRadioNameForController(targetSector, CONTROLLER_TYPE.CTR)) || targetSector.callsign;
        const log = `contact ${targetSector.callsign} on ${targetSector.frequency}`;
        const say = `contact ${spokenName} on ${radio_frequencySpoken(targetSector.frequency)}`;

        return [true, { log, say }];
    }

    /**
     * Release an eligible aircraft from player frequency into uncontrolled airspace.
     *
     * @for AircraftCommander
     * @method runFreqChangeApproved
     * @param {AircraftModel} aircraft
     * @return {Array}
     */
    runFreqChangeApproved(aircraft) {
        const airport = AirportController.airport_get();

        if (!airport || !isAustralianAirport(airport.icao)) {
            return [false, 'frequency change approved is only available at Australian airports'];
        }

        if (!aircraft.isPlayerControlled()) {
            return [false, `unable, aircraft ${this._getOwnershipRejectionReason(aircraft)}`];
        }

        const config = airport.controllerConfig;

        if (config && typeof config.evaluateFcaEligibility === 'function') {
            const evaluation = config.evaluateFcaEligibility(aircraft, airport);

            if (!evaluation.eligible) {
                return [false, evaluation.reason || 'unable, aircraft is not clear to leave controlled frequency'];
            }
        } else {
            if (aircraft.rules !== FLIGHT_RULES.VFR) {
                return [false, 'unable, IFR flights require Centre handoff'];
            }

            if (!aircraft.isAirborne()) {
                return [false, 'unable while on the ground'];
            }
        }

        if (airport.centreController &&
            typeof airport.centreController.isFcaEligible === 'function' &&
            !airport.centreController.isFcaEligible(aircraft)) {
            return [false, 'unable, aircraft is not clear to leave controlled frequency'];
        }

        const cs = aircraft.controllerState || {};
        const eventKey = cs.handoffEventId || aircraft.generateHandoffEventId('fca');

        aircraft.setControllerState({
            currentController: CONTROLLER_TYPE.NONE,
            currentFrequency: null,
            handoffState: HANDOFF_STATE.RELEASED,
            targetController: CONTROLLER_TYPE.NONE,
            targetFrequency: null,
            handoffRequired: false,
            handoffCompleted: true,
            handoffDeadline: null,
            communicationReleased: true
        });

        if (!aircraft.projected && !aircraft.isInsideAirspace(airport)) {
            aircraft.setIsRemovable();
        }

        if (!aircraft.projected) {
            EventBus.trigger(AIRCRAFT_EVENT.FREQ_CHANGE_APPROVED, {
                aircraft,
                eventKey
            });
        }

        return [true, { log: 'frequency change approved, good day', say: 'frequency change approved, good day' }];
    }

    runCentre(aircraft) {
        const airport = AirportController.airport_get();

        if (!airport || !isAustralianAirport(airport.icao)) {
            if (!aircraft.isDeparture()) return [false, 'Centre transfer applies to departures'];
            if (!aircraft.transferToCentre()) return [false, 'unable until airborne and tracking the outbound fix'];
            return [true, 'roger'];
        }

        if (!aircraft.isPlayerControlled()) {
            return [false, `unable, aircraft ${this._getOwnershipRejectionReason(aircraft)}`];
        }

        const config = airport.controllerConfig;
        let expectedSector = null;

        if (config && typeof config.selectCentreSector === 'function') {
            expectedSector = config.selectCentreSector(aircraft, airport);
        } else if (config && typeof config.getPrimaryCentre === 'function') {
            expectedSector = config.getPrimaryCentre();
        }

        const freq = expectedSector ? expectedSector.frequency : null;
        return this._handoffToCentre(aircraft, airport, freq, { legacyReadback: true });
    }

    runClearEntry(aircraft) {
        const airport = AirportController.current;
        if (!/^Y/i.test(airport.icao) || aircraft.rules !== 'vfr' || aircraft.isOnGround()) {
            return [false, 'airborne Australian VFR only'];
        }
        aircraft.entryClearance = {
            airport: airport.icao,
            issuer: aircraft.controllerState.currentController,
            issued: TimeKeeper.accumulatedDeltaTime,
            ceiling: airport.ctr_ceiling
        };
        aircraft.controllerState.airspaceEntryCleared = true;
        aircraft.octaRequired = false;
        aircraft.octaGuidance = null;
        aircraft.predictedEntry = null;
        return [true, 'cleared to enter controlled airspace'];
    }

    runOcta(aircraft) {
        if (aircraft.rules !== 'vfr' || aircraft.isOnGround() || !/^Y/i.test(AirportController.current.icao)) {
            return [false, 'airborne Australian VFR arrivals only'];
        }
        if (AirportController.current.isPointWithinAirspace(aircraft.relativePosition, aircraft.altitude)) {
            return [false, 'already inside controlled airspace, request exit instructions'];
        }
        if (!aircraft.vfrOrbit) {
            const orbit = clearOrbit(AirportController.current, aircraft.positionModel, aircraft.altitude, aircraft.trueAirspeed || aircraft.speed, aircraft.model.bankAngle);
            aircraft.pilot.cancelApproachClearance(aircraft);
            aircraft.mcp.setAltitudeFieldValue(aircraft.altitude);
            aircraft.mcp.setAltitudeHold();
            if (orbit) aircraft.mcp.headingMode = MCP_MODE.HEADING.OFF;
            else {
                aircraft.mcp.setHeadingFieldValue(aircraft.heading);
                aircraft.mcp.setHeadingHold();
            }
            aircraft.target.turn = null;
            aircraft.vfrOrbit = orbit;
        }
        aircraft.octaRequired = true;
        aircraft.nextOctaCheck = 0;
        aircraft.entryClearance = null;
        aircraft.controllerState.airspaceEntryCleared = false;
        return [true, 'remaining outside controlled airspace'];
    }

    runRnav(aircraft, [waypoint, runway]) {
        return aircraft.pilot.joinApproach(aircraft, runway, waypoint.toUpperCase());
    }

    runVisual(aircraft, [runway]) {
        return aircraft.pilot.joinApproach(aircraft, runway);
    }

    /**
     * @for AircraftCommander
     * @method runLand
     * @param aircraft {AircraftModel}
     * @param data {array}
     */
    runLand(aircraft, [name] = []) {
        const airport = AirportController.current;
        if (!airport || !/^Y/i.test(airport.icao)) return [false, 'use an approach clearance at this airport'];
        if (airport.controllerConfig && airport.controllerConfig.tower.length) return [false, 'contact tower for landing clearance'];
        const runway = aircraft.fms.arrivalRunwayModel;
        if (!aircraft.pilot.hasApproachClearance || !runway || (name && name.toUpperCase() !== runway.name)) {
            return [false, 'request approach or circuit clearance to the assigned runway first'];
        }
        if (aircraft.rules === 'vfr' && !aircraft.entryClearance) return [false, 'request controlled airspace entry first'];
        aircraft.landingClearance = {
            runway: runway.name,
            issuer: aircraft.controllerState.currentController,
            issued: TimeKeeper.accumulatedDeltaTime
        };
        return [true, `cleared to land runway ${runway.name}`];
    }

    /**
     * @for AircraftCommander
     * @method runSquawk
     * @param aircraft {AircraftModel}
     * @param data {array<string>}
     * @return {array}   [success of operation, readback]
     */
    runSquawk(aircraft, data) {
        const squawk = data[0];
        const result = this._onChangeTransponderCode(squawk, aircraft);
        let readback = {
            log: `squawk ${squawk}`,
            say: `squawk ${radio_squawkSpoken(squawk)}`
        };

        if (!result) {
            readback = {
                log: `unable to squawk ${squawk}`,
                say: `unable to squawk ${radio_squawkSpoken(squawk)}`
            };
        }

        return [result, readback];
    }

    /**
     * @for AircraftCommander
     * @method runDelete
     * @param aircraft {AircraftModel}
     */
    runDelete(aircraft) {
        this._eventBus.trigger(EVENT.REMOVE_AIRCRAFT, aircraft);
    }

    /**
     * This command has been deprecated and this method is used only to display a warning to users
     *
     * @deprecated
     * @for AircraftCommander
     * @method runFix
     * @return {array}   [success of operation, readback]
     */
    runFix() {
        const isWarning = true;

        UiController.ui_log(
            'The fix command has been deprecated. Please use rr, pd or fh instead of fix',
            isWarning
        );
    }
}
