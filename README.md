# Taxi Check TN

An installable web app (PWA) that gives an independent fare estimate for a Tunisian individual taxi (`taxi individuel`). You press **START RIDE** when you get in and **END RIDE** when you arrive. Then you type in what the meter shows, and the app tells you whether that amount is consistent with the configured tariff.

It does **not** replace the official taximeter and has no legal value. Everything stays on the phone: no account, no server, no analytics, no tracking.

## Run it

```bash
npm install
npm run dev          # development server
npm test             # unit tests (Vitest)
npm run typecheck    # TypeScript
npm run build        # production build into dist/
npm run preview      # serve dist/ locally on :4173
npm run icons        # regenerate the PNG icons (only if you change the design)
```

## Install on Android

Geolocation and service workers require **HTTPS** (localhost is the only exception). Host `dist/` on any static HTTPS host, for example GitHub Pages, Netlify or Cloudflare Pages. The build uses relative paths, so a sub-folder works too.

1. Open the URL in Chrome on the phone.
2. Menu ⋮, then **Add to Home screen** / **Install app**.
3. Open it once while online. After that it works offline.
4. On your first ride, allow location **while using the app**.

To test from a PC on the same Wi-Fi network you need an HTTPS tunnel, because plain `http://192.168.x.x` blocks GPS.

## Updating the tariff

**File: [`src/config/tariffs/index.ts`](src/config/tariffs/index.ts)**

1. Add a new object to `TARIFFS` and keep the old one, so saved trips remain explainable by their `tariffId`.
2. Enter amounts in **integer millimes** (0.900 TND = `900`, 0.046 TND = `46`).
3. Fill in `effectiveFrom`, `source` and `lastReviewed`. Clear `notice` if the values are confirmed.
4. Set `ACTIVE_TARIFF_ID` to the new id.
5. Run `npm test`. Several tests assert the current values (900 / 46 / 79 m / 18 s), so update them on purpose.

The active tariff is validated at startup, so a malformed tariff fails loudly instead of producing wrong numbers.

Current values (supplied by the user, **effective date not confirmed**): 0.900 TND initial charge, 0.046 TND per 79 m, 0.046 TND per 18 s, ×1.5 from 21:00 to 05:00, 4.500 TND airport departure, 1.000 TND per large luggage item. A 2026 increase was reported but is not confirmed, and the UI says so on the home screen and on the About page.

## Architecture

```
src/
  config/
    tariffs/index.ts       versioned tariffs + ACTIVE_TARIFF_ID   <- edit here
    estimation.ts          modelling assumptions, comparison thresholds, GPS filter settings
  domain/                  pure TypeScript, no React, no browser APIs
    fare/
      tariff.ts            TaxiTariff type, validation, switching/crossover speed
      night.ts             night window (crosses midnight), interval splitting at 21:00 / 05:00
      types.ts             Interval, TripInput, FareEstimate, FareBreakdown
      strategies/          FareCalculationStrategy interface + SingleApplicationStrategy
      calculator.ts        estimateFare(trip, tariff, strategy?)
      compare.ts           neutral meter comparison
    trip/
      gpsTrack.ts          raw GPS fixes -> filtered charging intervals
      tripInput.ts         live / manual data -> TripInput (+ warnings, confidence)
      buildRecord.ts       FareEstimate -> TripRecord for history
  services/geolocation/    watchPosition wrapper, screen wake lock
  storage/                 IndexedDB trip history, localStorage for the in-progress ride
  hooks/useLiveRide.ts     live ride state
  pages/, components/      mobile UI
tests/                     Vitest: fare engine, GPS filter, comparison
```

The fare engine depends on nothing outside `domain/` and `config/`. It works on integer millimes and is fully deterministic.

## Calculation methodology

### Horokilometric model

The trip is converted into a sequence of **intervals**, each with a duration and a distance. The default strategy (`SingleApplicationStrategy`) charges each interval **either** by distance (speed ≥ switching speed) **or** by time (below it), never both. This is how a single-application taximeter works and it avoids double charging. Whether Tunisian meters use exactly this mode is **not verified**. The logic sits behind `FareCalculationStrategy`, so a different behaviour can be dropped in without touching the UI.

**Switching speed.** No verified official value exists, so `switchingSpeedKmh` is left unset. The engine then uses the **crossover speed** implied by the tariff itself, the speed at which both rates cost the same: (46/18 s) ÷ (46/79 m) = 4.39 m/s ≈ **15.8 km/h**. This is a property of the numbers, not a regulation. Set `switchingSpeedKmh` once an official value is known.

**Steps.** Distance and time are converted into whole steps (floor), because a meter only advances in whole increments. Day and night are counted separately. Night steps cost `round(46 × 1.5) = 69` millimes.

**Night.** Intervals are cut at 21:00 and 05:00 local time (fixed UTC+1, configurable), so a ride crossing a boundary pays the night rate only for the part inside the window. Whether the initial charge is also multiplied when the ride starts at night is unverified and set by `nightAppliesToInitialFare` (currently `true`).

**Supplements.** The airport departure and luggage supplements are added as fixed amounts on top.

### Range and confidence

The best estimate comes with a **low–high range**, built from several scenarios:

- the switching speed varied by ±15%,
- the measured distance varied by its error (3% for GPS with full coverage, up to +10% more with gaps, 5% for a typed distance),
- **gaps**, where the split between moving and stopped time is unknown, are bounded mathematically. For a duration T and distance D: low = the cheapest feasible split, best = moving at a typical 30 km/h with the rest stopped, high = moving at 60 km/h with the rest stopped,
- one extra meter step at the top, because the meter may be partway into its next step.

**Confidence** (0–1) reflects data quality: GPS coverage, accuracy, discarded jumps. A manual trip without waiting time gets 0.35, and with waiting time 0.6.

### Manual mode

If you give the stopped time, the trip is modelled as that much waiting plus the distance driven in the remaining time. If you don't, the whole trip is treated as a gap and you get a **range**, with the warning "Waiting time was not provided, so this estimate uses a range." The trip is cut into 12 chunks so a night boundary falls in the right place.

### Comparison

| Meter vs estimate | Status |
|---|---|
| inside [low, high] | Within expected range |
| below low | Below estimate |
| above high by ≤ 10% of the estimate | Slightly above estimate |
| above high by > 10% | Significantly above estimate |
| confidence < 0.2 | Unable to determine reliably |

Thresholds are set in `src/config/estimation.ts`. Below 0.6 confidence, a caution note is added. The wording never accuses anyone.

## GPS filtering

`analyzeTrack()` is a pure function that re-runs over every recorded fix, so a reload gives exactly the same result:

1. **Accuracy.** Fixes with a reported accuracy worse than 50 m are dropped.
2. **Timestamps.** Fixes that are out of order or duplicated are dropped.
3. **Impossible speed.** A fix implying more than 45 m/s (162 km/h) from the anchor is rejected. So is any fix above 20 m/s that implies acceleration over 6 m/s².
4. **Minimum movement (hysteresis).** Distance counts only once the position is further from the anchor than max(5 m, ½ × combined accuracy). Below that, time passes but distance does not. This is what stops jitter at a red light from adding fake kilometres. It also acts as the smoothing step.
5. **Stationary time** is flushed as zero-distance intervals every 10 s.
6. **Gaps.** With no accepted fix for more than 20 s, the hole becomes a `gap` interval. Its distance is bounded between the straight line, ×1.2 (best) and ×1.5 (high). If no later position exists at all, the bound is 0 to 15 m/s × duration, with the measured average speed as the best guess.
7. **Re-anchoring.** After 30 s of nothing but rejected fixes, the newest one becomes the anchor, so one bad first fix can't lock the track.
8. **Doppler speed**, when the phone reports it, is used to classify moving vs slow, because it is more reliable than position differences.

Every threshold lives in `DEFAULT_GPS_FILTER` (`src/config/estimation.ts`).

## Limitations

- **The tariff may be outdated.** The values were supplied by the user and the effective date is unknown. If the meter starts above 0.900 TND, the tariff has probably changed.
- **Switching speed and night rule for the initial charge** are unverified assumptions (see above).
- **Keep the screen on.** Android browsers pause GPS when the screen turns off or the app goes to the background. The app requests a screen wake lock and treats any interruption as a bounded gap, but accuracy drops.
- **GPS distance** tends to slightly *underestimate* winding routes, and urban canyons add noise.
- **Coverage.** The in-progress ride is kept in `localStorage`, so it survives a reload. Clearing site data deletes the history.
- **No guarantee.** An estimate that disagrees with the meter is a reason to check, not proof of anything.

## Tests

`npm test` runs 31 deterministic tests:

- the 15 required scenarios: pure distance, pure waiting, mixed, crossing 21:00, crossing 05:00, airport, luggage, GPS loss, noise and an impossible jump, manual trip without waiting time, zero trip, very short ride, long ride, rounding, meter comparison
- tariff validation and crossover speed
- slow crawl charged by time
- the night window across midnight
- poor-accuracy rejection
- a run with no GPS at all
- order independence
- money parsing
