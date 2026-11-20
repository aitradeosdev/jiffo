import { writeFileSync } from 'node:fs';
import { switchCommand } from './switch';

const run = switchCommand(process.argv.slice(2), process.env);
if (run.file) writeFileSync(run.file.path, run.file.text);
(run.code ? process.stderr : process.stdout).write(run.out);
process.exitCode = run.code;
