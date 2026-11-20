import { parseArgs } from 'node:util';
import { newSwitchKeys, signSwitch } from './switch';

const USAGE = `The remote switch for the apps' certificate pinning (docs/security/pinning.md).

  keygen
      Makes the switch's key pair. PINNING_SWITCH_KEY goes in the app builds' settings; keep
      PINNING_SWITCH_PRIVATE_KEY as a secret, where only those who may switch pinning off can reach it.

  sign --off --hours <1-168>
      Turns pinning off for that many hours, from now. Upload the printed document to the switch
      address the apps fetch (PINNING_SWITCH_URL), in place of the one there.

  sign --on
      Turns pinning back on before an "off" ends.

  sign reads the private key from PINNING_SWITCH_PRIVATE_KEY.
`;

function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { on: { type: 'boolean' }, off: { type: 'boolean' }, hours: { type: 'string' } },
  });
  const command = positionals[0];
  if (command === 'keygen') {
    const keys = newSwitchKeys();
    process.stdout.write(`PINNING_SWITCH_KEY=${keys.publicKey}\nPINNING_SWITCH_PRIVATE_KEY=${keys.privateKey}\n`);
    return;
  }
  if (command === 'sign' && values.on !== values.off) {
    const privateKey = process.env.PINNING_SWITCH_PRIVATE_KEY ?? '';
    const doc = values.on
      ? signSwitch(privateKey, { pinning: 'on' })
      : signSwitch(privateKey, {
          pinning: 'off',
          hours: values.hours === undefined ? undefined : Number(values.hours),
        });
    process.stdout.write(`${JSON.stringify(doc)}\n`);
    return;
  }
  process.stdout.write(USAGE);
  process.exitCode = command ? 1 : 0;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
