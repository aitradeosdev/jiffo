import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { pickPhoto, uploadPhoto } from '@/api/upload';
import { useErrand } from '@/errands/use-errand';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Icon } from '@/ui/parts';

type Shot = { uri: string; mimeType: string };

/** A no-contact drop-off: a photo of where the items were left, which the customer approves. */
export default function DropoffPhoto() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { api } = useSession();
  const { errand, act, actionError } = useErrand(id);
  const [shot, setShot] = useState<Shot | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drop = errand?.stops[errand.stops.length - 1];

  const take = async () => setShot((await pickPhoto('camera')) ?? shot);
  // Straight to the camera, as in the prototype.
  useEffect(() => {
    void pickPhoto('camera').then((file) => file && setShot(file));
  }, []);

  const send = async () => {
    if (!shot || !errand) return;
    setSending(true);
    setError(null);
    try {
      const photo = await uploadPhoto(api, errand.id, 'dropoff_photo', shot);
      if (await act('send_dropoff_photo', { photo })) router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
      <View style={styles.head}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={goBack} style={styles.ib}>
          <Icon name="x" size={24} color="#FFFFFF" />
        </Pressable>
        <Text style={styles.title}>Drop-off photo</Text>
        <View style={styles.ib} />
      </View>
      <View style={styles.body}>
        {shot ? (
          <View style={styles.frame}>
            <Image
              source={{ uri: shot.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              accessibilityLabel="Your drop-off photo"
            />
            {drop ? (
              <View style={styles.stamp}>
                <Icon name="pin" size={13} color="#FFFFFF" />
                <Text style={styles.stampText} numberOfLines={1}>
                  {drop.label ?? drop.address}
                </Text>
              </View>
            ) : null}
          </View>
        ) : (
          <Button
            label="Take photo"
            icon={<Icon name="camera" size={19} color="#000000" />}
            onPress={take}
            tint={{ bg: '#FFFFFF', fg: '#000000' }}
          />
        )}
        <Text style={styles.note}>Make sure it is sharp and shows where you left the items.</Text>
        {error || actionError ? (
          <Text style={[styles.note, { color: '#F87171' }]} accessibilityLiveRegion="polite">
            {error ?? actionError}
          </Text>
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button label="Retake" onPress={take} tint={{ bg: '#2B2B2B', fg: '#FFFFFF' }} style={styles.half} />
        <Button
          label="Send photo"
          disabled={!shot}
          loading={sending}
          onPress={send}
          tint={{ bg: '#FFFFFF', fg: '#000000' }}
          style={styles.half}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#000000' },
  head: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingHorizontal: 10 },
  ib: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 17 },
  body: { flex: 1, justifyContent: 'center', gap: 18, paddingHorizontal: 16 },
  frame: { aspectRatio: 0.8, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1F1F1F' },
  stamp: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.66)',
  },
  stampText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 13, flex: 1 },
  note: { color: '#CFCFCF', textAlign: 'center', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10, padding: 16 },
  half: { flex: 1 },
});
