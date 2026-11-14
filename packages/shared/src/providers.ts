import type { IdType } from './identity';
/**
 * The services Jiffo uses from outside providers, and which providers it can use for each. Admin chooses
 * one per category and enters its keys in the panel; the keys are stored encrypted and never shown again.
 */
export const PROVIDER_CATEGORIES = [
  'payments',
  'sms',
  'identity',
  'calls',
  'push',
  'maps',
  'storage',
  'email',
] as const;
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
  email: {
    label: 'Email',
    about:
      "Invites and access resets for the admin team. Links go only to the teammate's own address, never to whoever made them.",
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
  /** Identity providers: the IDs it checks, each with a selfie matched to the ID's photo. */
  idTypes?: IdType[];
  /** Identity providers: whether it can check a BVN in the same check as another ID. */
  bvnAlongside?: boolean;
  /** Identity providers: the person picks their ID on the provider's own page, set up in its dashboard. */
  idChosenOnPage?: boolean;
  /**
   * Payments providers that can give each customer their own fixed account number, and what the customer
   * gives for it (passed to the provider, never kept).
   */
  fixedAccounts?: FixedAccountNeeds;
}

/** What a customer gives to get their own fixed account number: their BVN, and a bank account in their name. */
export type FixedAccountNeeds = 'nothing' | 'bvn' | 'bvn_and_bank';

export const PROVIDERS: ProviderInfo[] = [
  {
    key: 'paystack',
    category: 'payments',
    name: 'Paystack',
    about:
      "One-time bank-transfer account numbers for top-ups, each customer's own dedicated account number, and transfers for payouts.",
    webhookPath: '/v1/webhooks/paystack',
    // Paystack identifies the customer (BVN and a bank account in their name) before a dedicated account.
    fixedAccounts: 'bvn_and_bank',
    fields: [
      {
        key: 'secretKey',
        label: 'Secret key',
        secret: true,
        required: true,
        placeholder: 'sk_live_…',
        hint: 'Settings, API keys and webhooks, in the Paystack dashboard.',
      },
      {
        key: 'dedicatedBank',
        label: 'Bank for dedicated accounts',
        secret: false,
        required: false,
        placeholder: 'wema-bank',
        hint: "The bank's slug Paystack issues dedicated accounts from (Dedicated accounts, in the dashboard). Test keys always use Paystack's test bank.",
      },
      {
        key: 'fixedAccountFee',
        label: 'Fee per fixed account issued (₦)',
        secret: false,
        required: false,
        placeholder: '0',
        hint: "Only if the provider takes a fee from Jiffo's balance with it for each customer's own account number. Counted as a cost when one is issued.",
      },
    ],
  },
  {
    key: 'flutterwave',
    category: 'payments',
    name: 'Flutterwave',
    about:
      "One-time bank-transfer account numbers for top-ups, each customer's own static account number, and transfers for payouts.",
    webhookPath: '/v1/webhooks/flutterwave',
    // A static account needs the customer's BVN.
    fixedAccounts: 'bvn',
    webhookHint:
      'Set it as the webhook URL in Settings, Webhooks, in the Flutterwave dashboard, with the same secret hash as below.',
    fields: [
      {
        key: 'secretKey',
        label: 'Secret key',
        secret: true,
        required: true,
        placeholder: 'FLWSECK-…',
        hint: 'Settings, API keys, in the Flutterwave dashboard.',
      },
      {
        key: 'secretHash',
        label: 'Webhook secret hash',
        secret: true,
        required: true,
        hint: 'A long random value you choose, set the same here and in Settings, Webhooks. Flutterwave sends it with every webhook.',
      },
      {
        key: 'businessName',
        label: 'Name on the account',
        secret: false,
        required: true,
        placeholder: 'Jiffo',
        hint: 'What customers see as the account name when they transfer.',
      },
      {
        key: 'fixedAccountFee',
        label: 'Fee per fixed account issued (₦)',
        secret: false,
        required: false,
        placeholder: '0',
        hint: "Only if the provider takes a fee from Jiffo's balance with it for each customer's own account number. Counted as a cost when one is issued.",
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
    key: 'smileid',
    category: 'identity',
    name: 'Smile ID',
    // NIN, BVN and voter's card against the issuer's photo; licence and passport against the document's.
    idTypes: ['nin', 'bvn', 'voters_card', 'drivers_licence', 'passport'],
    bvnAlongside: false,
    about:
      "On Smile ID's own page: the person's ID and a selfie with a liveness check, matched to the photo the issuer or the document holds. Smile ID doesn't check addresses, so our team looks at those.",
    webhookPath: '/v1/webhooks/identity/smileid',
    webhookHint: 'Sent with each check, so nothing needs setting in the Smile ID portal.',
    fields: [
      {
        key: 'partnerId',
        label: 'Partner ID',
        secret: false,
        required: true,
        hint: 'In the Smile ID portal, under API keys.',
      },
      { key: 'apiKey', label: 'API key', secret: true, required: true },
      {
        key: 'privacyPolicyUrl',
        label: 'Privacy notice address',
        secret: false,
        required: true,
        placeholder: 'https://jiffoapp.com/privacy',
        hint: "Jiffo's privacy notice, which Smile ID shows the agent before they agree. Must start with https.",
      },
      {
        key: 'mode',
        label: 'Mode',
        secret: false,
        required: false,
        placeholder: 'live',
        hint: "Type sandbox to use Smile ID's test environment, with its test keys.",
      },
    ],
  },
  {
    key: 'dojah',
    category: 'identity',
    name: 'Dojah',
    idTypes: ['nin', 'bvn', 'drivers_licence', 'passport'],
    bvnAlongside: true,
    idChosenOnPage: true,
    about:
      "Dojah's EasyOnboard widget, with the steps you set up in the Dojah dashboard: for customers the NIN or BVN and a selfie; for agents the IDs you accept from them (add BVN to the government data step) and a selfie. Dojah's agent visits addresses.",
    webhookPath: '/v1/webhooks/identity/dojah',
    webhookHint: 'Subscribe it for the kyc_widget service under Developers, Webhooks in the Dojah dashboard.',
    fields: [
      { key: 'appId', label: 'App ID', secret: false, required: true },
      { key: 'secretKey', label: 'Secret key', secret: true, required: true },
      {
        key: 'publicKey',
        label: 'Public key',
        secret: false,
        required: true,
        hint: 'Used by the widget in the browser; Dojah makes it public by design.',
      },
      {
        key: 'widgetId',
        label: 'Widget ID for agents',
        secret: false,
        required: true,
        hint: 'The EasyOnboard flow agents use: the IDs you accept from them, and the selfie.',
      },
      {
        key: 'customerWidgetId',
        label: 'Widget ID for customers',
        secret: false,
        required: false,
        hint: "A flow with only the government data step (NIN or BVN) and the selfie: customers don't photograph a document. Without it customers use the agents' flow, and one who picks a document there goes to our team.",
      },
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        required: true,
        hint: 'The Secret shown for the webhook under Developers, Webhooks. Not the secret key.',
      },
      {
        key: 'mode',
        label: 'Mode',
        secret: false,
        required: false,
        placeholder: 'live',
        hint: "Type sandbox to use Dojah's sandbox, with its test keys.",
      },
    ],
  },
  {
    key: 'youverify',
    category: 'identity',
    name: 'Youverify',
    // Youverify documents a face match for the NIN; the licence's is to be confirmed with them.
    idTypes: ['nin', 'drivers_licence'],
    bvnAlongside: true,
    about:
      "Youverify's liveness check and ID check with face match, on a page Jiffo serves, with the BVN looked up alongside when needed. Addresses are checked by our team.",
    fields: [
      { key: 'secretKey', label: 'API secret key', secret: true, required: true },
      {
        key: 'publicMerchantKey',
        label: 'Public merchant key',
        secret: false,
        required: true,
        hint: 'Starts the liveness check in the browser; Youverify makes it public by design.',
      },
      {
        key: 'mode',
        label: 'Mode',
        secret: false,
        required: false,
        placeholder: 'live',
        hint: "Type sandbox to use Youverify's sandbox, with its sandbox keys.",
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
  {
    key: 'resend',
    category: 'email',
    name: 'Resend',
    about: 'Email through Resend.',
    fields: [
      { key: 'apiKey', label: 'API key', secret: true, required: true, hint: 'A sending-only key is enough.' },
      {
        key: 'from',
        label: 'Send from',
        secret: false,
        required: true,
        placeholder: 'Jiffo <team@jiffoapp.com>',
        hint: 'An address on a domain verified with the provider.',
      },
    ],
  },
  {
    key: 'postmark',
    category: 'email',
    name: 'Postmark',
    about: "Email through Postmark's transactional stream.",
    fields: [
      { key: 'serverToken', label: 'Server API token', secret: true, required: true },
      {
        key: 'from',
        label: 'Send from',
        secret: false,
        required: true,
        placeholder: 'Jiffo <team@jiffoapp.com>',
        hint: 'An address on a domain verified with the provider.',
      },
    ],
  },
  {
    key: 'ses',
    category: 'email',
    name: 'Amazon SES',
    about: "Email through Amazon SES. The account must be out of SES's sandbox to reach any address.",
    fields: [
      { key: 'region', label: 'Region', secret: false, required: true, placeholder: 'eu-west-1' },
      {
        key: 'accessKeyId',
        label: 'Access key ID',
        secret: true,
        required: true,
        hint: 'For a user allowed only ses:SendEmail and ses:GetAccount.',
      },
      { key: 'secretAccessKey', label: 'Secret access key', secret: true, required: true },
      {
        key: 'from',
        label: 'Send from',
        secret: false,
        required: true,
        placeholder: 'Jiffo <team@jiffoapp.com>',
        hint: 'An address on a domain verified with the provider.',
      },
    ],
  },
];

export const providerInfo = (category: string, key: string) =>
  PROVIDERS.find((p) => p.category === category && p.key === key);

export const isProviderCategory = (value: string): value is ProviderCategory =>
  (PROVIDER_CATEGORIES as readonly string[]).includes(value);

/** "••••7f3a": the last characters of a saved secret, enough to tell which key it is. */
export const secretHint = (value: string) => `••••${value.slice(-4)}`;
