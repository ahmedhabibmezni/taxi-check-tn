# Android development

Taxi Check TN packages its web assets inside an Android application using Capacitor. Ordinary Manual/History functions remain offline; live recording depends on location permissions and providers.

## Toolchain and build

Use Node 22.12+ or Node 24, Java 21, Android SDK platform/build tools 36 and the checked-in Gradle wrapper. Set `JAVA_HOME` and `ANDROID_HOME` for your environment. If set, `ANDROID_SDK_ROOT` should identify the same SDK. Keep `android/local.properties` machine-specific and untracked. Optional `.tools/` caches are local; do not copy absolute developer paths into configuration.

```powershell
npm ci
npm test
npm run typecheck
npm run build
node node_modules/@capacitor/cli/bin/capacitor sync android
.\android\gradlew.bat -p android :app:assembleDebug :app:lintDebug --console=plain --max-workers=2
```

Add `--offline` to Gradle for a fully cached toolchain. Cache misses require deliberate preparation, not silent dependency/SDK upgrades. The output is `android/app/build/outputs/apk/debug/app-debug.apk`. `npm run android:open` opens Android Studio. Sync copies web assets and updates generated plugin integration; review authored changes separately.

`npm run android:apk` is a convenience script that runs tests, regenerates icons, builds/syncs, assembles/lints, and overwrites `artifacts/taxi-check-tn.apk`. Use the separate commands above to preserve old artifacts or avoid icon regeneration. Generated APKs, checksums, source manifests, caches and copied web assets stay outside Git. Name retained candidates distinctly and record SHA-256/source/test identity.

On Windows, if Vitest temporary-file rename is denied, use a writable directory through process-scoped `TEMP`/`TMP`. Do not disable security controls or change global settings. Report actual executed assertions.

## Package and signing

Current configuration: `tn.taxicheck.app`, versionName `1.0`, versionCode `1`, min API 24 and target/compile API 36. Debug assembly uses the local debug signing configuration, not a production signature or Play artifact.

Production credentials belong to the owner. Never commit keystores, private keys, passwords or provisioning files. Matching local APK certificates do not establish compatibility with an unidentified installation.

Before separately approved installation/update, identify the profile/device, installed package/version/signature and whether personal History or an active/recovered ride exists. Never uninstall, clear storage or overwrite an incompatible installation to bypass a signature issue. Fresh-profile tests need an isolated environment. No phone operation is implied by these instructions.

## Recording and recovery

Live recording uses an Android foreground location service through the installed background-geolocation plugin and Google Play services. Notifications are handled separately from location permission. The interface explains possible background/locked-screen recording before Start. Manual works without GPS.

End/discard requests stop of watchers known to the current runtime. Late callbacks are ignored, but provider/service cessation needs device evidence. Notification disappearance and a user assertion are not shutdown proof.

Active cleanup verifies absence and records unresolved cleanup using the existing recovery key. Retry does not restart recording or create/save another result. Native recovery after failure retains its durable guard until the existing acknowledgment path permits continuation. Compatible interruptions and immutable historical tariffs remain supported.

If cleanup intent cannot be persisted/verified, session blocking cannot guarantee protection after reload. Retained compatible data may later restore. Unsaved results/edits are not guaranteed across process loss. Test active cleanup, History saving and native cessation separately.

## Data and sharing

Active progress stores collected samples locally. History retains available endpoints until individual deletion. Exports exclude endpoints by default; explicit per-export inclusion is available. Other details remain sensitive.

Each native export stages a separate private-cache file before sharing, retaining its visible basename. Later attempts do not overwrite that snapshot, but Android may evict it and the app sets no expiry/cleanup. Sharing return does not confirm recipient delivery. Local deletion does not retract recipient copies or necessarily remove prepared files.

Language selection does not restart a running native service. New notification text applies on its next normal start. All four catalogs require qualified review and physical accessibility/comprehension checks.

## Validation and release

Web tests, typecheck/build, native sync, debug assembly and lint are automated/build evidence. They do not establish physical first launch, GPS, background reliability, recovery, cessation, recipient access or TalkBack acceptance. Existing icon/splash/resource warnings still need release disposition.

Use synthetic records in isolated validation environments, preserve personal data and tie observations to a candidate hash. No phone testing is currently requested; hands-on acceptance requires explicit resumption.

iOS delivery and designed card/QR sharing are planned, not present in this baseline. Final publisher/support/domain, hosted-card details, owner-held signing, privacy/legal review and current store requirements remain release work. Do not change package IDs or upload keys merely to prepare a debug candidate.
