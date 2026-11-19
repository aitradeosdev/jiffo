import { useLocalSearchParams } from 'expo-router';
import { errandIdParam } from '@/links';

/** No errand has it, so the API answers that the errand wasn't found. */
const NO_ERRAND = '00000000-0000-0000-0000-000000000000';

/** The errand's id from the screen's address, checked, since it goes into API paths (MB5). */
export function useErrandId(): string {
  const { id } = useLocalSearchParams<{ id: string }>();
  return errandIdParam(id) ?? NO_ERRAND;
}
