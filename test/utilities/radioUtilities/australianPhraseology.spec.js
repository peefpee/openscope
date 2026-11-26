import ava from 'ava';

import {
    radio_frequencySpoken,
    radio_flightLevelSpoken,
    radio_squawkSpoken,
    radio_speedSpoken,
    radio_approachSpoken,
    radio_procedureSpoken,
    radio_spokenText
} from '../../../src/assets/scripts/client/utilities/radioUtilities';

ava('.radio_frequencySpoken() speaks a numeric frequency one digit at a time', (t) => {
    t.true(radio_frequencySpoken(120.5) === 'one two zero decimal five');
});

ava('.radio_frequencySpoken() preserves three printed decimal places', (t) => {
    t.true(radio_frequencySpoken('132.000') === 'one three two decimal zero zero zero');
});

ava('.radio_frequencySpoken() preserves trailing zeros in the printed decimals', (t) => {
    t.true(radio_frequencySpoken('118.850') === 'one one eight decimal eight five zero');
});

ava('.radio_frequencySpoken() speaks one or two printed decimals as given', (t) => {
    t.true(radio_frequencySpoken('119.2') === 'one one niner decimal two');
    t.true(radio_frequencySpoken('119.25') === 'one one niner decimal two five');
});

ava('.radio_flightLevelSpoken() accepts an FL-prefixed flight level', (t) => {
    t.true(radio_flightLevelSpoken('FL230') === 'flight level two three zero');
});

ava('.radio_flightLevelSpoken() accepts a numeric flight level', (t) => {
    t.true(radio_flightLevelSpoken(230) === 'flight level two three zero');
});

ava('.radio_flightLevelSpoken() converts a five-digit altitude to a flight level', (t) => {
    t.true(radio_flightLevelSpoken(23000) === 'flight level two three zero');
});

ava('.radio_squawkSpoken() speaks a four-digit squawk code one digit at a time', (t) => {
    t.true(radio_squawkSpoken(2401) === 'two four zero one');
});

ava('.radio_speedSpoken() speaks a numeric speed one digit at a time', (t) => {
    t.true(radio_speedSpoken(250) === 'two five zero');
});

ava('.radio_speedSpoken() speaks a string speed one digit at a time', (t) => {
    t.true(radio_speedSpoken('120') === 'one two zero');
});

ava('.radio_approachSpoken() speaks an ILS approach with a runway side', (t) => {
    t.true(radio_approachSpoken('ILS34L') === 'ILS three four left');
});

ava('.radio_approachSpoken() speaks an RNAV approach', (t) => {
    t.true(radio_approachSpoken('RNAV12') === 'ar nav one two');
});

ava('.radio_approachSpoken() speaks a visual approach', (t) => {
    t.true(radio_approachSpoken('VIS 34') === 'visual three four');
});

ava('.radio_approachSpoken() leaves already-spoken words unchanged', (t) => {
    t.true(radio_approachSpoken('ILS three four left') === 'ILS three four left');
    t.true(radio_approachSpoken('visual three four') === 'visual three four');
});

ava('.radio_approachSpoken() falls back to spelling digits in an unknown approach', (t) => {
    t.true(radio_approachSpoken('NDB 27') === 'NDB two seven');
});

ava('.radio_procedureSpoken() speaks a procedure name and its number', (t) => {
    t.true(radio_procedureSpoken('KEVIN7') === 'KEVIN SEVEN');
    t.true(radio_procedureSpoken('AVMOV1') === 'AVMOV ONE');
    t.true(radio_procedureSpoken('MARLN6') === 'MARLN SIX');
});

ava('.radio_procedureSpoken() leaves an already-spoken procedure unchanged', (t) => {
    t.true(radio_procedureSpoken('kevin seven') === 'kevin seven');
});

ava('.radio_spokenText() formats a complete Australian phraseology example', (t) => {
    const text = 'QFA412 squawk 2401 heading 270 climb FL230 and 5000ft then contact 132.000 for runway 34L RNAV approach';
    const expected = 'QFA412 squawk two four zero one heading two seven zero climb flight level two three zero and five thousand then contact one three two decimal zero zero zero for runway three four left ar nav approach';

    t.true(radio_spokenText(text) === expected);
});

ava('.radio_spokenText() leaves already-spoken phrases and callsigns unchanged', (t) => {
    const text = 'QFA412 climb and maintain five thousand, turn heading two seven zero';

    t.true(radio_spokenText(text) === text);
});
