import test from 'ava';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import ControllerConfigModel from '../../src/assets/scripts/client/controller/ControllerConfigModel';
import {
    resolveControllerRadioName,
    deriveAustralianControllerCallsign
} from '../../src/assets/scripts/client/constants/controllerConstants';
import yssyData from '../../assets/airports/yssy.json';

test('known Australian facilities resolve to their spoken radio names', (t) => {
    t.is(resolveControllerRadioName({ callsign: 'WS_APP' }), 'Walton Approach');
    t.is(resolveControllerRadioName({ callsign: 'ML_APP' }), 'Melbourne Approach');
    t.is(resolveControllerRadioName({ callsign: 'SY_APP' }), 'Sydney Approach');
    t.is(resolveControllerRadioName({ callsign: 'HB_APP' }), 'Hobart Approach');
    t.is(resolveControllerRadioName({ callsign: 'WLM_APP' }), 'Williamtown Approach');
    t.is(resolveControllerRadioName({ callsign: 'YMMM' }), 'Melbourne Centre');
    t.is(resolveControllerRadioName({ callsign: 'YBBB' }), 'Brisbane Centre');
    t.is(resolveControllerRadioName({ callsign: 'SY_TWR' }), 'Sydney Tower');
});

test('resolver prefers explicit radioName and falls back to compact identifiers', (t) => {
    t.is(resolveControllerRadioName({ callsign: 'ZZ_APP', radioName: 'Custom Radar' }), 'Custom Radar');
    t.is(resolveControllerRadioName({ icao: 'YZZZ', type: 'APP' }), 'Approach');
    t.is(deriveAustralianControllerCallsign('YSSY', 'APP'), 'SY_APP');
    t.is(deriveAustralianControllerCallsign('YWLM', 'TWR'), 'WLM_TWR');
});

test('YSSY airport config exposes compact callsigns and spoken radio names', (t) => {
    const airport = new AirportModel(yssyData);
    const config = airport.controllerConfig;

    t.true(config instanceof ControllerConfigModel);
    t.is(config.getApproach().callsign, 'SY_APP');
    t.is(config.getApproach().radioName, 'Sydney Approach');
    t.is(config.getDeparture().callsign, 'SY_DEP');
    t.is(config.getDeparture().radioName, 'Sydney Control');
    t.is(config.tower[0].callsign, 'SY_TWR');
    t.is(config.tower[0].radioName, 'Sydney Tower');
    t.is(config.centre[0].callsign, 'YMMM');
    t.is(config.centre[0].radioName, 'Melbourne Centre');
    t.is(config.centre.length, 1);
    const panel = config.getAdjacentFrequencyList({ includeLocal: true });
    t.true(panel.some((entry) => entry.callsign === 'SY_APP' && entry.radioName === 'Sydney Approach'));
    t.true(panel.some((entry) => entry.callsign === 'YMMM' && entry.radioName === 'Melbourne Centre'));
});

test('Australian fallback keeps compact IDs in callsigns and resolves speech separately', (t) => {
    const config = new ControllerConfigModel(null, {
        icao: 'YMHB',
        radio: { app: 'HB_APP', twr: 'HB_TWR' },
        runways: [{ name: '12' }]
    });

    t.is(config.approach.callsign, 'HB_APP');
    t.is(config.approach.radioName, 'Hobart Approach');
    t.is(config.tower[0].callsign, 'HB_TWR');
    t.is(config.tower[0].radioName, 'Hobart Tower');
    t.is(config.centre[0].callsign, 'YMMM');
    t.is(config.getRadioNameForController(config.centre[0]), 'Melbourne Centre');
    t.true(config.getAdjacentFrequencyList({ includeLocal: true }).every((entry) => !/Centre|Approach|Tower/.test(entry.callsign)));
});

test('DAT manual radio names are preserved through user overrides', (t) => {
    const config = new ControllerConfigModel(null, {
        icao: 'YXXX',
        controllerRadioNames: { approach: 'Custom Approach', tower: 'Custom Tower' }
    });

    config.applyUserOverrides({
        approach: { frequency: '123.700' },
        tower: { frequency: '118.100' }
    });

    t.is(config.approach.frequency, '123.700');
    t.is(config.approach.radioName, 'Custom Approach');
    t.is(config.tower[0].radioName, 'Custom Tower');
});

test('airport switching resets simulated controllers', (t) => {
    const airport = new AirportModel(yssyData);
    airport.towerController._arrivals.add('QFA412');
    airport.centreController._aircraft.add('QFA412');

    airport.towerController.reset();
    airport.centreController.reset();

    t.is(airport.towerController._arrivals.size, 0);
    t.is(airport.centreController._aircraft.size, 0);
});
