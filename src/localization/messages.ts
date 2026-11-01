import { en as english } from './en';
import { getMessages } from './index';
import type { Messages } from './types';

// Legacy domain outputs and saved warnings are data, not catalog keys. Keep unknown text visible unchanged.
const legacyMessages = new Map<string, (messages: Messages) => string>([
  ['Distance is required.', messages => messages.validation.distanceRequired],
  ['Distance must be between 0 and 500 km.', messages => messages.validation.distanceBounds],
  ['Duration is required.', messages => messages.validation.durationRequired],
  ['Duration must be between 1 and 600 minutes.', messages => messages.validation.durationBounds],
  ['Stopped time must be between 0 and the total duration.', messages => messages.validation.stoppedBounds],
  ['A trip with distance must include some moving time.', messages => messages.validation.movingRequired],
  ['Start date/time is invalid.', messages => messages.validation.invalidStart],
  ['Luggage items must be a whole number from 0 to 10.', messages => messages.validation.luggageBounds],
  ['Waiting time was not provided, so this estimate uses a range.', messages => messages.messages.waitingUnknown],
  ['No usable GPS position was received. The estimate is based on time only; use the manual calculator if you know the distance.', messages => messages.messages.noGps],
  ['Estimate has limited accuracy because GPS data was incomplete.', messages => messages.messages.limitedGps],
  ['Not enough reliable data about this ride to compare.', messages => messages.messages.insufficientComparison],
  ['Check that supplements (airport, luggage) and the night tariff were applied as expected.', messages => messages.messages.checkSupplements],
  ['Estimate has limited accuracy, treat this comparison with caution.', messages => messages.messages.cautiousComparison],
]);

export function presentMessage(message: string): string {
  for (const key of Object.keys(english.rideFeedback) as (keyof typeof english.rideFeedback)[]) {
    if (english.rideFeedback[key] === message) return getMessages().rideFeedback[key];
  }
  for (const key of ['couldNotReadTheTripHistory', 'couldNotDeleteTheTrip'] as const) {
    if (english.history[key] === message) return getMessages().history[key];
  }
  const en = getMessages();
  const known = legacyMessages.get(message);
  if (known !== undefined) return known(en);
  const discarded = /^(\d+) GPS position\(s\) were discarded as implausible jumps\.$/.exec(message);
  if (discarded) return en.messages.discardedPositions(discarded[1]);
  const accuracy = /^Average GPS accuracy was poor \(about (\d+) m\)\.$/.exec(message);
  if (accuracy) return en.messages.poorAccuracy(accuracy[1]);
  return message;
}

export function presentConfigurationError(message: string): string {
  const en = getMessages();
  const money = /^(initialFare|distanceStepFare|waitingStepFare|airportSupplement|luggageSupplement) must be a finite non-negative safe integer number of millimes$/.exec(message);
  if (money) return en.configuration.monetaryUnits(money[1]);
  const step = /^(distanceStepMeters|waitingStepSeconds) must be finite and > 0$/.exec(message);
  if (step) return en.configuration.positiveStep(step[1]);
  const rate = /^(distanceStepMeters|waitingStepSeconds) must yield a finite reciprocal and unit rate for (distanceStepFare|waitingStepFare)$/.exec(message);
  if (rate) return en.configuration.finiteRate(rate[1], rate[2]);
  const night = /^nightMultiplier makes the rounded night amount for (initialFare|distanceStepFare|waitingStepFare) exceed safe integer millimes$/.exec(message);
  if (night) return en.configuration.nightAmount(night[1]);
  const timeFormat = /^Invalid time "(.*)", expected HH:MM$/.exec(message);
  if (timeFormat) return en.configuration.invalidTimeFormat(timeFormat[1]);
  const time = /^Invalid time "(.*)"$/.exec(message);
  if (time) return en.configuration.invalidTime(time[1]);
  const fixed = new Map<string, (messages: Messages) => string>([
    ['nightMultiplier must be finite and >= 1', messages => messages.configuration.nightMultiplier],
    ['switchingSpeedKmh must be finite and > 0 when set, with a positive m/s conversion', messages => messages.configuration.switchingSpeed],
    ['utcOffsetMinutes must be finite numeric minutes representable as safe integer milliseconds', messages => messages.configuration.utcOffset],
    ['Derived switching speed must be finite and > 0; set switchingSpeedKmh or correct the distance/waiting rates', messages => messages.configuration.derivedSpeed],
  ]);
  return fixed.get(message)?.(en) ?? message;
}
