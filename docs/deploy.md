# Running a test server

The `deploy/` kit runs everything behind the apps on one small VPS: Postgres with PostGIS, Redis, the API, the admin panel, and Caddy in front for HTTPS. It's for a **test server** (`TEST_SERVER=true`): production mode, so every check runs as it will for real and no stand-in is used, but providers take **test and sandbox keys only**, never live ones, so no real money moves and no real ID is checked, and sign-in codes can be shown in the app instead of texted. Real customers belong on a production setup with backups, monitoring and the admin panel behind single sign-on.

## What you need

- **A VPS** running Ubuntu 22.04 or 24.04 (Debian works too), x86-64 or ARM, with **2 GB of memory or more** and about 20 GB of disk, and SSH access as root or a sudo user.
- **An email address** for security reports and notices about the HTTPS certificates.
- **Nothing to buy.** Without a domain, the server is reached at names made from its IP address through [sslip.io](https://sslip.io): for `203.0.113.5`, `https://api.203-0-113-5.sslip.io` and `https://admin.203-0-113-5.sslip.io`. Caddy gets real certificates for them. With a domain later, point `api.` and `admin.` at the server with DNS A records and run the setup again with `--domain`.

The address the apps call is built into them, so keep the server's IP: a new IP, or a domain later, means new app builds.

## On the VPS

```bash
ssh root@203.0.113.5
```

```bash
apt-get update && apt-get install -y git
```

```bash
git clone https://github.com/aitradeosdev/jiffo.git && cd jiffo
```

```bash
sudo deploy/setup.sh --email you@example.com
```

If phones reach the server at another IP than the one it sends from (a floating IP, say), add `--ip 203.0.113.5`.

The setup:

- installs Docker if it's missing;
- adds 2 GB of swap on a small server, so the admin panel can be built;
- opens only SSH, 80 and 443 in the firewall (ufw). The database, Redis and the API aren't published at all, and the admin API answers only to the panel, inside the server;
- makes every secret the server needs (`deploy/secrets.env`, readable only by root). **Copy that file somewhere safe**: without it the data can't be read. Running the setup again keeps it;
- builds the server and starts it. The first build takes a few minutes;
- prints the API's and the panel's addresses.

Then make yourself the first owner, with your own email and your own phone number (the one your Jiffo app account will use). It prints your invite link:

```bash
sudo deploy/jiffo admin invite --email you@example.com --name "Your Name" --role owner --phone +2348012345678 --reason "First owner"
```

Once the repository is private, cloning and updating need a GitHub deploy key or token on the server.

## In the admin panel

Open the invite link, choose a password and set up your authenticator app. As the team's only owner, changes that need a second admin's approval go ahead with yours alone.

1. **Settings, Security, Sign-in codes: Test.** No texts are sent: the app shows each code on its code screen. Anyone can then sign in to any number, which is why only a test server allows it.
2. **Settings, Identity checks:** turn off **Customers check their ID** and **Agents check their ID**, unless you're testing Smile ID, in its sandbox mode.
3. **Settings, Providers.** For each: enter the keys, **Save**, **Test**, then **Switch on**.
   - **Storage** (needed: photos in chat, receipts, drop-offs). S3-compatible, such as Cloudflare R2's free tier: the bucket, region `auto`, the endpoint `https://<account id>.r2.cloudflarestorage.com`, and an API token's access key and secret.
   - **Maps** (needed: address search, prices and the map). Mapbox: a server token, a public `pk.` token for the apps, and optionally a public one restricted to the panel's address. Or Google Maps Platform.
   - **Payments** (to top up wallets with test cards): Paystack's test secret key (`sk_test_`). A live key is refused here.
   - **Push** (so offers ring with the agent app closed): Firebase's service account file.
4. **Settings, Places:** draw a city and an area inside it, and switch both on. Errands are taken only inside an area that's on. Before a map key is in, paste this rough outline of Lagos as the city, and again as its area:

   ```json
   {"type":"Polygon","coordinates":[[[2.7,6.37],[4.35,6.37],[4.35,6.55],[3.95,6.65],[3.65,6.7],[3.4,6.7],[3.3,6.64],[3.15,6.6],[3.05,6.47],[2.7,6.47],[2.7,6.37]]]}
   ```

## The apps

Build them for this server ([mobile-builds.md](mobile-builds.md)), with the API's address as the preview builds' setting:

```bash
eas env:create --force --scope account --name EXPO_PUBLIC_API_URL --value https://api.203-0-113-5.sslip.io --environment preview --visibility plaintext
```

Then, from `apps/mobile` on your computer:

```bash
eas build --profile preview-customer --platform android
```

```bash
eas build --profile preview-agent --platform android
```

For push notifications, save Firebase's `google-services.json` for the builds first ([mobile-builds.md](mobile-builds.md), step 6). Each build gives an APK to install on an Android phone. iPhones need an Apple Developer account, with the test phones registered.

An agent signs up in the agent app, and you approve them in the panel (Applications).

## Everyday commands

Run from the repository on the server:

| | |
| --- | --- |
| `sudo deploy/jiffo status` | What is running |
| `sudo deploy/jiffo logs api` | Follow the API's log (or `admin`, `caddy`, `postgres`, `redis`) |
| `sudo deploy/jiffo update` | Pull the latest code, rebuild and restart. Migrations run as the API starts |
| `sudo deploy/jiffo backup` | Save the database to `deploy/backups/`. Copy it off the server |
| `sudo deploy/jiffo admin reset --email you@example.com --reason "Lost my phone"` | A new invite link for an owner locked out |
| `sudo deploy/jiffo restart api` | Anything else Docker Compose does |
