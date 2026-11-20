import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { ApiClient } from './client';
import { ApiError } from './client';
import { PHOTO_COMPRESS, photoResize } from './photo-size';

export type UploadPurpose = 'receipt' | 'item_photo' | 'dropoff_photo' | 'chat_photo';

interface UploadTicket {
  key: string;
  upload: { url: string; method: 'PUT'; headers: Record<string, string> };
  maxBytes: number;
}

/** Lets the person take or pick one photo. Returns null if they cancel or refuse permission. */
export async function pickPhoto(source: 'camera' | 'library'): Promise<{ uri: string; mimeType: string } | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  // Full quality here: the photo is compressed once, below, as it is saved as JPEG.
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: 'images', quality: 1, allowsEditing: false };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;
  return asJpeg(asset);
}

/**
 * The photo as a JPEG no bigger than the server keeps (docs/security-plan.md, C1): quicker to send, and never
 * a type the server refuses (a WebP from the gallery, say). The server still opens and re-encodes it.
 */
async function asJpeg(asset: ImagePicker.ImagePickerAsset) {
  try {
    const context = ImageManipulator.manipulate(asset.uri);
    const resize = photoResize(asset.width, asset.height);
    if (resize) context.resize(resize);
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_COMPRESS });
    return { uri: saved.uri, mimeType: 'image/jpeg' };
  } catch {
    // Sent as it is: the server says if it can't take it.
    return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
  }
}

/**
 * Uploads one photo for an errand: asks the API for a signed link, PUTs the file straight to storage,
 * and returns the key to send with the action or message.
 */
export async function uploadPhoto(
  api: ApiClient,
  errandId: string,
  purpose: UploadPurpose,
  file: { uri: string; mimeType: string },
) {
  const blob = await (await fetch(file.uri)).blob();
  // The size is signed into the upload link, so the store refuses anything else.
  const ticket = await api.post<UploadTicket>('/v1/uploads', {
    errandId,
    purpose,
    contentType: file.mimeType,
    size: blob.size,
  });
  let res: Response;
  try {
    res = await fetch(ticket.upload.url, { method: ticket.upload.method, headers: ticket.upload.headers, body: blob });
  } catch {
    throw new ApiError(0, 'network_error', 'The photo didn’t upload. Check your connection and try again.');
  }
  if (!res.ok) throw new ApiError(res.status, 'upload_failed', 'The photo didn’t upload. Try again.');
  return ticket.key;
}
