# Certificate pinning (MB7)

The apps can pin the API's certificate authorities: they then talk to the API only when its certificate chains up to one of the authorities' keys built into the app. A certificate wrongly issued for Jiffo's domain, or a phone made to trust someone's own authority, isn't enough to read or change the traffic.

**It ships off.** A build without pins (the default) pins nothing and checks certificates as usual. It is turned on with build settings once hosting and the certificate authority are chosen, after testing on staging with real phones.

## What it does when on

- **What's pinned:** the API's host (or the hosts in `PINNING_HOSTS`), for every request and for the live connection (socket.io's WebSocket), which carries the sign-in token too.
  - Requests are pinned by `react-native-ssl-public-key-pinning`: OkHttp's certificate pinner on Android, TrustKit on iPhone.
  - WebSockets get the same pins from Jiffo's `modules/socket-pinning`: the library's pinner on Android, TrustKit inside SocketRocket's certificate check on iPhone.
- **What's pinned to:** certificate authorities' keys, an intermediate's or a root's, never the server's own certificate, which renews every few months.
  - At least two pins, from two different authorities, so the API can move to the second if the first fails.
  - The build stops if the settings break these rules (`pinningFor` in `apps/mobile/app.config.ts`).
- **An end date:** the pins carry an end date, at most 13 months after the build. From that day the app checks certificates as usual, without the pins, rather than locking out people who haven't updated.
- **A remote switch:** a small document the server's key signs (Ed25519), published at an `https://` address on a host the apps don't pin, so it still reaches them when a pin stops matching.
  - **Reading it:** each time the app starts, before its first request, it fetches the switch, waiting at most 3 seconds.
  - **Taking it:** only a switch signed with the server's key, and newer than both the last one taken and the build itself, so an old one sent again changes nothing. The phone keeps the last one it took.
    - **One gap:** an "off" works until its end on a phone that hasn't fetched the later "on", for example one not opened since. Someone who saved the "off" could serve it to that phone until the "off" ends. So keep each "off" as short as the fix needs.
  - **Clocks:** a switch dated up to a day ahead of the phone's clock is taken, so a phone whose clock is hours slow still gets an emergency "off".
  - **Off:** a switch can turn pinning off for at most 7 days, until an end it names. After that the pins apply again.
- **Never in the way:** the app checks certificates as usual instead of pinning when:
  - the pins' end date has passed;
  - a signed switch has pinning off;
  - the app can't pin there (Expo Go, the web version);
  - the native side refuses the pins.

## Turning it on

Do each step for staging first (the `preview` builds), and only for production (`production` builds) once the staging tests pass.

1. **Find the API's certificate chain** on the server that will serve it:

   ```bash
   openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts </dev/null
   ```

   Note the authority that issued the server's certificate (the intermediate) and its root.

2. **Choose two pins from two different authorities:**
   - one key of the authority in use now (its intermediate's or its root's);
   - one of a second authority the API could move to quickly, with the account and setup ready (for example Let's Encrypt and Google Trust Services, or the hosting's own authority and one of these).

   Never the server's own certificate.
3. **Compute each pin** from the authority's certificate (PEM, from the chain above or the authority's site). Do it on your own computer, not an online tool:

   ```bash
   openssl x509 -in authority.pem -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64
   ```

4. **Make the switch's key pair**, once:

   ```bash
   pnpm --filter @jiffo/api build && pnpm --filter @jiffo/api pinning-switch keygen
   ```

   `PINNING_SWITCH_KEY` goes in the build settings. Keep `PINNING_SWITCH_PRIVATE_KEY` as a secret, where only those who may turn pinning off can reach it (a password manager, or the server's secrets). It never goes in the apps or the repository.
5. **Publish the switch**, on an `https://` address on a host the apps don't pin: a file in a storage bucket or on a CDN, not the API's own host.

   Load the private key into the terminal without it showing or going into the shell's history. This asks for it; paste it and press Enter:

   ```bash
   read -rs PINNING_SWITCH_PRIVATE_KEY && export PINNING_SWITCH_PRIVATE_KEY
   ```

   Then start with "on". The command writes the document to the file it's given, and nothing else:

   ```bash
   pnpm --filter @jiffo/api pinning-switch sign --on --out "$PWD/pinning.json"
   ```

   Upload `pinning.json`; its address is `PINNING_SWITCH_URL`. Make sure the host doesn't cache it for long (a few minutes at most).
6. **Set the build settings** as EAS environment variables (docs/mobile-builds.md), for `preview` first:

   | Setting | Value |
   | --- | --- |
   | `PINNING_PINS` | `authority-name:pin,other-authority:pin`, for example `letsencrypt-isrg-root-x1:...,google-gts-root-r1:...` |
   | `PINNING_EXPIRES` | The pins' end date, `yyyy-MM-dd`, at most 13 months away. Plan an update with new pins before it |
   | `PINNING_SWITCH_URL` | The switch's address from step 5 |
   | `PINNING_SWITCH_KEY` | From step 4 |
   | `PINNING_HOSTS` | Optional: the hosts to pin, comma-separated. By default, the API's host from `EXPO_PUBLIC_API_URL` |

   For example:

   ```bash
   cd apps/mobile && eas env:create --scope account --environment preview --name PINNING_PINS --value "letsencrypt-isrg-root-x1:<pin>,google-gts-root-r1:<pin>" --visibility plaintext
   ```

7. **Build and test on staging with real phones**, an Android phone and an iPhone, with `preview` builds (not development builds: Expo's development launcher on iPhone gets in the way of pinning). The tests are in the next section.
8. **Production:** set the same settings for the `production` environment, with production's pins and switch, and build the store apps.

## Staging tests on real phones

With staging's API serving a certificate from the first pinned authority:

1. **Pinned:** the app signs in, an errand's live updates and chat arrive (the WebSocket), and money actions go through.
2. **A pin that doesn't match:** build with two made-up pins (any two different base64 SHA-256 values). The app can't reach the API (requests and the live connection both fail), and the server sees no request from it.
3. **The switch, off:** with that build still installed, publish an "off" for 2 hours and restart the app. It reaches the API again.

   ```bash
   pnpm --filter @jiffo/api pinning-switch sign --off --hours 2 --out "$PWD/pinning.json"
   ```

   (With the private key loaded as in step 5 of turning it on.)

4. **The switch, on again:** publish `sign --on` and restart the app: it can't reach the API again.
5. **No replays:** upload the earlier "off" document again and restart: the app stays pinned.
6. **The backup pin:** if staging can serve a certificate from the second authority, switch to it: the app keeps working.

## When certificates change

- **A new certificate from the same authority** (every few months): nothing to do; the pins are the authority's.
- **Moving to the second pinned authority:** nothing to do in the apps. Ship an update with a new second pin afterwards, so there's always a backup.
- **Moving to an authority not pinned, or a pin that stops matching for any reason:** first publish an "off" (at most 7 days, signed again if the update takes longer), then ship an update with the new pins, and publish "on" once people have it.
- **Before `PINNING_EXPIRES`:** ship an update with a new end date. An app not updated by then checks certificates as usual, without the pins.
