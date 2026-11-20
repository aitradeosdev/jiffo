import { loadConfig } from '../config/app-config';
import { runMigrations } from './migrate';

runMigrations(loadConfig().DATABASE_URL)
  .then(() => process.stdout.write('Migrations applied\n'))
  .catch((error: unknown) => {
    // The message only: the whole error would print the values sent with a failed query (R10, S7).
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
