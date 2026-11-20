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
      const pattern = /\b(?:class|interface|enum)\s+(\S+)/.exec(line)?.[1] ?? '';
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

  it('see a keep rule that keeps everything, or everything under a top-level package', () => {
    expect(
      broadKeeps(`-keep class ** { *; }
-keep,allowshrinking class **.* { *; }
-keep class com.** { *; }
-keepclassmembers class * { *; }
-keepnames interface *
-keep class com.usesmileid.bridge.** { *; }`),
    ).toEqual([
      '-keep class ** { *; }',
      '-keep,allowshrinking class **.* { *; }',
      '-keep class com.** { *; }',
      '-keepclassmembers class * { *; }',
      '-keepnames interface *',
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
