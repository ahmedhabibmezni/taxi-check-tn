# iOS source preparation

Generated with the installed Capacitor CLI8.4.3 and official iOS runtime8.5.3. Provisional identity `tn.taxicheck.app`, display name Taxi Check TN, minimum iOS15. No Apple team/signing credentials configured. This is not a built or device-validated iOS app.

## Required Mac preparation

Use a compatible Mac and Xcode26+; consult current Capacitor/Apple requirements. The installed CLI generated an AppDelegate template. Capacitor8.5 retains that path, but Xcode27 requires the official scene-lifecycle migration before building. Do not upgrade the shared CLI/dependencies or reconstruct the project without a bounded compatibility review.

From repository root, with the service destination unset:

```
npm ci --ignore-scripts
npm run typecheck
npm run build
npx cap sync ios
plutil -lint ios/App/App/Info.plist ios/App/App/PrivacyInfo.xcprivacy
xcodebuild -list -project ios/App/App.xcodeproj
xcodebuild -resolvePackageDependencies -project ios/App/App.xcodeproj -scheme App
xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .tools/ios-derived CODE_SIGNING_ALLOWED=NO build
```

**Run Mac sync before package resolution.** Windows CLI generation writes backslashes into the managed `App/CapApp-SPM/Package.swift` plugin paths. It must be regenerated on the Mac; do not hand-edit that CLI-managed file. Successful Windows copy/add does not resolve Swift packages or validate the Xcode project. Generated web/config/derived files are ignored; build and copy/sync on the Mac before native checks. The five plugin packages include the existing Android notification plugin, but source only requests its notification permission on Android.

## Configured source and pending checks

Only background `location` mode and the two location usage descriptions are configured. Their four `InfoPlist.strings` variants and Filesystem `FileTimestamp/C617.1` resource are registered in the generated target. Descriptions are draft. Native permission language follows iOS bundle/preferred language selection, independently of the JavaScript selector; verify aeb-TN recognition/fallback and all resource membership in Xcode. No camera/photos/broad file-access/background-fetch/remote notification permission or service destination added.

The installed background plugin couples `backgroundMessage` to background updates and requests/escalates Always authorization. Apple supports some continuous, explicitly started background updates with When in Use. The least-access background flow therefore remains a native integration blocker: inspect and validate a narrowly authorized adapter/plugin adjustment on a Mac, rather than asserting Always is inherently required or silently removing background support. Source configuration prevents missing-description crashes but is not approval to ship unnecessary access. No newer Core Location service-session API is claimed implemented.

Unknown earlier iOS watcher activity remains conservatively blocked. Compatible unfinished data is retained, not repriced or automatically resumed. Dismissal, indicator disappearance and user assertion cannot clear that block; this source has no verified iOS completion action for it. Manual/History/card preview remain independent. Current-runtime stop requests, storage cleanup and completed History saving remain separate outcomes. A resolved removeWatcher for an unknown ID is not evidence of earlier shutdown. Failed intent persistence retains C5's reload limitation.

Verify SPM/plugin compatibility, final privacy-manifest aggregation, foreground/background/lock/termination/restore/stop failures, private nested cache URI and recipient access, persistence across upgrades, safe areas/keyboard/RTL/VoiceOver and all four languages. Simulator and mocked tests cannot close physical GPS/sharing/accessibility acceptance. Source font/vendor licenses remain bundled; generated template license is retained alongside this file. Signing/account/device access and any distribution require separate owner-controlled authorization. No production service configuration or hosting work is included.

Official references: [Capacitor iOS](https://capacitorjs.com/docs/ios), [8.5 scene changes](https://capacitorjs.com/docs/updating/8-5), [SPM](https://capacitorjs.com/docs/ios/spm), [background plugin](https://github.com/capacitor-community/background-geolocation), [Apple location authorization](https://developer.apple.com/documentation/corelocation/requesting-authorization-to-use-location-services), [Filesystem privacy reasons](https://capacitorjs.com/docs/apis/filesystem).
