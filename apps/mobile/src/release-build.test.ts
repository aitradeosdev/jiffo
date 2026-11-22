import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import appConfig from '../app.config';

const require = createRequire(import.meta.url);
const { plainKotlinClasspath } = require('../plugins/with-plain-kotlin-classpath.cjs') as {
  plainKotlinClasspath: (buildGradle: string) => string;
};

/**
 * The keep rules whose class pattern names no package at least two levels deep before its first wildcard:
 * `**`, `*`, `**.*` or `com.**` keep most of the app, and with it the names R8 would hide.
 */
const broadKeeps = (rules: string) =>
  rules
    .split('\n')
    .map((line) => line.trim())
    // The rules that keep classes or their members; -keepattributes and the like keep none.
    .filter((line) =>
      /^-keep(?:classmembers|classmembernames|classeswithmembers|classeswithmembernames|names)?[\s,]/.test(line),
    )
    .filter((line) => {
      // A rule for the classes that extend or implement one class is as narrow as that class's name.
      const pattern =
        /\b(?:extends|implements)\s+(\S+)/.exec(line)?.[1] ??
        /\b(?:class|interface|enum)\s+(\S+)/.exec(line)?.[1] ??
        '';
      return !/^[A-Za-z_]\w*\.[A-Za-z_]\w*(?:\.|$)/.test(pattern);
    });

/** Smile ID's own code that edits android/build.gradle, as its config plugin runs it. */
const smileIdRootProject = () => {
  const root = dirname(require.resolve('@smileid/usesmileid_mlkit_face/app.plugin.js'));
  return require(join(root, 'plugin/build/lib/root_project.js')) as {
    applyAndroidRootProjectPins: (contents: string, options: object) => string;
  };
};

/** One plugin's options in the app config, as the build reads them. */
const pluginOptions = (name: string) => {
  const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
  const entry = config.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? (entry[1] as Record<string, Record<string, unknown>>) : undefined;
};

/**
 * The map's keys and plugin options as a build with these settings, and no others of its kind, reads them: keys or
 * EAS settings already in the shell running the tests are left out.
 */
const mapsWith = (env: Record<string, string>) => {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (/^(GOOGLE_MAPS_|GOOGLE_SERVICES_JSON|EAS_BUILD|EXPO_PUBLIC_API_URL$)/.test(key)) delete process.env[key];
  }
  // Firebase's file, which store builds need too (see below).
  Object.assign(process.env, { GOOGLE_SERVICES_JSON: '/tmp/eas/google-services.json' }, env);
  try {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const entry = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'react-native-maps');
    return { plugin: (entry as [string, Record<string, unknown>])[1], extra: config.extra! };
  } finally {
    for (const key of [...Object.keys(env), 'GOOGLE_SERVICES_JSON']) delete process.env[key];
    Object.assign(process.env, saved);
  }
};

/** The Android app's settings as a build with these settings, and no others of their kind, reads them. */
const androidWith = (env: Record<string, string>) => {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (/^(GOOGLE_SERVICES_JSON|GOOGLE_MAPS_|EAS_BUILD|EXPO_PUBLIC_API_URL$)/.test(key)) delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    return appConfig({ config: {} } as Parameters<typeof appConfig>[0]).android!;
  } finally {
    for (const key of Object.keys(env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
};

/**
 * Push on Android (FCM): the app asks Firebase for its token, which needs Firebase's google-services.json built in.
 * It comes from a private file setting in Expo, never the repository.
 */
describe('Firebase in the Android apps', () => {
  it("builds in Firebase's file when it is set, and leaves it out when not", () => {
    expect(androidWith({ GOOGLE_SERVICES_JSON: '/tmp/eas/google-services.json' }).googleServicesFile).toBe(
      '/tmp/eas/google-services.json',
    );
    expect(androidWith({}).googleServicesFile).toBeUndefined();
  });

  it('stops a store build without it, as offers could never ring', () => {
    const store = {
      EAS_BUILD: 'true',
      EAS_BUILD_PROFILE: 'production-agent',
      EXPO_PUBLIC_API_URL: 'https://api.example.org',
      EAS_BUILD_PLATFORM: 'android',
      GOOGLE_MAPS_ANDROID_API_KEY: 'a',
      GOOGLE_MAPS_IOS_API_KEY: 'i',
    };
    expect(() => androidWith(store)).toThrow(/GOOGLE_SERVICES_JSON/);
    expect(androidWith({ ...store, GOOGLE_SERVICES_JSON: '/tmp/eas/google-services.json' }).googleServicesFile).toBe(
      '/tmp/eas/google-services.json',
    );
    // An iPhone build doesn't use it: Apple's push goes through APNs.
    expect(androidWith({ ...store, EAS_BUILD_PLATFORM: 'ios' }).googleServicesFile).toBeUndefined();
    // A preview build without it still builds: push just doesn't work there.
    expect(
      androidWith({
        EAS_BUILD: 'true',
        EAS_BUILD_PROFILE: 'preview-agent',
        EXPO_PUBLIC_API_URL: 'https://api.example.org',
      }).googleServicesFile,
    ).toBeUndefined();
  });
});

/**
 * Mapbox's map engine goes in every build, beside Google's, so the apps draw whichever company's map finds the
 * places (the API's maps provider) without a new release. Its token comes from the API at start, not the build.
 */
describe("Mapbox's map in the apps", () => {
  it('goes in both builds, with no token or secret in the build settings', () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const entry = config.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === '@rnmapbox/maps');
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toMatch(/token|pk\.|sk\./i);
  });
});

/**
 * Both phones draw Google's map, as places are found with Google, whose terms keep its results off other
 * companies' maps. The keys go in at build time.
 */
describe("Google's map in the apps", () => {
  it('goes in the iPhone build with its key, and the app is told so', () => {
    const maps = mapsWith({ GOOGLE_MAPS_ANDROID_API_KEY: 'android-key', GOOGLE_MAPS_IOS_API_KEY: 'ios-key' });
    expect(maps.plugin).toEqual({ androidGoogleMapsApiKey: 'android-key', iosGoogleMapsApiKey: 'ios-key' });
    expect(maps.extra.googleMapsOnIos).toBe(true);
  });

  it("leaves an iPhone build without the key on Apple's map, outside the store builds", () => {
    const maps = mapsWith({
      EAS_BUILD: 'true',
      EAS_BUILD_PROFILE: 'preview-customer',
      EAS_BUILD_PLATFORM: 'ios',
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
    });
    expect(maps.plugin.iosGoogleMapsApiKey).toBeUndefined();
    expect(maps.extra.googleMapsOnIos).toBe(false);
  });

  it("stops a store build without its phone's key, rather than ship Apple's map or a blank one", () => {
    const store = {
      EAS_BUILD: 'true',
      EAS_BUILD_PROFILE: 'production-agent',
      EXPO_PUBLIC_API_URL: 'https://api.example.com',
    };
    expect(() => mapsWith({ ...store, EAS_BUILD_PLATFORM: 'ios', GOOGLE_MAPS_ANDROID_API_KEY: 'a' })).toThrow(
      'GOOGLE_MAPS_IOS_API_KEY',
    );
    expect(() => mapsWith({ ...store, EAS_BUILD_PLATFORM: 'android', GOOGLE_MAPS_IOS_API_KEY: 'i' })).toThrow(
      'GOOGLE_MAPS_ANDROID_API_KEY',
    );
    // Each phone's build needs only its own key.
    expect(mapsWith({ ...store, EAS_BUILD_PLATFORM: 'ios', GOOGLE_MAPS_IOS_API_KEY: 'i' }).extra.googleMapsOnIos).toBe(
      true,
    );
    expect(() => mapsWith({ ...store, EAS_BUILD_PLATFORM: 'android', GOOGLE_MAPS_ANDROID_API_KEY: 'a' })).not.toThrow();
  });
});

/**
 * Release builds of both Android apps are shrunk and obfuscated with R8 (docs/security-plan.md, MB7), so the
 * Java and Kotlin in them are harder to read and patch. The keep rules only keep what native code and the
 * JavaScript reach by name.
 */
describe('Android release builds', () => {
  const android = pluginOptions('expo-build-properties')?.android;

  it('shrink and obfuscate the code with R8, and drop unused resources', () => {
    expect(android).toMatchObject({ enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true });
  });

  it('never turn obfuscation, shrinking or optimisation back off in the keep rules', () => {
    const rules = String(android?.extraProguardRules ?? '');
    expect(rules).not.toMatch(/-dont(obfuscate|shrink|optimize)\b/);
    // Nothing keeps whole swathes of the app: a rule that does would leave it as readable as without R8.
    expect(broadKeeps(rules)).toEqual([]);
  });

  it("keep the constructors Room's databases are made with, by reflection, as the app starts", () => {
    // WorkManager's WorkDatabase_Impl, made through its no-argument constructor while Android starts the app:
    // without it the app closed at once ("Failed to create an instance of class androidx.work.impl.WorkDatabase").
    const rules = String(android?.extraProguardRules ?? '');
    expect(rules).toMatch(/-keep class \* extends androidx\.room\.RoomDatabase \{\s*<init>\(\);\s*\}/);
  });

  it('see a keep rule that keeps everything, or everything under a top-level package', () => {
    expect(
      broadKeeps(`-keep class ** { *; }
-keep,allowshrinking class **.* { *; }
-keep class com.** { *; }
-keepclassmembers class * { *; }
-keepnames interface *
-keep class * extends ** { *; }
-keep class com.usesmileid.bridge.** { *; }
-keep class * extends androidx.room.RoomDatabase { <init>(); }`),
    ).toEqual([
      '-keep class ** { *; }',
      '-keep,allowshrinking class **.* { *; }',
      '-keep class com.** { *; }',
      '-keepclassmembers class * { *; }',
      '-keepnames interface *',
      '-keep class * extends ** { *; }',
    ]);
  });
});

/**
 * Smile ID's ML Kit plugin pins the Kotlin compiler its face detector needs, by rewriting the Kotlin plugin's
 * classpath line in android/build.gradle. Expo 58's template writes that line in a form it doesn't find, so
 * without help every Android build stopped at prebuild.
 */
describe("Smile ID's Kotlin pin", () => {
  const TEMPLATE = `buildscript {
  dependencies {
    classpath('com.android.tools.build:gradle')
    def kotlinVersion = findProperty('android.kotlinVersion')
    classpath(kotlinVersion ? "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlinVersion" : 'org.jetbrains.kotlin:kotlin-gradle-plugin')
  }
}

apply plugin: "expo-root-project"
`;

  it("leaves the classpath line in the form Smile ID's plugin pins, which then pins it", () => {
    const plain = plainKotlinClasspath(TEMPLATE);
    expect(plain).toContain("classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')");
    const { applyAndroidRootProjectPins } = smileIdRootProject();
    expect(() => applyAndroidRootProjectPins(TEMPLATE, { kotlinVersion: '2.3.20', forcedDependencies: [] })).toThrow(
      /kotlin-gradle-plugin classpath/,
    );
    expect(applyAndroidRootProjectPins(plain, { kotlinVersion: '2.3.20', forcedDependencies: [] })).toContain(
      "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin:2.3.20')",
    );
  });

  it('runs before Smile ID edits the file: it is listed after their plugins', () => {
    const config = appConfig({ config: {} } as Parameters<typeof appConfig>[0]);
    const names = (config.plugins ?? []).map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names.indexOf('./plugins/with-plain-kotlin-classpath.cjs')).toBeGreaterThan(
      names.indexOf('@smileid/usesmileid_mlkit_face'),
    );
  });

  it('changes nothing in a build file without that line', () => {
    const other = "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n";
    expect(plainKotlinClasspath(other)).toBe(other);
  });
});

/**
 * A preview or store build talks to the API over HTTPS only. Built on Expo's servers without an HTTPS address,
 * it would call the phone itself (localhost) for everything, so the build stops instead.
 */
describe('the API address in a build', () => {
  it('is the one given, or the computer running the bundler for development', async () => {
    const { apiUrlFor } = await import('../app.config');
    expect(apiUrlFor({})).toBe('http://localhost:3000');
    expect(apiUrlFor({ EXPO_PUBLIC_API_URL: 'http://192.168.1.20:3000' })).toBe('http://192.168.1.20:3000');
    expect(apiUrlFor({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: 'development-agent' })).toBe('http://localhost:3000');
  });

  it("stops a preview or store build on Expo's servers that has no HTTPS address", async () => {
    const { apiUrlFor } = await import('../app.config');
    for (const profile of ['preview-agent', 'production-customer']) {
      expect(() => apiUrlFor({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile })).toThrow(/EXPO_PUBLIC_API_URL/);
      expect(() =>
        apiUrlFor({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'http://10.0.0.2:3000' }),
      ).toThrow(/https/);
      expect(
        apiUrlFor({ EAS_BUILD: 'true', EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: 'https://api.example.com' }),
      ).toBe('https://api.example.com');
    }
  });
});

/**
 * The apps use the shared package's compiled output (packages/shared/dist), which isn't in the repository. CI builds
 * it first; on Expo's servers the app's own `eas-build-post-install` script does, right after installing, or the
 * JavaScript can't be bundled.
 */
describe("builds on Expo's servers", () => {
  it('compile the shared package before bundling', async () => {
    const { scripts } = (await import('../package.json')).default as { scripts: Record<string, string> };
    expect(scripts['eas-build-post-install']).toMatch(/--filter @jiffo\/shared (run )?build/);
  });
});
