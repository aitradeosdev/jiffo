import type { useSmileIDMlkitFace } from '@smileid/usesmileid_mlkit_face';

/** The face detector Smile ID's SDK uses: Apple's Vision on iOS, ML Kit on Android (smile-face.*.ts). */
export const faceAnalyzer: typeof useSmileIDMlkitFace | null = null;
