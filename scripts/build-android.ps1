$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $localJava = Join-Path $projectRoot '.tools\java'
    if (Test-Path -LiteralPath $localJava) {
        $env:JAVA_HOME = (Get-ChildItem -LiteralPath $localJava -Directory | Select-Object -First 1).FullName
    }
    $localSdk = Join-Path $projectRoot '.tools\android-sdk'
    if (Test-Path -LiteralPath $localSdk) { $env:ANDROID_HOME = $localSdk }
    if (-not $env:JAVA_HOME) { throw 'Set JAVA_HOME to a Java 21 JDK, or install Android Studio and use its jbr directory.' }
    if (-not $env:ANDROID_HOME -and -not (Test-Path -LiteralPath 'android\local.properties')) {
        throw 'Set ANDROID_HOME to the Android SDK directory, or configure android/local.properties in Android Studio.'
    }
    $env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
    $env:GRADLE_USER_HOME = Join-Path $projectRoot '.tools\gradle'
    # Keep temporary test/build files within the project.
    $env:TEMP = Join-Path $projectRoot '.tools\tmp'
    $env:TMP = $env:TEMP
    New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

    & npm.cmd test
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
    & npm.cmd run icons
    if ($LASTEXITCODE -ne 0) { throw 'Icon generation failed.' }
    & npm.cmd run android:sync
    if ($LASTEXITCODE -ne 0) { throw 'Web build or native synchronization failed.' }
    & '.\android\gradlew.bat' -p android :app:assembleDebug :app:lintDebug --console=plain --max-workers=2
    if ($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }

    New-Item -ItemType Directory -Force -Path 'artifacts' | Out-Null
    Copy-Item -LiteralPath 'android\app\build\outputs\apk\debug\app-debug.apk' -Destination 'artifacts\taxi-check-tn.apk' -Force
    $hashAlgorithm = [System.Security.Cryptography.SHA256]::Create()
    $apkStream = [System.IO.File]::OpenRead((Join-Path $projectRoot 'artifacts\taxi-check-tn.apk'))
    try { $apkHash = [System.BitConverter]::ToString($hashAlgorithm.ComputeHash($apkStream)).Replace('-', '').ToLowerInvariant() }
    finally { $apkStream.Dispose(); $hashAlgorithm.Dispose() }
    Set-Content -LiteralPath 'artifacts\taxi-check-tn.apk.sha256' -Value "$apkHash  taxi-check-tn.apk" -Encoding ascii
    Write-Host "Installable APK: $projectRoot\artifacts\taxi-check-tn.apk"
} finally {
    Pop-Location
}
