# hopNshop Android releases

This directory is reserved for generated Android packages:

- `hopNshop-1.0.0-debug.apk` — debug build (installable for testing; not Play Store release)
- `hopNshop-1.0.0-release.apk` — signed release APK (only when release signing is configured)
- `hopNshop-1.0.0-release.aab` — signed Play Store App Bundle (only when release signing is configured)

## Current status

No APK or AAB is committed in this environment. The local machine does not have a JDK or Android SDK/command-line tools installed, so Gradle package builds could not be completed locally.

## How to generate packages

### Local (requires JDK 21 + Android SDK Platform/Build Tools 35)

```powershell
npm.cmd ci
$env:VITE_SUPABASE_URL = "https://<project>.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "<public-anon-key>"
npm.cmd run build:android
npx.cmd cap sync android
Push-Location .\android
.\gradlew.bat assembleDebug
# Signed release (set ANDROID_KEYSTORE_* env vars first):
.\gradlew.bat assembleRelease bundleRelease
Pop-Location
```

Copy outputs into this folder with the names above:
- `android\app\build\outputs\apk\debug\app-debug.apk`
- `android\app\build\outputs\apk\release\app-release.apk`
- `android\app\build\outputs\bundle\release\app-release.aab`

### GitHub Actions (recommended when local SDK is unavailable)

Run `.github/workflows/android-build.yml` (push to `main` or manual dispatch). Configure repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Add signing secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) to produce signed release APK/AAB. Download the `hopnshop-android-1.0.0` artifact and place files here.

Unsigned/debug-signed outputs are **not** production-ready Play Store releases.
