import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { pickPhoto, uploadPhoto } from '@/api/upload';
import { useErrandSubscription, useRealtimeEvent } from '@/realtime/realtime';
import { useColors } from '@/theme/theme';
import { fonts, radius, space } from '@/theme/tokens';
import { Text } from '@/ui/kit';
import { Icon } from '@/ui/parts';

export interface ChatMessage {
  id: number;
  senderId: string | null;
  senderRole: 'customer' | 'agent' | 'system';
  kind: 'text' | 'system' | 'photo';
  body: string;
  photoUrl: string | null;
  clientId: string | null;
  createdAt: string;
}

interface Thread {
  conversation: { id: string; open: boolean };
  messages: ChatMessage[];
}

/** The errand chat, for both apps. Messages arrive live; sends are safe to retry (each carries a client id). */
export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { api, user } = useSession();
  const [thread, setThread] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  useErrandSubscription(id);

  const load = useCallback(async () => {
    try {
      setThread(await api.get<Thread>(`/v1/errands/${id}/messages?limit=200`));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, id]);
  useEffect(() => {
    load();
  }, [load]);

  const add = (m: ChatMessage) =>
    setThread((t) => (t && !t.messages.some((x) => x.id === m.id) ? { ...t, messages: [...t.messages, m] } : t));
  useRealtimeEvent<{ errandId: string; message: ChatMessage }>('message.created', (e) => {
    if (e.errandId === id) add(e.message);
  });
  useEffect(() => {
    if (thread?.messages.length) setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  }, [thread?.messages.length]);

  const send = async (input: { body?: string; photo?: string }) => {
    setSending(true);
    setError(null);
    try {
      add(await api.post<ChatMessage>(`/v1/errands/${id}/messages`, { ...input, clientId: Crypto.randomUUID() }));
      if (input.body) setText('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async () => {
    const file = await pickPhoto('library');
    if (!file) return;
    setSending(true);
    try {
      await send({ photo: await uploadPhoto(api, id, 'chat_photo', file) });
    } catch (e) {
      setError(errorMessage(e));
      setSending(false);
    }
  };

  const open = thread?.conversation.open ?? false;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.head, { borderBottomColor: c.line }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12}>
            <Icon name="arrow-left" size={24} />
          </Pressable>
          <Text variant="heading">Chat</Text>
        </View>
        {!thread ? (
          <View style={styles.center}>{error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}</View>
        ) : (
          <FlatList
            ref={list}
            data={thread.messages}
            keyExtractor={(m) => String(m.id)}
            contentContainerStyle={{ padding: space.lg, gap: space.sm }}
            renderItem={({ item }) => <Bubble message={item} mine={item.senderId === user?.id} />}
            ListEmptyComponent={
              <Text tone="ink3" style={{ textAlign: 'center' }}>
                Agree prices and details here. Anything agreed on a call should be confirmed in chat.
              </Text>
            }
          />
        )}
        {error && thread ? (
          <Text tone="danger" variant="small" style={{ paddingHorizontal: space.lg }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {open ? (
          <View style={[styles.composer, { borderTopColor: c.line }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send a photo"
              onPress={sendPhoto}
              disabled={sending}
              hitSlop={8}
            >
              <Icon name="image" size={22} color={c.ink2} />
            </Pressable>
            <TextInput
              accessibilityLabel="Message"
              value={text}
              onChangeText={setText}
              placeholder="Message"
              placeholderTextColor={c.ink3}
              multiline
              maxLength={2000}
              style={[styles.input, { backgroundColor: c.surface2, color: c.ink, fontFamily: fonts.regular }]}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={sending || !text.trim()}
              onPress={() => send({ body: text.trim() })}
              style={[styles.sendBtn, { backgroundColor: c.ink, opacity: sending || !text.trim() ? 0.4 : 1 }]}
            >
              {sending ? <ActivityIndicator color={c.onInk} /> : <Icon name="send" size={18} color={c.onInk} />}
            </Pressable>
          </View>
        ) : thread ? (
          <Text tone="ink3" style={{ textAlign: 'center', padding: space.lg }}>
            This chat has ended.
          </Text>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const c = useColors();
  if (message.kind === 'system') {
    return (
      <Text variant="small" tone="ink3" style={{ textAlign: 'center', paddingVertical: space.xs }}>
        {message.body}
      </Text>
    );
  }
  return (
    <View
      style={[
        styles.bubble,
        { alignSelf: mine ? 'flex-end' : 'flex-start', backgroundColor: mine ? c.ink : c.surface2 },
      ]}
    >
      {message.photoUrl ? (
        <Image source={{ uri: message.photoUrl }} style={styles.photo} accessibilityLabel="Photo" resizeMode="cover" />
      ) : null}
      {message.body ? <Text style={{ color: mine ? c.onInk : c.ink }}>{message.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: space.xs,
  },
  photo: { width: 200, height: 200, borderRadius: radius.md },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 16,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});
