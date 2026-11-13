import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useApplication, type Application } from '@/agent/application';
import { FieldGroup, SelectButton } from '@/agent/apply-parts';
import { Button, Text } from '@/ui/kit';
import { ModalSheet } from '@/ui/modal-sheet';
import { ObScreen, Question, TextBox } from '@/ui/onboarding';
import { Badge, CheckMark, List, Row } from '@/ui/parts';

/** About you: the name as on the NIN, the state the agent works in and their starting area. */
export default function Basics() {
  const { api, user, updateProfile } = useSession();
  const { app, setApp } = useApplication();
  const { config } = useCountryConfig();
  const [first, setFirst] = useState(user?.firstName ?? '');
  const [last, setLast] = useState(user?.lastName ?? '');
  const [stateCode, setStateCode] = useState(app?.stateCode ?? null);
  const [area, setArea] = useState(app?.area ?? '');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const states = config?.states ?? [];
  const state = states.find((s) => s.code === stateCode);
  const open = state?.agentSignups !== 'waitlist';
  const ready = first.trim().length > 0 && last.trim().length > 0 && !!state && area.trim().length > 0;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (first.trim() !== user?.firstName || last.trim() !== user?.lastName) {
        await updateProfile({ firstName: first.trim(), lastName: last.trim() });
      }
      setApp(await api.patch<Application>('/v1/agent/application', { stateCode, area: area.trim() }));
      // The application shows the checklist, or the waitlist for a state that is full.
      router.dismissTo('/apply');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ObScreen
      onBack={router.canGoBack() ? () => router.back() : undefined}
      footer={
        <Button label={open ? 'Continue' : 'Join the waitlist'} onPress={save} disabled={!ready} loading={busy} />
      }
    >
      <Question title="Tell us about you" sub="Use the name on your NIN. Customers see your first name and photo." />
      <View style={styles.pair}>
        <TextBox
          accessibilityLabel="First name"
          placeholder="First name"
          style={{ flex: 1 }}
          value={first}
          onChangeText={setFirst}
          autoComplete="given-name"
          textContentType="givenName"
        />
        <TextBox
          accessibilityLabel="Last name"
          placeholder="Last name"
          style={{ flex: 1 }}
          value={last}
          onChangeText={setLast}
          autoComplete="family-name"
          textContentType="familyName"
        />
      </View>
      <FieldGroup label="State you'll work in">
        <SelectButton
          label="State you'll work in"
          value={state?.name ?? null}
          placeholder="Choose a state"
          badge={state && !open ? <Badge label="Waitlist" tone="urgent" /> : null}
          onPress={() => setPicking(true)}
        />
      </FieldGroup>
      <FieldGroup
        label="Area"
        note="Errands come from around where you are when online. This only sets your starting area."
      >
        <TextBox accessibilityLabel="Area" placeholder="For example Lekki" value={area} onChangeText={setArea} />
      </FieldGroup>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <ModalSheet visible={picking} onClose={() => setPicking(false)} label="Choose a state">
        <Text variant="heading">State you&apos;ll work in</Text>
        <List inset={0}>
          {states.map((s) => (
            <Row
              key={s.code}
              title={s.name}
              subtitle={s.agentSignups === 'waitlist' ? 'Waitlist for new agents' : null}
              selected={s.code === stateCode}
              right={<CheckMark on={s.code === stateCode} />}
              onPress={() => {
                setStateCode(s.code);
                setPicking(false);
              }}
            />
          ))}
        </List>
      </ModalSheet>
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 8 },
});
