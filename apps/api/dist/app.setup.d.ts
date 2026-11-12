import type { INestApplication } from '@nestjs/common';
/** Shared by main.ts and the tests, so the tests run the app exactly as production does. */
export declare function configureApp(app: INestApplication): INestApplication<any>;
