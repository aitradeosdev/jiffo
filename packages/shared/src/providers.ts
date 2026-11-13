/**
 * The services Jiffo uses from outside providers, and which providers it can use for each. Admin chooses
 * one per category and enters its keys in the panel; the keys are stored encrypted and never shown again.
 */
export const PROVIDER_CATEGORIES = ['payments', 'sms', 'identity', 'calls', 'push', 'maps', 'storage'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export const PROVIDER_CATEGORY_INFO: Record<ProviderCategory, { label: string; about: string }> = {
  payments: {
    label: 'Payments',
    about:
      'Top-ups by bank transfer, payouts to agents, and the bank list. Top-ups already started finish with the provider that started them.',
  },
  sms: { label: 'SMS', about: 'Sign-in codes by text message.' },
  identity: {
    label: 'Identity checks',
    about: "Agents' NIN, BVN, selfie and address. Checks already started finish with the provider that started them.",
  },
  calls: { label: 'Calls', about: 'Masked calls between a customer and their agent.' },
  push: { label: 'Push notifications', about: 'Notifications to the apps.' },
  maps: { label: 'Maps', about: 'Place search and driving distances for prices.' },
  storage: {
    label: 'File storage',
    about:
      'Photos of receipts, items and drop-offs. Changing the bucket does not move files already stored: copy them first.',
  },
};

export interface ProviderField {
  key: string;
  label: string;
  /** Stored encrypted, never shown again after saving; only its last characters are. */
  secret: boolean;
  required: boolean;
  hint?: string;
  placeholder?: string;
  /** A long value, such as a JSON file's contents. */
  multiline?: boolean;
}

export interface ProviderInfo {
  key: string;
  category: ProviderCategory;
  name: string;
  about: string;
  fields: ProviderField[];
  /** Where the provider should send its webhooks, under the API's address. {token} is filled in by the API. */
  webhookPath?: string;
  /** Where in the provider's dashboard that address goes. */
  webhookHint?: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    key: 'paystack',
    category: 'payments',
    name: 'Paystack',
    about: 'Dedicated bank-transfer accounts for top-ups, and transfers for payouts.',
    webhookPath: '/v1/webhooks/paystack',
    fields: [
      {
        key: 'secretKey',
        label: 'Secret key',
        secret: true,
        required: true,
        placeholder: 'sk_live_…',
        hint: 'Settings, API keys and webhooks, in the Paystack dashboard.',
      },
    ],
  },
  {
    key: 'termii',
    category: 'sms',
    name: 'Termii',
    about: 'SMS to Nigerian numbers on a registered sender ID.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'senderId',
        label: 'Sender ID',
        secret: false,
        required: true,
        placeholder: 'Jiffo',
        hint: 'Approved in your Termii account. Up to 11 letters.',
      },
      {
        key: 'baseUrl',
        label: 'API address',
        secret: false,
        required: false,
        placeholder: 'https://api.ng.termii.com',
        hint: 'The one shown in your Termii dashboard, if it differs.',
      },
    ],
  },
  {
    key: 'africastalking',
    category: 'sms',
    name: "Africa's Talking",
    about: 'SMS to Nigerian numbers, from your sender ID or their shared short code.',
    fields: [
      {
        key: 'username',
        label: 'Username',
        secret: false,
        required: true,
        hint: 'Your app\'s username in the Africa\'s Talking dashboard. "sandbox" uses their sandbox.',
      },
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'senderId',
        label: 'Sender ID',
        secret: false,
        required: false,
        placeholder: 'Jiffo',
        hint: "Approved with Africa's Talking. Leave empty to send from their shared short code.",
      },
    ],
  },
  {
    key: 'africastalking',
    category: 'calls',
    name: "Africa's Talking Voice",
    about: "Rings the caller from your Africa's Talking number, then connects them to the other person.",
    webhookPath: '/v1/webhooks/calls/africastalking/{token}',
    webhookHint: "Set it as the callback URL of the voice number in the Africa's Talking dashboard.",
    fields: [
      { key: 'username', label: 'Username', secret: false, required: true },
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'phoneNumber',
        label: 'Voice number',
        secret: false,
        required: true,
        placeholder: '+234…',
        hint: "Your voice number with Africa's Talking. Both people see this number, never each other's.",
      },
    ],
  },
  {
    key: 'twilio',
    category: 'calls',
    name: 'Twilio',
    about: 'Rings the caller from your Twilio number, then connects them to the other person.',
    fields: [
      { key: 'accountSid', label: 'Account SID', secret: false, required: true, placeholder: 'AC…' },
      { key: 'authToken', label: 'Auth token', secret: true, required: true },
      {
        key: 'fromNumber',
        label: 'Twilio number',
        secret: false,
        required: true,
        placeholder: '+…',
        hint: "A voice number you own with Twilio. Both people see this number, never each other's.",
      },
    ],
  },
  {
    key: 'fcm',
    category: 'push',
    name: 'Firebase Cloud Messaging',
    about: 'Push notifications to both apps on Android and iPhone.',
    fields: [
      {
        key: 'serviceAccountJson',
        label: 'Service account key (JSON)',
        secret: true,
        required: true,
        multiline: true,
        hint: 'Project settings, Service accounts, Generate new private key, in the Firebase console. Paste the whole file.',
      },
    ],
  },
  {
    key: 'google',
    category: 'maps',
    name: 'Google Maps Platform',
    about: 'Places search and the Routes API for driving distances.',
    fields: [
      {
        key: 'apiKey',
        label: 'Server API key',
        secret: true,
        required: true,
        hint: 'With the Places API (New) and Routes API enabled, and restricted to the API server.',
      },
    ],
  },
  {
    key: 's3',
    category: 'storage',
    name: 'S3-compatible storage',
    about: 'Amazon S3, Cloudflare R2, DigitalOcean Spaces or any store that speaks S3.',
    fields: [
      { key: 'bucket', label: 'Bucket', secret: false, required: true },
      { key: 'region', label: 'Region', secret: false, required: true, placeholder: 'af-south-1' },
      {
        key: 'endpoint',
        label: 'Endpoint',
        secret: false,
        required: false,
        placeholder: 'https://…',
        hint: 'Leave empty for Amazon S3. Needed for R2, Spaces and others.',
      },
      { key: 'accessKeyId', label: 'Access key ID', secret: true, required: true },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true, required: true },
    ],
  },
];

export const providerInfo = (category: string, key: string) =>
  PROVIDERS.find((p) => p.category === category && p.key === key);

export const isProviderCategory = (value: string): value is ProviderCategory =>
  (PROVIDER_CATEGORIES as readonly string[]).includes(value);

/** "••••7f3a": the last characters of a saved secret, enough to tell which key it is. */
export const secretHint = (value: string) => `••••${value.slice(-4)}`;
