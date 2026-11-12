# Android setup and release

## Application identity

- Display name: `hopNshop`
- Package ID: `com.hopnshop.app`
- Version: `1.0.0` (version code `1`)
- Tagline: “Shop Smart. Live Better.”
- Deep-link callback: `hopnshop://auth/callback`

The Android platform project and branded launcher/splash resources are checked in. The launcher artwork is cropped from the supplied shopping-bag mark; the complete logo and tagline are preserved in the loading/splash artwork.

## Local debug build

Android Studio and an emulator are not required for command-line builds. Install a JDK 21 and Android command-line SDK with Android SDK Platform 35 and Build Tools 35.0.0, then set `JAVA_HOME` and `ANDROID_SDK_ROOT` (or `ANDROID_HOME`). Accept the Android SDK licences.

From PowerShell in the project directory:

```powershell
npm.cmd ci
$env:VITE_SUPABASE_URL = "https://your-project.supabase.co"
$env:VITE_SUPABASE_ANON_KEY = "your-public-anon-key"
npm.cmd run build:android
npx.cmd cap sync android
Push-Location .\android
.\gradlew.bat assembleDebug
Pop-Location
```

The debug APK is written to `android\app\build\outputs\apk\debug\app-debug.apk`. Install it on an authorized, connected device with:

```powershell
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

`npm.cmd run build:android` runs Vite bundling. It intentionally does not run the repository-wide TypeScript check: `npm.cmd run build` currently fails on pre-existing notification/auth TypeScript errors listed in `PROJECT_STATUS.md`. That type-check failure remains a release blocker; a successful Vite bundle does not replace fixing and passing the full type check.

## GitHub Actions builds

`.github/workflows/android-build.yml` runs tests, bundles the web app, syncs Capacitor and builds a debug APK on `main` pushes or manual dispatch. The workflow requires these repository Actions secrets and fails closed if either is missing:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

The anon key is a public client key; **never** use `SUPABASE_SERVICE_ROLE_KEY`, payment credentials or other server secrets for either value.

The workflow always uploads the debug APK as an Actions artifact. It creates release APK/AAB files only when all four release-signing secrets below exist. A missing signing configuration does not produce or label an unsigned artifact as a release.

Optional Android push-notification configuration:

- `ANDROID_GOOGLE_SERVICES_JSON_BASE64` — base64-encoded Firebase Android `google-services.json`. It is written to the ignored `android/app/google-services.json` path only during the workflow.

FCM server credentials remain Supabase Edge Function secrets (for example `FIREBASE_SERVICE_ACCOUNT` and `FIREBASE_PROJECT_ID`); do not put them in the Android app or this repository.

## Release signing

Generate a dedicated upload keystore on a trusted machine and keep it outside the repository:

```powershell
keytool -genkeypair -v -keystore hopnshop-upload.jks -alias hopnshop-upload -keyalg RSA -keysize 4096 -validity 10000
```

Keep at least two encrypted backups in separate secure locations. Record the alias and certificate details. Losing the upload key can block updates unless Play App Signing recovery is available. Never email the keystore/passwords, commit them, or paste them into chat or logs.

For GitHub Actions, copy a base64 encoding of the keystore directly into the repository secret `ANDROID_KEYSTORE_BASE64` without printing it:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\secure\hopnshop-upload.jks")) | Set-Clipboard
```

Also configure these repository Actions secrets:

- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

For a local signed build, set `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` in the current PowerShell session, then run:

```powershell
npm.cmd run build:android
npx.cmd cap sync android
Push-Location .\android
.\gradlew.bat assembleRelease bundleRelease
Pop-Location
```

With valid signing values, outputs are `android\app\build\outputs\apk\release\app-release.apk` and `android\app\build\outputs\bundle\release\app-release.aab`. Do not distribute any release build unless its signature is verified and matches the intended Play upload key.

## Authentication links and native permissions

Add `hopnshop://auth/callback` to the Supabase Auth redirect URL allowlist before testing Android password reset, email confirmation or email-link sign-in. These callbacks are handled by the Android app and passed to Supabase Auth. Keep the existing web callback/origin entries too.

The Android app declares camera permission for the optional sourcing reference-photo capture. The gallery file picker remains available separately. Android requests camera access when the customer chooses the camera action. The app uses the Capacitor status-bar, keyboard, network, sharing, browser, camera and back-button APIs and retains the existing viewport safe-area setting.

Only the custom `hopnshop://` callback scheme is configured here. Verified HTTPS App Links require hosting a correct `/.well-known/assetlinks.json` for the Play signing certificate and are not configured.

## Release readiness limits

- No debug APK, signed release APK or AAB has been built in the current Windows environment: JDK, Android SDK and Gradle are absent. The GitHub Actions workflow has been added but has not been run.
- No Android device/emulator acceptance testing has been performed.
- The full TypeScript build currently fails in pre-existing notification/auth code; the Android workflow uses Vite bundling and the existing tests. Resolve the type errors and run the complete build before public release.
- Firebase configuration and notification provider credentials are absent, so FCM delivery is not verified.
- Payment-provider approval/STK Push, live authenticated checkout/RLS testing, and the unapplied/unvalidated hybrid-delivery migration remain incomplete. Packaging does not make the marketplace production-ready.
- Review current Play Console target API requirements, data-safety declarations, privacy policy, store listing, content ratings, signing enrollment and payment policy before submission.
