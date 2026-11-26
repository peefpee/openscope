import _ceil from 'lodash/ceil';
import _find from 'lodash/find';
import _floor from 'lodash/floor';
import _isNil from 'lodash/isNil';
import AirportController from '../../airport/AirportController';
import { circuitPoints } from './VfrArrival';
import { ApproachGuidance, planApproach } from './ApproachGuidance';
import Fms from '../FlightManagementSystem/Fms';
import ModeController from '../ModeControl/ModeController';
import NavigationLibrary from '../../navigationLibrary/NavigationLibrary';
import { MCP_MODE } from '../ModeControl/modeControlConstants';
import { FLIGHT_PHASE, FLIGHT_RULES } from '../../constants/aircraftConstants';
import { INVALID_NUMBER } from '../../constants/globalConstants';
import { radians_normalize } from '../../math/circle';
import {
    groupNumbers,
    radio_altitude,
    radio_approachSpoken,
    radio_heading,
    radio_procedureSpoken,
    radio_runway,
    radio_speedSpoken,
    radio_spellOut,
    radio_trend,
    getRadioCardinalDirectionNameForHeading
} from '../../utilities/radioUtilities';
import {
    degreesToRadians,
    heading_to_string,
    radiansToDegrees
} from '../../utilities/unitConverters';

/**
 * Executes control actions upon the aircraft by manipulating the MCP and FMS, and provides
 * readbacks to air traffic control instructions.
 *
 * @class Pilot
 */
export default class Pilot {
    /**
     * @for Pilot
     * @constructor
     * @param modeController {ModeController}
     * @param fms {Fms}
     */
    constructor(fms, modeController) {
        if (!(fms instanceof Fms)) {
            throw new TypeError(`Expected fms to an instance of Fms but received ${typeof fms}`);
        }

        if (!(modeController instanceof ModeController)) {
            throw new TypeError('Expected modeController to an instance of ' +
                `ModeController, but received ${typeof modeController}`);
        }

        /**
         * @for Pilot
         * @property _fms
         * @type {Fms}
         * @private
         */
        this._fms = null;

        /**
         * @for Pilot
         * @property _mcp
         * @type {ModeController}
         * @private
         */
        this._mcp = null;

        /**
         * Whether the aircraft has received a clearance to conduct an approach to a runway
         *
         * @for Pilot
         * @property hasApproachClearance
         * @type {boolean}
         * @default false
         */
        this.hasApproachClearance = false;
        this.approachGuidance = null;

        /**
         * Whether the aircraft has received an IFR clearance to their destination
         *
         * @for Pilot
         * @property hasDepartureClearance
         * @type {boolean}
         * @default false
         */
        this.hasDepartureClearance = false;

        return this.init(fms, modeController);
    }

    /**
     * @for Pilot
     * @method init
     * @chainable
     */
    init(fms, modeController) {
        this._fms = fms;
        this._mcp = modeController;
        this.hasApproachClearance = false;
        this.approachGuidance = null;
        this.hasDepartureClearance = false;

        return this;
    }

    /**
     * @for Pilot
     * @method reset
     * @chainable
     */
    reset() {
        this._fms = null;
        this._mcp = null;
        this.hasApproachClearance = false;
        this.approachGuidance = null;
        this.hasDepartureClearance = false;

        return this;
    }

    /**
     * Maintain a given altitude
     *
     * @for Pilot
     * @method maintainAltitude
     * @param altitude {number}   the altitude to maintain, in feet
     * @param expedite {boolean}  whether to use maximum possible climb/descent rate
     * @param shouldUseSoftCeiling {boolean}
     * @param airportModel {AirportModel}
     * @param aircraftModel {AircraftModel}
     * @return {array} [success of operation, readback]
     */
    maintainAltitude(altitude, expedite, shouldUseSoftCeiling, airportModel, aircraftModel) {
        const response = aircraftModel.validateNextAltitude(altitude, airportModel);

        if (!response[0]) {
            return response;
        }

        const currentAltitude = aircraftModel.altitude;
        let clampedAltitude = airportModel.clampWithinAssignableAltitudes(altitude);

        if (shouldUseSoftCeiling && clampedAltitude === airportModel.maxAssignableAltitude) {
            // causes aircraft to 'leave' airspace, and continue climb through ceiling
            clampedAltitude += 1;
        }

        this.cancelApproachClearance(aircraftModel);
        this._mcp.setAltitudeFieldValue(clampedAltitude);
        this._mcp.setAltitudeHold();
        this._mcp.shouldExpediteAltitudeChange = false;
        if (aircraftModel.vfrOrbit) {
            aircraftModel.vfrOrbit.altitude = clampedAltitude;
        }

        // Build readback
        const readbackAltitude = _floor(clampedAltitude, -2);
        const altitudeInstruction = radio_trend('altitude', currentAltitude, altitude);
        const altitudeVerbal = radio_altitude(readbackAltitude);
        let expediteReadback = '';

        if (expedite) {
            this._mcp.shouldExpediteAltitudeChange = true;

            // including space here so when expedite is false there isnt an extra space after altitude
            expediteReadback = ' and expedite';
        }

        const readback = {};
        readback.log = `${altitudeInstruction} ${readbackAltitude}${expediteReadback}`;
        readback.say = `${altitudeInstruction} ${altitudeVerbal}${expediteReadback}`;

        return [true, readback];
    }

    /**
     * Maintain a given heading
     *
     * @for Pilot
     * @method maintainHeading
     * @param aircraftModel {AircraftModel}
     * @param headingInDegrees {number}                 the heading to maintain, in degrees
     * @param direction      {string|null}  (optional)  the direction of turn; either 'left' or 'right'
     * @param incremental    {boolean}      (optional)  whether the value is a numeric heading, or a
     *                                                  number of degrees to turn
     * @return {array}                                  [success of operation, readback]
     */
    maintainHeading(aircraftModel, headingInDegrees, direction, incremental) {
        const nextHeadingInRadians = degreesToRadians(headingInDegrees);
        let correctedHeading = nextHeadingInRadians;

        if (incremental) {
            // if direction is left
            correctedHeading = radians_normalize(aircraftModel.heading - nextHeadingInRadians);

            if (direction === 'right') {
                correctedHeading = radians_normalize(aircraftModel.heading + nextHeadingInRadians);
            }
        }

        this.cancelApproachClearance(aircraftModel);
        this.cancelHoldingPattern();
        aircraftModel.vfrOrbit = null;
        this._mcp.setHeadingFieldValue(correctedHeading);
        this._mcp.setHeadingHold();

        const headingStr = heading_to_string(correctedHeading);
        const readback = {};
        readback.log = `fly heading ${headingStr}`;
        readback.say = `fly heading ${radio_heading(headingStr)}`;

        if (incremental) {
            readback.log = `turn ${headingInDegrees} degrees ${direction}`;
            readback.say = `turn ${groupNumbers(headingInDegrees)} degrees ${direction}`;
        } else if (direction) {
            readback.log = `turn ${direction} heading ${headingStr}`;
            readback.say = `turn ${direction} heading ${radio_heading(headingStr)}`;
        }

        return [true, readback];
    }

    /**
     * Maintain the aircraft's present magnetic heading
     *
     * @for Pilot
     * @method maintainPresentHeading
     * @param aircraftModel {AircraftModel} the heading the aircraft is facing at the time the command is given
     * @return {array} [success of operation, readback]
     */
    maintainPresentHeading(aircraftModel) {
        this.cancelApproachClearance(aircraftModel);
        aircraftModel.vfrOrbit = null;
        this._mcp.setHeadingFieldValue(aircraftModel.heading);
        this._mcp.setHeadingHold();

        const readback = {};
        const runwayOrPresent = (
            aircraftModel.flightPhase === FLIGHT_PHASE.WAITING || aircraftModel.flightPhase === FLIGHT_PHASE.TAKEOFF
        ) ? 'runway' : 'present';
        readback.log = `fly ${runwayOrPresent} heading`;
        readback.say = `fly ${runwayOrPresent} heading`;

        return [true, readback];
    }

    /**
     * Maintain a given speed
     *
     * @for Pilot
     * @method maintainSpeed
     * @param speed {Number} - the speed to maintain, in knots
     * @param aircraftModel {AircraftModel}
     * @return {Array} [success of operation, readback]
     */
    maintainSpeed(speed, aircraftModel) {
        if (!aircraftModel.model.isAbleToMaintainSpeed(speed)) {
            const readback = {};
            readback.log = `unable to maintain ${speed} knots due to performance`;
            readback.say = `unable to maintain ${radio_speedSpoken(speed)} knots due to performance`;

            return [false, readback];
        }

        const currentSpeed = aircraftModel.speed;
        const instruction = radio_trend('speed', currentSpeed, speed);

        this._mcp.setSpeedFieldValue(speed);
        this._mcp.setSpeedHold();

        // Build the readback
        const readback = {};
        readback.log = `${instruction} ${speed}`;
        readback.say = `${instruction} ${radio_speedSpoken(speed)}`;

        return [true, readback];
    }

    /**
     * Apply the specified arrival procedure by adding it to the fms route
     * Note: SHOULD NOT change the heading mode
     *
     * @for Pilot
     * @method applyArrivalProcedure
     * @param routeString {string}       route string in the form of `entry.procedure.airport`
     * @param airportName {string}
     * @return {array}                   [success of operation, readback]
     */
    applyArrivalProcedure(routeString, airportName) {
        const [successful, response] = this._fms.replaceArrivalProcedure(routeString);

        if (!successful) {
            return [false, response];
        }

        this.cancelHoldingPattern();

        // Build readback
        const readback = {};
        readback.log = `cleared to ${airportName} via the ${this._fms._routeModel.getStarIcao().toUpperCase()} arrival`;
        readback.say = `cleared to ${airportName} via the ` +
            `${radio_procedureSpoken(this._fms._routeModel.getStarName())} arrival`;

        return [true, readback];
    }

    /**
     * Apply the specified departure procedure by adding it to the fms route
     * Note: SHOULD NOT change the heading mode
     *
     * @for Pilot
     * @method applyDepartureProcedure
     * @param routeString {String}          the route
     * @param airportIcao {string}          airport icao identifier
     * @return {array}                      [success of operation, readback]
     */
    applyDepartureProcedure(routeString, airportIcao) {
        const [successful, response] = this._fms.replaceDepartureProcedure(routeString, airportIcao);

        if (!successful) {
            return [false, response];
        }

        this.hasDepartureClearance = true;

        const sidIcao = this._fms.getSidIcao();
        const sidName = this._fms.getSidName();
        const readback = {};
        readback.log = `cleared to destination via the ${sidIcao.toUpperCase()} departure, then as filed`;
        readback.say = `cleared to destination via the ${radio_procedureSpoken(sidName)} departure, then as filed`;

        return [true, readback];
    }

    /**
     * Apply the specified route, and as applicable, merge it with the current route
     *
     * @for Pilot
     * @method applyPartialRouteAmendment
     * @param routeString {tring}  route string in the form of `entry.procedure.airport`
     * @return {array}             [success of operation, readback]
     */
    applyPartialRouteAmendment(routeString) {
        const readback = this._fms.applyPartialRouteAmendment(routeString);

        if (readback[0]) {
            this.hasDepartureClearance = true;

            this.cancelHoldingPattern();
        }

        return readback;
    }

    /**
     * Ensure the STAR leg has the specified arrival runway as the exit point and
     * set the specified runway as the new arrival runway.
     *
     * @for Pilot
     * @method updateStarLegForArrivalRunway
     * @param aircraft {AircraftModel}
     * @param nextRunwayModel {RunwayModel}
     * @return {array} [success of operation, response]
     */
    updateStarLegForArrivalRunway(aircraft, nextRunwayModel) {
        if (aircraft.isOnGround()) {
            return [false, 'unable to accept arrival runway assignment until airborne'];
        }

        return this._fms.updateStarLegForArrivalRunway(nextRunwayModel);
    }

    /**
     * Stop conducting the instrument approach, and maintain:
     * - current or last assigned altitude (whichever is lower)
     * - current heading
     * - last assigned speed
     *
     * @for Pilot
     * @method cancelApproachClearance
     * @param aircraftModel {AircraftModel}
     * @return {array} [success of operation, readback]
     */
    cancelApproachClearance(aircraftModel) {
        if (!this.hasApproachClearance) {
            return [false, 'we have no approach clearance to cancel!'];
        }

        const airport = AirportController.airport_get();
        const currentAltitude = _floor(aircraftModel.altitude, -2);
        const descentAltitude = Math.min(currentAltitude, this._mcp.altitude);
        const altitudeToMaintain = Math.max(descentAltitude, airport.minAssignableAltitude);

        this._mcp.setAltitudeFieldValue(altitudeToMaintain);
        this._mcp.setAltitudeHold();
        this._mcp.setHeadingFieldValue(aircraftModel.heading);
        this._mcp.setHeadingHold();
        this._mcp.setSpeedHold();

        if (this.approachGuidance) aircraftModel.setFlightPhase(FLIGHT_PHASE.DESCENT);
        this.hasApproachClearance = false;
        this.approachGuidance = null;

        const readback = 'cancel approach clearance, fly present heading, ' +
            'maintain last assigned altitude and speed';

        return [true, readback];
    }

    /**
     * Cancel departure clearance
     *
     * @for Pilot
     * @method cancelDepartureClearance
     * @param aircraftModel {AircraftModel}
     * @return {array} [success of operation, response]
     */
    cancelDepartureClearance(aircraftModel) {
        if (aircraftModel.isAirborne()) {
            return;
        }

        this.hasDepartureClearance = false;

        return [true, 'roger, understand IFR clearance is cancelled, standing by'];
    }

    /**
    * Arm the exit of the holding pattern
    *
    * @for Pilot
    * @method cancelHoldingPattern
    * @param fixName {string} name of the fix at which the hold should be canceled (optional)
    * @return {array} [success of operation, readback]
    */
    cancelHoldingPattern(fixName) {
        let holdWaypointModel = _find(this._fms.waypoints, (waypointModel) => waypointModel.isHoldWaypoint);

        if (!holdWaypointModel) {
            return [false, 'that must be for somebody else, we weren\'t given any holding instructions'];
        }

        if (fixName) {
            holdWaypointModel = this._fms.findWaypoint(fixName);

            if (!holdWaypointModel || !holdWaypointModel.isHoldWaypoint) {
                const spokenFix = NavigationLibrary.getFixSpokenName(fixName);

                return [false, {
                    log: `that must be for somebody else, we weren't given holding over ${fixName.toUpperCase()}`,
                    say: `that must be for somebody else, we weren't given holding over ${spokenFix}`
                }];
            }
        }

        holdWaypointModel.deactivateHold();

        return [true, {
            log: `roger, we'll cancel the hold at ${holdWaypointModel.getDisplayName()}`,
            say: `roger, we'll cancel the hold at ${NavigationLibrary.getFixSpokenName(holdWaypointModel.name)}`
        }];
    }

    /**
     * Configure the aircraft to fly in accordance with the requested flightplan
     *
     * @for Pilot
     * @method clearedAsFiled
     * @return {Array}                  [success of operation, readback]
     */
    clearedAsFiled() {
        this.hasDepartureClearance = true;

        const readback = {};
        readback.log = 'cleared to destination as filed';
        readback.say = 'cleared to destination as filed';

        return [true, readback];
    }

    /**
     * Climb in accordance with the altitude restrictions, and sets
     * altitude at which the climb will end regardless of fix restrictions.
     *
     * https://www.faa.gov/about/office_org/headquarters_offices/avs/offices/afx/afs/afs400/afs470/pbn/
     *      media/Climb_Descend_Via_FAQ.pdf
     * https://www.faa.gov/documentLibrary/media/Notice/N7110.584.pdf
     *
     * @for Pilot
     * @method climbViaSid
     * @param aircraftModel {AircraftModel}
     * @param maximumAltitude {number} (optional) altitude at which the climb will end (regardless of fix restrictions)
     * @return {array}           [success of operation, readback]
     */
    climbViaSid(aircraftModel, maximumAltitude) {
        let nextAltitude = maximumAltitude;


        if (typeof nextAltitude === 'undefined') {
            nextAltitude = this._fms.flightPlanAltitude;
        }

        const { departureAirportModel } = this._fms;
        const altitudeCheck = aircraftModel.validateNextAltitude(nextAltitude, departureAirportModel);

        if (!altitudeCheck[0]) {
            return altitudeCheck;
        }

        nextAltitude = departureAirportModel.clampWithinAssignableAltitudes(nextAltitude);

        if (aircraftModel.altitude > nextAltitude) {
            const currentAltitude = _ceil(aircraftModel.altitude, -2);
            const readback = {};
            readback.log = `unable, we're already at ${currentAltitude}`;
            readback.say = `unable, we're already at ${radio_altitude(currentAltitude)}`;

            return [false, readback];
        }

        this._mcp.setAltitudeFieldValue(nextAltitude);
        this._mcp.setAltitudeVnav();
        this._mcp.setSpeedVnav();

        const readback = {};
        readback.log = `climb via SID and maintain ${nextAltitude}`;
        readback.say = `climb via SID and maintain ${radio_altitude(nextAltitude)}`;

        return [true, readback];
    }

    /**
     * Descend in accordance with the altitude restrictions
     *
     * https://www.faa.gov/about/office_org/headquarters_offices/avs/offices/afx/afs/afs400/afs470/pbn/
     *      media/Climb_Descend_Via_FAQ.pdf
     * https://www.faa.gov/documentLibrary/media/Notice/N7110.584.pdf
     *
     * @for Pilot
     * @method descendViaStar
     * @param aircraftModel {AircraftModel}
     * @param bottomAltitude {number} (optional) altitude at which the descent will end (regardless of fix restrictions)
     * @return {array}                [success of operation, readback]
     */
    descendViaStar(aircraftModel, bottomAltitude) {
        let nextAltitude = bottomAltitude;

        if (typeof nextAltitude === 'undefined') {
            nextAltitude = this._fms.getBottomAltitude();
        }

        const { arrivalAirportModel } = this._fms;
        const altitudeCheck = aircraftModel.validateNextAltitude(nextAltitude, arrivalAirportModel);

        if (!altitudeCheck[0]) {
            return altitudeCheck;
        }

        nextAltitude = arrivalAirportModel.clampWithinAssignableAltitudes(nextAltitude);

        if (aircraftModel.altitude < nextAltitude) {
            const currentAltitude = _ceil(aircraftModel.altitude, -2);
            const readback = {};
            readback.log = `unable, we're already at ${currentAltitude}`;
            readback.say = `unable, we're already at ${radio_altitude(currentAltitude)}`;

            return [false, readback];
        }

        this._mcp.setAltitudeFieldValue(nextAltitude);
        this._mcp.setAltitudeVnav();
        this._mcp.setSpeedVnav();

        const readback = {};
        readback.log = `descend via STAR and maintain ${nextAltitude}`;
        readback.say = `descend via STAR and maintain ${radio_altitude(nextAltitude)}`;

        return [true, readback];
    }

    /**
     * Cross a fix at a certain altitude and/or speed
     *
     * @for Pilot
     * @method crossFix
     * @param aircraftModel {AircraftModel}
     * @param fixName  {string} name of the fix
     * @param altitude {number} the altitude
     * @param speed {number} the speed
     * @return {array}  success of operation, readback]
     */
    crossFix(aircraftModel, fixName, altitude, speed) {
        if (!altitude && !speed) {
            return [false, 'say again? In crossing restrictions, prefix altitudes with A and speeds with S!'];
        }

        if (!NavigationLibrary.hasFixName(fixName)) {
            const readback = {
                log: `unable to find '${fixName.toUpperCase()}'`,
                say: `unable to find ${NavigationLibrary.getFixSpokenName(fixName)}`
            };
            return [false, readback];
        }

        if (!this._fms.hasWaypointName(fixName)) {
            const readback = {
                log: `unable, '${fixName.toUpperCase()}' is not on our route`,
                say: `unable, ${NavigationLibrary.getFixSpokenName(fixName)} is not on our route`
            };
            return [false, readback];
        }

        const airportModel = this._fms.arrivalAirportModel || this._fms.departureAirportModel;
        const waypoint = this._fms.findWaypoint(fixName);

        // altitude-only crossing restriction
        if (!speed) {
            const altitudeCheck = aircraftModel.validateNextAltitude(altitude, airportModel);

            if (!altitudeCheck[0]) {
                return altitudeCheck;
            }

            altitude = airportModel.clampWithinAssignableAltitudes(altitude);

            waypoint.setAltitude(altitude);
            this._mcp.setAltitudeFieldValue(altitude);
            this._mcp.setAltitudeVnav();

            const readback = {
                log: `cross ${fixName.toUpperCase()} at ${altitude}`,
                say: `cross ${NavigationLibrary.getFixSpokenName(fixName)} at ${radio_altitude(altitude)}`
            };

            return [true, readback];
        }

        // speed-only crossing restriction
        if (!altitude) {
            const speedCheck = aircraftModel.validateNextSpeed(speed);

            if (!speedCheck[0]) {
                return speedCheck;
            }

            waypoint.setSpeed(speed);
            this._mcp.setSpeedFieldValue(speed);
            this._mcp.setSpeedVnav();

            const readback = {
                log: `cross ${fixName.toUpperCase()} at ${speed}kt`,
                say: `cross ${NavigationLibrary.getFixSpokenName(fixName)} at ${radio_spellOut(speed)} knots`
            };

            return [true, readback];
        }

        // altitude AND speed crossing restriction
        const altitudeCheck = aircraftModel.validateNextAltitude(altitude, airportModel);
        const speedCheck = aircraftModel.validateNextSpeed(speed);

        if (!altitudeCheck[0]) {
            return altitudeCheck;
        }

        if (!speedCheck[0]) {
            return speedCheck;
        }

        waypoint.setAltitude(altitude);
        waypoint.setSpeed(speed);
        this._mcp.setAltitudeFieldValue(altitude);
        this._mcp.setSpeedFieldValue(speed);
        this._mcp.setAltitudeVnav();
        this._mcp.setSpeedVnav();

        const readback = {
            log: `cross ${fixName.toUpperCase()} at ${altitude} and ${speed}kt`,
            say: `cross ${NavigationLibrary.getFixSpokenName(fixName)} at ` +
                `${radio_altitude(altitude)} and ${radio_spellOut(speed)} knots`
        };

        return [true, readback];
    }

    /**
     * Abort the landing attempt; maintain present heading/speed, and climb to a reasonable altitude
     *
     * @for Pilot
     * @method goAround
     * @param heading {number}           the aircraft's current heading
     * @param speed {number}             the aircraft's current speed
     * @param airportElevation {number}  the elevation of the airport, in feet MSL
     * @return {array}                   [success of operation, readback]
     */
    goAround(heading, speed, airportElevation) {
        const altitudeToMaintain = _ceil(airportElevation, -2) + 1000;

        this._mcp.setHeadingFieldValue(heading);
        this._mcp.setHeadingHold();
        this._mcp.setAltitudeFieldValue(altitudeToMaintain);
        this._mcp.setAltitudeHold();
        this._mcp.setSpeedFieldValue(speed);
        this._mcp.setSpeedHold();

        const readback = {};
        readback.log = `go around, fly present heading, maintain ${altitudeToMaintain}`;
        readback.say = `go around, fly present heading, maintain ${radio_altitude(altitudeToMaintain)}`;

        return [true, readback];
    }

    /**
     * Intercept a radial course or localizer (horizontal guidance)
     *
     * @for Pilot
     * @method _interceptCourse
     * @param datum {StaticPositionModel}  the position the course is based upon
     * @param course {number}              the heading inbound to the datum
     * @return {array}                     [success of operation, readback]
     * @private
     */
    _interceptCourse(datum, course) {
        this._mcp.setNav1Datum(datum);
        this._mcp.setCourseFieldValue(course);
        this._mcp.setHeadingVorLoc();

        const readback = {};
        readback.log = 'intercept localizer';
        readback.say = 'intercept localizer';

        return [true, readback];
    }

    /**
     * Intercept a glidepath or glideslop (vertical guidance)
     *
     * @for Pilot
     * @method _interceptGlidepath
     * @param datum {StaticPositionModel}  the position the glidepath is projected from
     * @param course {number}              the heading inbound to the datum
     * @param descentAngle {number}        the angle of descent along the glidepath
     * @return {array}                     [success of operation, readback]
     * @private
     */
    _interceptGlidepath(datum, course, descentAngle) {
        // TODO: I feel like our description of lateral/vertical guidance should be done with its
        // own class rather than like this by storing all sorts of irrelevant stuff in the pilot/MCP.
        if (this._mcp.nav1Datum !== datum) {
            return [false, 'cannot follow glidepath because we are using lateral navigation from a different origin'];
        }

        if (this._mcp.course !== course) {
            return [
                false,
                'cannot follow glidepath because its course differs from that specified for lateral guidance'
            ];
        }

        // TODO: the descentAngle is a part of the ILS system itself, and should not be owned by the MCP
        this._mcp.setDescentAngle(descentAngle);

        // TODO: Though not realistic, to emulate the refusal to descend below MCP altitude
        // until established on the localizer, we should not be setting the altitude mode to
        // 'APP' until established on the localizer. This will prevent improper descent behaviors.
        this._mcp.setAltitudeApproach();

        return [true, 'intercept glidepath'];
    }

    joinApproach(aircraft, runwayName, entry, leg, side) {
        if (entry && aircraft.rules === 'vfr') return [false, 'unable RNAV approach, VFR'];
        const airport = AirportController.airport_get();
        const runway = airport.getRunway(runwayName.toUpperCase().replace(/^(\d)([LCR]?)$/, '0$1$2'));
        if (leg && (!runway || aircraft.isOnGround())) return [false, 'unable to join that circuit'];
        const right = side ? side === 'r' : Boolean(runway && runway.circuit ? runway.circuit.direction === 'right' : aircraft.rightCircuit);
        const legName = {
            dw: 'downwind', xw: 'crosswind', base: 'base', final: 'final'
        }[leg];
        const [success, guidance] = leg ? [true, new ApproachGuidance(runway,
            circuitPoints(runway, leg, right, aircraft.model.speed.landing * 1.35, aircraft, airport), legName)] :
            planApproach(aircraft, airport, runway, entry);
        if (!success) {
            const spokenGuidance = entry ?
                guidance.replace(/(via |waypoint )([A-Z0-9_]+)/g, (match, prefix, fix) => {
                    return prefix + NavigationLibrary.getFixSpokenName(fix, true);
                }) :
                guidance;
            const say = spokenGuidance;
            return [false, { log: guidance, say }];
        }

        this.cancelHoldingPattern();
        this._fms.setArrivalRunway(runway);
        this._interceptCourse(runway.positionModel, runway.angle);
        this._interceptGlidepath(runway.positionModel, runway.angle, runway.ils.glideslopeGradient);
        this.hasApproachClearance = true;
        this.approachGuidance = guidance;
        aircraft.vfrOrbit = null;
        if (leg) {
            aircraft.rightCircuit = right;
            aircraft.circuitClearance = { runway: runway.name, leg, right, issuer: aircraft.controllerState.currentController };
            aircraft.circuitPhase = aircraft.octaRequired ? 'AWAITING ENTRY' : 'JOINING ' + legName.toUpperCase();
        }
        aircraft.target.turn = null;
        aircraft.setFlightPhase(FLIGHT_PHASE.DESCENT);
        if (leg) {
            let turn = '';

            if (leg !== 'final') {
                turn = right ? 'right ' : 'left ';
            }

            return [true, `joining ${turn}${legName} runway ${runway.name}`];
        }
        const spokenVia = entry ? ` via ${NavigationLibrary.getFixSpokenName(entry, true)}` : '';
        const spokenName = radio_approachSpoken(guidance.name);
        const via = entry ? ` via ${entry}` : '';
        return [true, {
            log: `cleared ${guidance.name} approach runway ${runway.name}${via}`,
            say: `cleared ${spokenName} approach runway ${radio_runway(runway.name)}${spokenVia}`
        }];
    }

    /**
     * Conduct the specified instrument approachType
     * Note: Currently only supports ILS approaches
     * Note: Approach variants cannot yet be specified (eg RNAV-Y)
     *
     * @for pilot
     * @method conductInstrumentApproach
     * @param aircraftModel {AircraftModel} the aircraft model belonging to this pilot
     * @param approachType {string}         the type of instrument approach (eg 'ILS', 'RNAV', 'VOR', etc)
     * @param runwayModel {RunwayModel}     the runway the approach ends at
     * @return {array}                      [success of operation, readback]
     */
    conductInstrumentApproach(aircraftModel, approachType, runwayModel) {
        if (aircraftModel.rules === 'vfr') return [false, 'unable instrument approach, VFR'];
        if (_isNil(runwayModel)) {
            return [false, 'the specified runway does not exist'];
        }

        const minimumGlideslopeInterceptAltitude = runwayModel.getMinimumGlideslopeInterceptAltitude();

        if (aircraftModel.mcp.altitude < minimumGlideslopeInterceptAltitude) {
            const readback = {};

            readback.log = `unable ILS ${runwayModel.name}, our assigned altitude is below the minimum ` +
                `glideslope intercept altitude, request climb to ${minimumGlideslopeInterceptAltitude}`;
            readback.say = `unable ILS ${radio_runway(runwayModel.name)}, our assigned altitude is below the minimum ` +
                `glideslope intercept altitude, request climb to ${radio_altitude(minimumGlideslopeInterceptAltitude)}`;

            return [false, readback];
        }

        // TODO: split these two method calls and the corresponding ifs to a new method
        const datum = runwayModel.positionModel;
        const course = runwayModel.angle;
        const descentAngle = runwayModel.ils.glideslopeGradient;
        const lateralGuidance = this._interceptCourse(datum, course);
        const verticalGuidance = this._interceptGlidepath(datum, course, descentAngle);

        // TODO: As written, `._interceptCourse()` will always return true.
        if (!lateralGuidance[0]) {
            return lateralGuidance;
        }

        if (!verticalGuidance[0]) {
            return verticalGuidance;
        }

        this.approachGuidance = null;
        this.cancelHoldingPattern();
        this._fms.setArrivalRunway(runwayModel);
        this.hasApproachClearance = true;

        const readback = {};
        readback.log = `cleared ${approachType.toUpperCase()} runway ${runwayModel.name} approach`;
        readback.say = `cleared ${approachType.toUpperCase()} runway ${radio_runway(runwayModel.name)} approach`;

        return [true, readback];
    }

    // TODO: Add ability to hold at present position
    /**
     * Conduct a holding pattern at a specific fix
     *
     * @for Fms
     * @method initiateHoldingPattern
     * @param fixName {string} name of the fix to hold over
     * @param holdParameters {object} parameters to apply to WaypointModel._holdParameters
     * @param fallbackInboundHeading {number} the inboundHeading that is used if no default is available
     * @return {array} [success of operation, readback]
     */
    initiateHoldingPattern(fixName, holdParameters, fallbackInboundHeading) {
        const [success, responseValue] = this._fms.activateHoldForWaypointName(fixName, holdParameters, fallbackInboundHeading);

        if (!success) {
            return [success, responseValue];
        }

        // When successful, the responseValue contains the actual holdParameters used by the
        // `WaypointModel`. This means that we can send partial holdParameters, to patch
        // the `WaypointModel`s _holdParameters property
        holdParameters = responseValue;

        const radialText = heading_to_string(holdParameters.inboundHeading + Math.PI);
        const cardinalDirectionFromFix = getRadioCardinalDirectionNameForHeading(holdParameters.inboundHeading);
        const holdParametersReadback = `${holdParameters.turnDirection} turns, ${holdParameters.legLength} legs`;
        const radialReadbackLog = `on the ${radialText} radial`;
        const radialReadbackSay = `on the ${radio_heading(radialText)} radial`;

        // force lower-case in verbal readback to get speech synthesis to pronounce the fix instead of spelling it
        return [true, {
            log: `hold ${cardinalDirectionFromFix} of ${fixName.toUpperCase()} ${radialReadbackLog}, ${holdParametersReadback}`,
            say: `hold ${cardinalDirectionFromFix} of ${NavigationLibrary.getFixSpokenName(fixName)} ` +
                `${radialReadbackSay}, ${holdParametersReadback}`
        }];
    }

    /**
     * Initialize all autopilot systems after being given an IFR clearance to destination
     *
     * @for Pilot
     * @method configureForTakeoff
     * @param initialAltitude {number} the altitude aircraft can automatically climb to at this airport
     * @param runway {RunwayModel} the runway taking off on
     * @param cruiseSpeed {number} the cruise speed of the aircraft, in knots
     */
    configureForTakeoff(initialAltitude, runway, cruiseSpeed) {
        if (this._mcp.altitude === INVALID_NUMBER) {
            this._mcp.setAltitudeFieldValue(initialAltitude);
        }

        if (this._mcp.altitudeMode === MCP_MODE.ALTITUDE.OFF) {
            this._mcp.setAltitudeHold();
        }

        if (this._mcp.heading === INVALID_NUMBER) {
            this._mcp.setHeadingFieldValue(runway.angle);
        }

        if (this._mcp.headingMode === MCP_MODE.HEADING.OFF) {
            this._mcp.setHeadingLnav();
        }

        if (this._mcp.speed === INVALID_NUMBER) {
            this._mcp.setSpeedFieldValue(cruiseSpeed);
        }

        if (this._mcp.speedMode === MCP_MODE.SPEED.OFF) {
            this._mcp.setSpeedN1();
        }
    }

    /**
     * Skip ahead in the FMS to the waypoint for the specified waypointName, and activate LNAV to fly to it
     *
     * @for Pilot
     * @method proceedDirect
     * @param waypointName {string}  name of the fix we are flying direct to
     * @return {array}               [success of operation, readback]
     */
    proceedDirect(waypointName, aircraftModel = null) {
        if (aircraftModel && aircraftModel.rules === FLIGHT_RULES.VFR) {
            const targetName = waypointName.toUpperCase();
            const fix = NavigationLibrary.findFixByName(targetName);
            const inLibrary = Boolean(fix && fix.isRealFix);
            const inFms = !targetName.startsWith('_') && this._fms.hasWaypointName(targetName);

            if (!inLibrary && !inFms) {
                const readback = {
                    log: `cannot proceed direct to ${targetName}, unknown fix`,
                    say: `cannot proceed direct to ${NavigationLibrary.getFixSpokenName(targetName)}, unknown fix`
                };
                return [false, readback];
            }

            if (inLibrary) {
                const [replaced, response] = this._fms.replaceFlightPlanWithNewRoute(targetName);

                if (!replaced) {
                    return [false, response];
                }
            } else {
                this._fms.skipToWaypointName(targetName);
            }

            aircraftModel.vfrOrbit = null;
            this.cancelHoldingPattern();
            this._mcp.setHeadingLnav();

            const readback = {
                log: `proceed direct ${targetName}`,
                say: `proceed direct ${NavigationLibrary.getFixSpokenName(targetName)}`
            };
            return [true, readback];
        }

        if (!this._fms.hasWaypointName(waypointName)) {
            const readback = {
                log: `cannot proceed direct to ${waypointName}, it does not exist in our flight plan`,
                say: `cannot proceed direct to ${NavigationLibrary.getFixSpokenName(waypointName)}, ` +
                    'it does not exist in our flight plan'
            };
            return [false, readback];
        }

        this._fms.skipToWaypointName(waypointName);
        this.cancelHoldingPattern();
        this._mcp.setHeadingLnav();

        const readback = {
            log: `proceed direct ${waypointName}`,
            say: `proceed direct ${NavigationLibrary.getFixSpokenName(waypointName)}`
        };
        return [true, readback];
    }

    /**
     * End of takeoff, stop hand flying, and give the autopilot control of the aircraft
     *
     * Note: This should be done when the phase changes from takeoff to climb
     * Note: The 'raise landing gear' portion has no relevance, and exists solely for specificity of context
     *
     * @for Pilot
     * @method raiseLandingGearAndActivateAutopilot
     */
    raiseLandingGearAndActivateAutopilot() {
        this._mcp.enable();
    }

    /**
     * Replace the entire route with a new one built from the provided route string
     *
     * @for Pilot
     * @method replaceFlightPlanWithNewRoute
     * @param routeString {string}  routeString defining the new route to use
     * @return {array}              [success of operation, readback]
     */
    replaceFlightPlanWithNewRoute(routeString) {
        const readback = this._fms.replaceFlightPlanWithNewRoute(routeString);

        if (readback[0]) {
            this.hasDepartureClearance = true;
        }

        return readback;
    }

    /**
     * Return the altitude the aircraft is currently assigned. May be moving toward this altitude,
     * or already established at that altitude.
     *
     * @for Pilot
     * @method sayTargetedAltitude
     * @return {Array} [success of operation, readback]
     */
    sayTargetedAltitude() {
        const readback = {};
        readback.log = `we're assigned ${this._mcp.altitude}`;
        readback.say = `we're assigned ${radio_altitude(this._mcp.altitude)}`;

        return [true, readback];
    }

    /**
     * Return the heading the aircraft is currently targeting. May be moving toward this heading,
     * or already established at that heading.
     *
     * @for Pilot
     * @method sayTargetHeading
     * @return {array} [success of operation, readback]
     */
    sayTargetHeading() {
        const readback = {};

        switch (this._mcp.headingMode) {
            case MCP_MODE.HEADING.HOLD:
                readback.log = `we're assigned heading ${this._mcp.headingInDegrees}`;
                readback.say = `we're assigned heading ${radio_heading(this._mcp.headingInDegrees)}`;

                return [true, readback];

            case MCP_MODE.HEADING.VOR_LOC:
                readback.log = `we're joining a course of ${this._mcp.course}`;
                readback.say = `we're joining a course of ${radio_heading(this._mcp.course)}`;

                return [true, readback];

            case MCP_MODE.HEADING.LNAV: {
                const waypoint = this._fms.currentWaypoint;
                const waypointPosition = waypoint.positionModel;
                const bearing = Math.round(radiansToDegrees(this.positionModel.bearingToPosition(waypointPosition)));

                readback.log = `our on-course heading to ${waypoint.getDisplayName()} is ${bearing}`;
                readback.say = 'our on-course heading to ' +
                    `${NavigationLibrary.getFixSpokenName(waypoint.getDisplayName())} is ${radio_heading(bearing)}`;

                return [true, readback];
            }

            default:
                readback.log = 'we haven\'t been assigned a heading';
                readback.say = 'we haven\'t been assigned a heading';

                return [true, readback];
        }
    }

    /**
     * Return the speed the aircraft is currently assigned. May be moving toward this speed, or
     * already established at this speed.
     *
     * @for Pilot
     * @method sayTargetedSpeed
     */
    sayTargetedSpeed() {
        // TODO: How do we handle the cases where aircraft are using VNAV speed?
        return [true, this._mcp.speed];
    }

    /**
     * Stop taxiing to the runway and return to the gate
     *
     * @for Pilot
     * @method stopOutboundTaxiAndReturnToGate
     * @return {Array} [success of operation, readback]
     */
    stopOutboundTaxiAndReturnToGate() {
        this._fms.flightPhase = FLIGHT_PHASE.APRON;
        // TODO: What to do with this little number....?
        // aircraft.taxi_start = 0;

        return [true, 'taxiing back to the gate'];
    }

    /**
     * Leave the departure line and return to the gate
     *
     * @for Pilot
     * @method stopWaitingInRunwayQueueAndReturnToGate
     * @return {Array} [success of operation, readback]
     */
    stopWaitingInRunwayQueueAndReturnToGate() {
        // TODO: this will likely need to be called from somewhere other than the `AircraftCommander`
        // TODO: remove aircraft from the runway queue (`Runway.removeAircraftFromQueue()`)
        this._fms.flightPhase = FLIGHT_PHASE.APRON;

        return [true, 'taxiing back to the gate'];
    }
}
