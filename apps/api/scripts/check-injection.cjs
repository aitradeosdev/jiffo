/**
 * Checks the compiled API for constructor dependencies that come out undefined. An import cycle does that in
 * the CommonJS build (a class used before its file has finished loading), and Nest then can't start, while
 * the tests, which load the source differently, pass. Run after `nest build`: node scripts/check-injection.cjs
 */
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', process.argv[2] ?? 'dist');
// Placeholder settings, so modules that read their config when loaded can be loaded. Nothing connects.
Object.assign(process.env, {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://check@localhost:1/none',
  JWT_SECRET: process.env.JWT_SECRET ?? 'a'.repeat(64),
  OTP_SECRET: process.env.OTP_SECRET ?? 'b'.repeat(64),
  PIN_KEY: process.env.PIN_KEY ?? 'c'.repeat(64),
});

// Loaded the way main.js loads them, first, so a cycle shows up as it would in production.
require(path.join(root, 'app.module.js'));
const broken = [];
const walk = (dir) => {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file);
    // Scripts that run when loaded are left out.
    else if (file.endsWith('.js') && !/(main|admin-cli|seed|migrate|fields-backfill)\.js$/.test(file)) {
      for (const [exported, value] of Object.entries(require(file))) {
        if (typeof value !== 'function') continue;
        const types = Reflect.getMetadata('design:paramtypes', value);
        if (types?.some((t) => t === undefined)) {
          broken.push(
            `${path.relative(root, file)}: ${exported}(${types.map((t) => t?.name ?? 'undefined').join(', ')})`,
          );
        }
      }
    }
  }
};
walk(root);
if (broken.length) {
  console.error(`Constructor dependencies that are undefined in the build (an import cycle?):\n${broken.join('\n')}`);
  process.exit(1);
}
console.log('Every constructor dependency in the build resolves.');
process.exit(0);
