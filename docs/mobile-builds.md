# Installing the apps on a phone

Expo Go and the web version can't run the apps' native parts: the money-signing key (`modules/device-key`), the app check and risk signals (`modules/app-attest`), Smile ID's selfie camera, real maps, push and background location. To try them, install a build of the app on a phone. Builds are made on Expo's servers (EAS Build), so you need no Android Studio or Xcode.

There are two kinds of build. Each exists for both apps: put `-customer` or `-agent` after the profile name.

| Profile | What it is | Use it to |
| --- | --- | --- |
| `development-agent`, `development-customer` | A debug build with Expo's launcher. It loads the JavaScript from your computer, so changes show without a new build | Try the native parts while working on the app |
| `preview-agent`, `preview-customer` | A release build, as the store app is built: R8 obfuscation on (MB7), JavaScript inside the app. It talks to the API only over HTTPS | Check a release build on a real phone before it ships |

All the commands below run in a terminal in the repository's `apps/mobile` folder (`cd apps/mobile` from the repository's top folder, once).

## Once, on your computer

1. Follow the README's **Getting started** to install Node 22 and pnpm, clone the repository and run `pnpm install`.
2. Make a free account at [expo.dev](https://expo.dev).
3. Install Expo's build tool and sign in:

   ```bash
   npm install -g eas-cli
   ```

   ```bash
   eas login
   ```

4. The development builds' Expo projects are made already, under the `cl-agents-team` account, and named in `apps/mobile/eas-projects.json`, with the account. Sign in with that account to build them. To build under another account (the production one, before the store builds), put its name as `owner` in that file, then make a project for each app in it. Each command makes the project; as the app's settings are in `app.config.ts`, which it can't change, it shows the project's `projectId` for you to copy:

   ```bash
   eas init
   ```

   ```bash
   APP_VARIANT=agent eas init
   ```

   Put the two ids in `apps/mobile/eas-projects.json` as `customer` and `agent`, and commit the file. The ids aren't secret. The build settings below (`eas env:set`) are kept per account, so set them again in the new one.

5. Optional: real maps on Android need a Google Maps key with the Maps SDK for Android turned on. Without one, the maps are blank and everything else works. Save it for every build, both apps:

   ```bash
   eas env:set --scope account --name GOOGLE_MAPS_ANDROID_API_KEY --value <your key> --environment development --environment preview --environment production --visibility sensitive
   ```

## The API the app talks to

Start the backend as the README says. With the console providers, sign-in codes are printed in the API's log.

- **Development builds:** the phone and your computer must be on the same Wi-Fi. Find your computer's address on that network (on a Mac: System Settings, Wi-Fi, Details; on Windows: `ipconfig`), such as `192.168.1.20`. It goes in the bundler's start command: step 4 for an Android phone, step 6 for an iPhone.
- **Preview builds:** a release build talks to the API only over HTTPS. Until there is a staging server, open a temporary HTTPS address to the API on your computer, and leave it running while you test:

  ```bash
  npx cloudflared tunnel --url http://localhost:3000
  ```

  It prints an address ending in `trycloudflare.com`. Save it for preview builds, then build. A new tunnel has a new address, which needs a new build:

  ```bash
  eas env:set --scope account --name EXPO_PUBLIC_API_URL --value https://<the address> --environment preview --visibility plaintext
  ```

  Running it again with a new address changes it. Once staging exists, set it to the staging API's address once.

- **Store builds:** before the first `production-agent` or `production-customer` build, set `EXPO_PUBLIC_API_URL` to the live API's `https://` address the same way, with `--environment production`.

  A preview or store build made on Expo's servers without an `https://` address stops with an error naming `EXPO_PUBLIC_API_URL`. Without the check, it would ship an app that calls the phone itself for everything.

## Android phone

1. Build. For the agent app (use `-customer` for the customer app):

   ```bash
   eas build --profile development-agent --platform android
   ```

   For the release check, use `--profile preview-agent`. The first time, EAS asks to make the app's signing key: say yes, and EAS keeps it. A build takes 10 to 30 minutes.
2. When it's done, EAS shows a link and a QR code, also on [expo.dev](https://expo.dev) under the project's builds. Open it on the phone (scan the QR code with the camera) and tap **Install** to download the APK.
3. Open the file. The first time, Android asks to allow installs from your browser: tap **Settings**, turn on **Allow from this source**, go back and tap **Install**. If Play Protect warns about an unknown app, tap **Install anyway**.
4. **Development build:** on your computer, start the bundler for that app with the address from above:

   ```bash
   EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 pnpm start:agent
   ```

   (`pnpm start` for the customer app.) Open the app on the phone: it lists the bundler under **Development servers**. Tap it, or scan the QR code in the terminal.
   **Preview build:** just open the app.

## iPhone

An app can be installed on an iPhone outside the App Store only with a paid Apple Developer Program membership (99 US dollars a year), which the App Store needs anyway. App Attest needs it too.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/), with the Apple account that will publish the apps.
2. Register the iPhone with Expo, once for each phone:

   ```bash
   eas device:create
   ```

   Choose **Website**, open the link it shows on the iPhone in Safari, and allow the profile download. Then on the iPhone open **Settings**, tap **Profile Downloaded** near the top and install it. This tells Apple the phone may run your builds.
3. Turn on Developer Mode, once (iOS 16 and later): **Settings**, **Privacy & Security**, **Developer Mode**, turn it on and let the phone restart. If **Developer Mode** isn't listed yet, install the build first (steps 4 and 5): the option appears once the phone has an app from a build like this.
4. Build. For the agent app:

   ```bash
   eas build --profile development-agent --platform ios
   ```

   The first time, EAS asks you to sign in to your Apple account and offers to make the certificates and the provisioning profile, with your registered phones: say yes to each. It also sets up the app id with App Attest. A phone registered after a build needs a new build.
5. When it's done, open the link or QR code on the iPhone and tap **Install**. The app appears on the home screen.
6. **Development build:** start the bundler as in step 4 for Android, then open the app and tap the bundler under **Development servers**. The first time, allow the app to find devices on the local network.
   **Preview build:** just open the app. R8 is Android only, so the release check below needs no iPhone.

## What to check on a release build (MB7)

Install `preview-agent` on an Android phone, and `preview-customer` if you can. Then go through the parts that use native code, in each app that has them:

1. The app opens, sign in with the code from the API's log, and give your name.
2. Customer: the map shows, the location prompt appears, and an errand can be requested.
3. Agent: fill in the application (the stand-in identity provider passes any ID number not ending in 1111, 1818 or 0000), approve it in the admin panel, set the app PIN and go online. The selfie check opens; with the stand-in, the server decides it.
4. Agent: a money action (adding a payout account, or a withdrawal) asks for the PIN, and the server accepts its signature. This is the phone's own key at work.
5. Notifications: the app asks, and keeps working whatever the answer. Pushes arrive only once Firebase (Android) and Apple's push key (iPhone) are set up; with the console provider they are printed in the API's log.
6. Background location: online, with "Allow all the time", lock the phone for a minute: the trail keeps updating.
7. With Smile ID's sandbox keys on the server: a selfie check opens Smile ID's camera and finishes.

A screen that closes the app, or a feature that fails only in the release build, is a missing keep rule. Note what you did just before, and the time, so the crash can be found in the build's log.

An app installed outside Google Play fails Play Integrity, so its app check counts as doubtful (MB3). That's expected, and only asks an agent for a selfie before money moves.
