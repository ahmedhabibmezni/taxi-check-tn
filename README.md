# Taxi Check TN

An independent fare-estimation app for Tunisian individual taxis. Record a live ride or enter distance and time manually, compare an estimate with the driver's meter, and revisit saved trips offline.

This is not an official service, certified taximeter, booking app or proof of overcharging. Configured tariff values and several meter assumptions are not officially verified. A review date is not an effective date.

## Current capabilities

- Android app and installable web app built with React, TypeScript, Vite and Capacitor.
- Tunisian Darija by default, with separate Modern Standard Arabic, French and English options. All catalogs are bundled offline; translations remain drafts pending qualified review.
- Live/manual estimates, neutral meter comparisons and explicit uncertainty.
- Local History with deliberate deletion, compatible historical readers and visible storage errors.
- JSON/CSV exports with precise endpoints excluded by default and deliberate inclusion per export. Native attempts stage separate private-cache snapshots.
- Recovery safeguards for interrupted rides, unavailable tariffs and unresolved active-data cleanup.

iOS delivery, a passenger-focused redesign and designed card/QR sharing through an expiring bearer-link service are planned. They are not implemented by the current Android/web application. Existing exports remain available. There are currently no accounts, application backend, analytics, ads, payments or history synchronization.

## Development

Use Node 22.12+ or Node 24 and the checked-in lockfile.

```bash
npm ci
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

Typecheck does not emit files. The production web build writes `dist/`. See [ANDROID.md](ANDROID.md) for native commands and validation limits. Run `npm run icons` only when intentionally updating icons; it also updates Android launcher images when the native project exists.

Tests cover fare boundaries, uncertainty/GPS filtering, timezone handling, tariff validation, storage/recovery failures, saving, exports and localization. Browser/native mocks are not physical-device validation.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/domain/` | Pure fare calculations, trip inputs, GPS analysis and record construction |
| `src/config/` | Versioned tariffs, estimation assumptions and comparison thresholds |
| `src/hooks/useLiveRide.ts` | Ride lifecycle and cleanup/recovery coordination |
| `src/services/geolocation/` | Native and browser location adapters |
| `src/storage/` | Completed IndexedDB History and local active/recovery state |
| `src/pages/`, `src/components/` | Screen and interaction presentation |
| `src/localization/` | Four typed offline catalogs, language preference and direction |
| `android/` | Android source, resources, Gradle wrapper and platform configuration |
| `tests/` | Behavioral regressions |

## Tariffs and calculations

Monetary values use integer millimes: 0.900 TND is `900`. Definitions live in [src/config/tariffs/index.ts](src/config/tariffs/index.ts). Preserve existing tariff IDs and definitions so historical results remain explainable. Never silently reprice saved trips or substitute another tariff for an unavailable recorded definition.

Changing values requires authoritative evidence of category, territory, effective date and rules. A proposal is not an enacted tariff. A tariff table does not establish a meter's switching/rounding algorithm. Invalid configuration and legally unverified configuration are distinct states.

The current model charges distance or waiting time at each interval, derives a crossover when no verified switching speed exists, and rounds day/night buckets separately. Initial-night treatment, fractional carryover and actual meter behavior remain unverified assumptions. The displayed range is a scenario range, not a statistical confidence interval or guaranteed fare. Input-quality scores do not certify accuracy.

## Data and privacy

Active progress includes location samples for recovery. Completed live trips may retain endpoint coordinates locally until users delete them. Excluding coordinates from an export does not remove them from local History. Dates, times and fares can still be sensitive.

The app has no current backend or analytics. Location also uses device/browser providers, including Google Play services on Android, under their own settings and policies. Explicit sharing transfers a file to a chosen destination. Local deletion does not retract recipient copies or necessarily remove prepared exports. Native snapshots have no application-managed expiry/cleanup; the OS may evict cache files.

Planned card links require a separate upload preview and explicit creation action. Endpoints, raw GPS and full History must not upload by default. Anyone possessing a bearer link can open it; it is not an authenticated recipient restriction. Hosting, expiry and deletion details are not yet implemented.

## Recovery and release limits

End/discard requests watcher shutdown independently of storage cleanup. Active cleanup, History saving and native service cessation are separate outcomes. Notification disappearance or personal acknowledgment is not shutdown proof.

Verified persisted cleanup intent blocks restoration while cleanup is pending. If intent cannot be persisted/verified, this session blocks new recording but a later reload may restore indistinguishable compatible progress. Unsaved results/edits are not promised across process loss. Unreadable records are not automatically repaired, deleted or repriced.

Android recording depends on permissions and platform/device restrictions. Browsers may pause GPS when backgrounded or locked. Manual calculation needs no GPS. Web geolocation/service workers require a secure context; localhost supports local development.

The working name/logo are provisional. Current builds are debug/test candidates. Physical GPS/background/recovery/sharing, accessibility/comprehension and independent language review remain pending. Public release also needs authenticated tariff evidence, privacy/legal review, publisher/support details, owner-held signing and current store checks.

Do not commit credentials, signing material, personal trips, generated builds or local diagnostics. Preserve required third-party copyright/license notices. The existing GitHub Pages workflow deploys on pushes to `main`; a local commit alone does not publish the app.
