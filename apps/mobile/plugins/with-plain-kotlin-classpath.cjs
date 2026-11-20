// Smile ID's ML Kit plugin pins the Kotlin compiler its face detector needs by rewriting the Kotlin plugin's
// classpath line in android/build.gradle. Expo 58's template writes that line in a form it doesn't find, which
// stops every Android build at prebuild. This writes it in the form it does find, before it runs: of plugins
// editing one file, the one listed last runs first, so app.config.ts lists this after Smile ID's.
const { withProjectBuildGradle } = require('expo/config-plugins');

/** The Kotlin plugin's classpath line as Expo 58's template writes it, with the version from gradle.properties. */
const TEMPLATE_KOTLIN_CLASSPATH =
  /classpath\(kotlinVersion \? "org\.jetbrains\.kotlin:kotlin-gradle-plugin:\$kotlinVersion" : 'org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)/;

/** @param {string} buildGradle */
const plainKotlinClasspath = (buildGradle) =>
  buildGradle.replace(TEMPLATE_KOTLIN_CLASSPATH, "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')");

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withPlainKotlinClasspath = (config) =>
  withProjectBuildGradle(config, (c) => {
    c.modResults.contents = plainKotlinClasspath(c.modResults.contents);
    return c;
  });

module.exports = withPlainKotlinClasspath;
module.exports.plainKotlinClasspath = plainKotlinClasspath;
