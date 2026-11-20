import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import appConfig from '../app.config';

const require = createRequire(import.meta.url);
const { plainKotlinClasspath } = require('../plugins/with-plain-kotlin-classpath.cjs') as {
  plainKotlinClasspath: (buildGradle: string) => string;
};

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
    // Nothing keeps every class: a rule that does would leave the app as readable as without R8.
    expect(rules).not.toMatch(/-keep[^\n]*\bclass\s+\*\*\s*\{/);
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
