import { selectLanguage } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { en } from '../src/localization/en';
import { presentConfigurationError, presentMessage } from '../src/localization/messages';
import { validateTariff } from '../src/domain/fare/tariff';
import { getActiveTariff } from '../src/config/tariffs';
import { TripExport } from '../src/components/TripExport';
import { Warnings, km, minutes, range, tnd } from '../src/components/ui';
import { validateManual } from '../src/domain/trip/tripInput';

afterEach(cleanup);

beforeEach(() => { selectLanguage('en'); });

describe('English presentation boundaries', () => {
  it('presents configuration reasons without changing diagnostic field names, validator outputs or unknown errors', () => {
    const errors = validateTariff({ ...getActiveTariff(), initialFare: .5, distanceStepMeters: Infinity,
      nightMultiplier: NaN, switchingSpeedKmh: -1, utcOffsetMinutes: Infinity, nightStart: '<synthetic>' });
    const before = [...errors];
    expect(errors.map(presentConfigurationError)).toEqual(before);
    expect(errors).toEqual(before); expect(errors).toHaveLength(6);
    expect(presentConfigurationError('Unknown future diagnostic')).toBe('Unknown future diagnostic');
  });
  it('keeps dynamic sentences complete, including both night-initial branches and optional provenance', () => {
    expect(en.about.nightExplanation('21:00', '05:00')).toBe('Night rate is applied to the part of the ride between 21:00 and 05:00.');
    expect(en.about.initialNightExplanation(true)).toBe('The initial charge is multiplied when the ride starts at night. That treatment is not officially verified.');
    expect(en.about.initialNightExplanation(false)).toBe('The initial charge is not multiplied when the ride starts at night. That treatment is not officially verified.');
    expect(en.shared.tariffNotice(undefined)).toBe('Tariff not officially verified. ');
    expect(en.shared.tariffNotice('Synthetic notice')).toBe('Tariff not officially verified. Synthetic notice');
  });

  it('leaves the existing precision, signs and unit formatting with their original formatters', () => {
    expect(tnd(7777)).toBe('7.777 TND'); expect(range(7000, 8000)).toBe('7.000 – 8.000 TND');
    expect(minutes(119)).toBe('2 min'); expect(km(1250)).toBe('1.3 km');
    expect(en.history.estimated('7.8')).toBe('Estimated: 7.8 TND');
    expect(en.history.meterComparison('9.1', '+17.3')).toBe('Meter: 9.1 TND · Difference: +17.3%');
    expect(en.result.comparisonDifference('-0.001', '-0.1')).toBe('-0.001 TND (-0.1%)');
  });

  it('renders a dynamic export label as escaped text and retains its region, focus and privacy associations', () => {
    const label = 'Export <img src=x onerror=alert(1)> & "fixture"';
    render(createElement(TripExport, { label, name: 'synthetic.json', format: 'json', trips: [] }));
    const button = screen.getByRole('button', { name: label }); fireEvent.click(button);
    const title = screen.getByRole('heading', { name: `${label} options` });
    expect(document.activeElement).toBe(title);
    expect(screen.getByRole('region', { name: `${label} options` }).id).toBe(button.getAttribute('aria-controls'));
    expect(document.querySelector('img')).toBeNull();
    const checkbox = screen.getByRole('checkbox');
    expect(document.getElementById(checkbox.getAttribute('aria-describedby')!)?.textContent).toContain('excluded by default');
    fireEvent.click(screen.getByRole('button', { name: 'Close export options' }));
    expect(document.activeElement).toBe(button);
  });

  it('presents domain validation without changing raw messages or field-identity contracts', () => {
    const errors = validateManual({ distanceKm: 501, durationMin: 0, startMs: NaN, stoppedMin: 1,
      supplements: { airportDeparture: false, luggageItems: .5 } });
    const before = [...errors];
    expect(errors.map(presentMessage)).toEqual(before);
    expect(errors).toEqual(before); expect(errors.length).toBe(5);
  });

  it('recognizes only complete legacy warning shapes and preserves unknown historical text verbatim', () => {
    const messages = ['2 GPS position(s) were discarded as implausible jumps.', 'Average GPS accuracy was poor (about 43 m).',
      'Future warning <img src=x>', 'toString', '__proto__', ' 2 GPS position(s) were discarded as implausible jumps.'];
    expect(messages.map(presentMessage)).toEqual(messages);
    render(createElement(Warnings, { items: messages }));
    expect(document.querySelector('img')).toBeNull(); expect(screen.getAllByRole('listitem')).toHaveLength(messages.length);
    expect(screen.getByText('Future warning <img src=x>')).toBeTruthy();
    expect(messages[0]).toBe('2 GPS position(s) were discarded as implausible jumps.');
  });
});
