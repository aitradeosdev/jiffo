/**
 * ErrandsService, for a service it depends on in turn (presence, through agents' selfie checks): looked up
 * by this when needed, so neither file imports the other.
 */
export const ERRANDS = Symbol('ERRANDS');
