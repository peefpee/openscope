import test from 'ava';
import sinon from 'sinon';
import AircraftModel from '../../src/assets/scripts/client/aircraft/AircraftModel';
import AircraftTypeDefinitionModel from '../../src/assets/scripts/client/aircraft/AircraftTypeDefinitionModel';
import AirportController from '../../src/assets/scripts/client/airport/AirportController';
import AirportModel from '../../src/assets/scripts/client/airport/AirportModel';
import { _selectVoice } from '../../src/assets/scripts/client/speech';
import { radio_spokenText } from '../../src/assets/scripts/client/utilities/radioUtilities';
import UiController from '../../src/assets/scripts/client/ui/UiController';
import a320 from '../../assets/aircraft/a320.json';
import yssyData from '../../assets/airports/yssy.json';
import { ARRIVAL_AIRCRAFT_INIT_PROPS_MOCK } from './_mocks/aircraftMocks';

test('spoken post-processing handles Australian phraseology without renaming callsigns', (t) => {
    t.is(radio_spokenText('Heading 090'), 'Heading zero niner zero');
    t.is(radio_spokenText('Flight level 230'), 'flight level two three zero');
    t.is(radio_spokenText('120.5'), 'one two zero decimal five');
    t.is(radio_spokenText('Runway 34L'), 'Runway three four left');
    t.is(radio_spokenText('5000 feet'), 'five thousand');
    t.is(radio_spokenText('Qantas Four One Two'), 'Qantas Four One Two');
});

test.serial('radioCall keeps compact IDs in the log and radio names in speech', (t) => {
    const airport = new AirportModel(yssyData);
    airport.data = yssyData;
    AirportController.current = airport;
    const plane = new AircraftModel({
        ...ARRIVAL_AIRCRAFT_INIT_PROPS_MOCK,
        model: new AircraftTypeDefinitionModel(a320)
    });
    plane.projected = false;
    const logs = [];
    const spoken = [];
    const uiLogStub = sinon.stub(UiController, 'ui_log').callsFake((message) => logs.push(message));

    global.prop.speech = { enabled: true, synthesis: { getVoices: () => [], speak: () => {} } };
    global.SpeechSynthesisUtterance = class {
        constructor(text) {
            spoken.push(text);
        }
    };
    console.log = (...args) => logs.push(args.join(' '));

    try {
        plane.radioCall('heading 090, flight level 230', 'app');
        const logLine = logs.join(' ');
        t.true(logLine.includes('SY_APP'));
        t.false(logLine.includes('Sydney Approach'));
        t.true(spoken.join(' ').includes('Sydney Approach'));
        t.true(spoken.join(' ').toLowerCase().includes('zero niner zero'));
    } finally {
        uiLogStub.restore();
    }
});

test('speech selects an Australian voice from voice.lang with graceful fallback', (t) => {
    const voices = [
        { name: 'Samantha', lang: 'en_US' },
        { name: 'Karen', lang: 'en-AU' }
    ];

    t.is(_selectVoice({ voice: 'Unknown' }, voices), voices[1]);
    t.is(_selectVoice({ voice: 'Samantha' }, voices), voices[0]);
    t.is(_selectVoice({}, [{ name: 'Default', lang: 'en-GB', default: true }]).default, true);
    t.is(_selectVoice({}, []), null);
});
