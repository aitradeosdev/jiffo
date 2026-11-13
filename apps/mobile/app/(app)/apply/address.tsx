import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { ProviderName, useApplication, type Application } from '@/agent/application';
import { FieldGroup, Waiting } from '@/agent/apply-parts';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Flag, ObScreen, Question, TextBox } from '@/ui/onboarding';
import { Chip } from '@/ui/parts';

const RELATIONSHIPS = ['Parent', 'Sibling', 'Spouse', 'Friend', 'Other'];

/** "803 447 1902": the local number in groups, as the prototype shows it. */
const spaced = (text: string) => {
  const d = text.replace(/\D/g, '').slice(0, 10);
  return [d.slice(0, 3), d.slice(3, 6), d.slice(6)].filter(Boolean).join(' ');
};

/** Where the agent lives, which the provider confirms, and who to call in an emergency. */
export default function Address() {
  const c = useColors();
  const { api } = useSession();
  const { app, setApp } = useApplication();
  const { config } = useCountryConfig();
  const prefix = config?.country.phonePrefix ?? '+234';
  const saved = app?.emergency;
  const [address, setAddress] = useState(app?.address ?? '');
  const [name, setName] = useState(saved?.name ?? '');
  const [phone, setPhone] = useState(spaced(saved?.phone?.replace(prefix, '') ?? ''));
  const [relationship, setRelationship] = useState(saved?.relationship ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const local = phone.replace(/\D/g, '');
  const ready = address.trim().length >= 8 && name.trim().length >= 2 && local.length === 10;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setApp(
        await api.put<Application>('/v1/agent/application/address', {
          address: address.trim(),
          emergency: {
            name: name.trim(),
            phone: `${prefix}${local}`,
            ...(relationship ? { relationship } : {}),
          },
        }),
      );
      router.dismissTo('/apply');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ObScreen
      onBack={() => router.dismissTo('/apply')}
      footer={<Button label="Save" onPress={save} disabled={!ready} loading={busy} />}
    >
      <Question title="Address and emergency contact" />
      <FieldGroup
        label="Home address"
        note={`${[app?.area, app?.stateName].filter(Boolean).join(', ')}. Only our safety team sees it.`}
      >
        <TextBox
          accessibilityLabel="Home address"
          value={address}
          onChangeText={setAddress}
          autoComplete="street-address"
          textContentType="fullStreetAddress"
        />
      </FieldGroup>
      <Waiting
        icon="shield"
        title={`${ProviderName(app)} confirms this address`}
        sub="When you submit. They may send a field agent to visit."
      />
      <View style={{ gap: 4, marginTop: 4 }}>
        <Text variant="sec">Emergency contact</Text>
        <Text variant="note" tone="ink3">
          We only call them in an emergency, or if we can&apos;t reach you during an errand.
        </Text>
      </View>
      <FieldGroup label="Name">
        <TextBox accessibilityLabel="Emergency contact name" value={name} onChangeText={setName} autoComplete="name" />
      </FieldGroup>
      <FieldGroup label="Phone number">
        <View style={styles.tel}>
          <View style={[styles.code, { backgroundColor: c.surface2 }]}>
            <Flag country={config?.country.code ?? 'NG'} />
            <Text style={styles.codeText}>{prefix}</Text>
          </View>
          <TextBox
            accessibilityLabel="Emergency contact phone number"
            style={{ flex: 1 }}
            inputMode="numeric"
            keyboardType="phone-pad"
            placeholder="803 000 0000"
            value={phone}
            onChangeText={(t) => setPhone(spaced(t))}
          />
        </View>
      </FieldGroup>
      <FieldGroup label="Relationship">
        <View style={styles.chips}>
          {RELATIONSHIPS.map((r) => (
            <Chip key={r} label={r} selected={relationship === r} onPress={() => setRelationship(r)} />
          ))}
        </View>
      </FieldGroup>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  tel: { flexDirection: 'row', gap: 8 },
  code: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, paddingHorizontal: 12, borderRadius: 10 },
  codeText: { fontFamily: fonts.semibold, fontSize: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
