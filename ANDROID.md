# Android development

## R7 packaged candidate, 2026-11-06

`artifacts/taxi-check-tn-r7-through-postgres-2026-11-06-debug.apk` (5,100,673 bytes), `tn.taxicheck.app` /1.0/code1, min24/target36. SHA-256 `08ec36ee0f528f3855e89409e7fb5edabdaf11fdfa15b47e2f9cf42d58adaaaa`. Companion `.apk.sha256` and `-source.json` identify the candidate and exact dirty source state. Debug certificate SHA-256 `1dc3a827aa6d3052fcd7e3cab7b32b92f641f03c70b9388163d42e31674e6353`, matching prior C5 candidate; installed-app compatibility is not established. Older candidates preserved, superseded for current-source acceptance only.

Fresh application522/522 tests/26files (82.98s), typecheck, production build, Android sync, cached offline assembleDebug/lintDebug PASS. Initial sandbox Gradle attempt failed local daemon connection; approved outside-sandbox retry succeeded in7m14s,326 tasks/40 executed. Process-scoped TEMP/TMP only, no security/global changes. Lint0errors/32warnings:11UnusedResources,10IconLauncherShape,5IconDuplicates,2MonochromeLauncherIcon,1each ObsoleteSdkInt/IconDipSize/IconDuplicatesConfig/IconLocation. Existing cached analyses reused as Gradle permits; icon/splash/resource and Gradle9-deprecation disposition remains release work, no icon/toolchain change.

All25dist files (675,885 bytes) match synced and APK bytes; generated extra public files only `cordova.js`/`cordova_plugins.js`. Four bundled language-unavailable messages confirmed; offline fonts/OFL and QR MIT notices present. No configured sharing destination, capability URLs, credentials, local service endpoint, backend/SQL/tooling/tests or synthetic fixtures in packaged public assets. Capacitor's internal local origin is not a hosted sharing destination. Tests prove unconfigured no-fetch/offline access; no new physical/browser session is claimed. Service74/74 Linux real-Postgres evidence reused unchanged, not managed-provider validation.

R7 changed only maintained ANDROID.md and locally excluded handoff/status/plan/checklist plus generated outputs; app/service/native authored source and dependencies unchanged from entry hashes. Sync regenerated plugin/assets/config outputs, with no substantive tracked native diff. Five older APK hashes unchanged. Internal candidates, diagnostics and plans remain excluded. No installation/device/iOS/deploy/commit/push. Human/device acceptance **DEFERRED BY OWNER**. See local R7 handoff for the current matrix and ordered acceptance; historic entries below are superseded where inconsistent.


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

Active progress stores collected samples locally. History retains available endpoints until individual deletion. Current shared source uses Share trip for offline card images and optional configured links/QR. Cards exclude endpoints, identifiers and trip dates/times entirely. Result/History JSON/CSV controls are removed; stored endpoints remain local until individual deletion. Other deliberately shared details remain sensitive. The R7 candidate includes this transition; older candidates remain historical. Packaging does not establish physical acceptance.

Each native image share stages a separate private-cache file before sharing, retaining its visible basename. Later attempts do not overwrite that snapshot, but Android may evict it and the app sets no expiry/cleanup. Sharing return does not confirm recipient delivery. Local deletion does not retract recipient copies or necessarily remove prepared files.

Language selection does not restart a running native service. New notification text applies on its next normal start. All four catalogs require qualified review and physical accessibility/comprehension checks.

## Validation and release

Web tests, typecheck/build, native sync, debug assembly and lint are automated/build evidence. They do not establish physical first launch, GPS, background reliability, recovery, cessation, recipient access or TalkBack acceptance. Existing icon/splash/resource warnings still need release disposition.

Use synthetic records in isolated validation environments, preserve personal data and tie observations to a candidate hash. No phone testing is currently requested; hands-on acceptance requires explicit resumption.

iOS source preparation exists, but native permission/recovery integration and Mac/Xcode/iPhone validation remain incomplete. Offline card sharing and optional hosted-card client are implemented. The separately delivered PostgreSQL service is locally tested, not deployed or bundled into Android. Unconfigured builds contact no sharing service and explain link unavailability while retaining offline image sharing. See [service operating instructions](service/POSTGRES.md).

Final branding/support/domain, owner-held production signing, tariff evidence, draft-language review, privacy/legal review and current store requirements remain release work. A maintenance operator is unassigned; public deployment needs separate explicit approval. Do not change package IDs or upload keys merely to prepare a debug candidate.
