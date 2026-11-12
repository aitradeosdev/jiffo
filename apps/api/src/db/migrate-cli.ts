import { loadConfig } from '../config/app-config';
import { runMigrations } from './migrate';

runMigrations(loadConfig().DATABASE_URL)
  .then(() => process.stdout.write('Migrations applied\n'))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
