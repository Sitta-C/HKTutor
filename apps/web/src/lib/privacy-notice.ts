/**
 * S1-T11 canonical privacy notice content and consent contract.
 *
 * This module is the single source of truth for the notice text, its version string, and the
 * consent payload shape. The `/privacy` page renders it, the registration consent control links to
 * it, and the API persists `policyVersion` from `PRIVACY_POLICY_VERSION` with the Local User.
 * Update `PRIVACY_POLICY_VERSION` whenever the notice text changes so
 * stored consent stays attributable to the wording the user actually accepted.
 *
 * The notice body is English only. The short consent line rendered beside the registration
 * checkbox is translated through `@/lib/i18n`; translating the full notice is follow-up work that
 * must ship with its own version bump so each language is attributable to one accepted wording.
 */

export const PRIVACY_POLICY_VERSION = '2026-09-08';

export const PRIVACY_NOTICE_PATH = '/privacy';

export const CONSENT_REQUIRED_MESSAGE =
  'You must accept the privacy notice before an HKTutor account can be created.';

export interface PrivacyNoticeSection {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly bullets: readonly string[];
}

export interface PrivacyNotice {
  readonly title: string;
  readonly version: string;
  readonly effectiveDate: string;
  readonly summary: string;
  readonly sections: readonly PrivacyNoticeSection[];
}

export const PRIVACY_NOTICE: PrivacyNotice = {
  title: 'HKTutor Privacy Notice',
  version: PRIVACY_POLICY_VERSION,
  effectiveDate: '8 September 2026',
  summary:
    'HKTutor is an online tutor marketplace built as a university course project. This notice ' +
    'explains which personal data is collected when you register, who processes it, why it is ' +
    'needed, and how long it is kept. You must accept this notice before HKTutor creates your ' +
    'account record.',
  sections: [
    {
      heading: '1. Who is responsible for your data',
      paragraphs: [
        'The HKTutor project team operates this service as a student team project and decides why ' +
          'and how personal data is processed. The team runs the Next.js web application and the ' +
          'NestJS API that together form HKTutor.',
        'Because HKTutor is a course project, the platform is used for demonstration and ' +
          'coursework assessment. Do not upload personal data that you would not want reviewed by ' +
          'the project team or the course staff.',
      ],
      bullets: [],
    },
    {
      heading: '2. How sign-in credentials are processed',
      paragraphs: [
        'HKTutor operates its own sign-up, sign-in, email verification, and session system. The API ' +
          'stores a one-way password hash rather than your password and issues short-lived access ' +
          'tokens plus a refresh-session cookie.',
        'HKTutor uses Resend to deliver account verification emails. Resend processes the recipient ' +
          'address and delivery metadata needed to send those messages.',
      ],
      bullets: [
        'Account security data includes your email address, password hash, email verification state, ' +
          'and revocable refresh-session records.',
        'Verification links are random, expire after a limited period, and are stored by HKTutor ' +
          'only as one-way hashes.',
      ],
    },
    {
      heading: '3. What HKTutor stores about you',
      paragraphs: [
        'The HKTutor API stores application data in a managed Supabase PostgreSQL database, and ' +
          'stores tutor qualification documents in a private Supabase storage bucket that is only ' +
          'reachable through short-lived signed links issued by the API.',
      ],
      bullets: [
        'Account record: email address, password hash, role (student or tutor), account ' +
          'status, the time you accepted this notice, and the version you accepted.',
        'Tutor records: display name, biography, years of experience, verification status, ' +
          'teaching listings, prices, and availability slots.',
        'Activity records: bookings, cancellations and reschedule requests, chat messages with the ' +
          'other party, notifications, reviews you write, and mock payment references.',
        'Security records: an append-only audit log of security-relevant actions, holding the ' +
          'acting account, the action, and a redacted snapshot of what changed.',
      ],
    },
    {
      heading: '4. Why HKTutor needs this data',
      paragraphs: [
        'Each category of data is collected for a stated purpose and is not reused for unrelated ' +
          'purposes.',
      ],
      bullets: [
        'To create and secure your account, and to apply the role and ownership rules that keep ' +
          'your records private from other users.',
        'To let students search tutors, and to let tutors publish listings and availability.',
        'To create, confirm, reschedule, cancel, and complete bookings, and to send you the ' +
          'related in-app notifications and reminders.',
        'To verify tutor qualifications before a listing may be published.',
        'To investigate misuse and to keep an accurate record of security-relevant changes.',
      ],
    },
    {
      heading: '5. Consent is required before your account is created',
      paragraphs: [
        'Accepting this notice is a required step of onboarding. If you do not accept it, HKTutor ' +
          'creates no account record and no tutor or student profile.',
        'When you accept, HKTutor records the moment of acceptance and the version of this notice ' +
          'shown to you, so it is always clear which wording you agreed to. Re-submitting the same ' +
          'onboarding form does not create a second account.',
        'You may withdraw consent by asking the project team to delete your account. Withdrawal ' +
          'does not undo processing that already took place, and records that another user relies ' +
          'on, such as a completed booking, are retained as described below.',
      ],
      bullets: [],
    },
    {
      heading: '6. Who else can see your data',
      paragraphs: [
        'HKTutor does not sell personal data and shows no advertising. Data is shared only where ' +
          'the service cannot work without it.',
      ],
      bullets: [
        'Resend, as the verification-email delivery processor described in section 2.',
        'Supabase, as the managed database and private file storage processor.',
        'The other party to a booking or chat, who sees the profile details, class details, and ' +
          'messages needed to hold the class.',
        'Project administrators, who review tutor verification documents and security audit ' +
          'records.',
      ],
    },
    {
      heading: '7. How long data is kept',
      paragraphs: [
        'Accounts, listings, and availability slots are deactivated by marking them deleted rather ' +
          'than by erasing rows, so that bookings, payments, and reviews that reference them stay ' +
          'accurate. Audit log entries are append-only and are never edited after they are written.',
        'When the course project ends, the shared demonstration database and storage bucket are ' +
          'the project team responsibility and may be removed together with the data they hold.',
      ],
      bullets: [],
    },
    {
      heading: '8. Your choices and how to contact us',
      paragraphs: [
        'You can ask the project team to give you a copy of your account data, correct it, or ' +
          'delete your account. Because this is a demonstration project, password and email changes ' +
          'are handled by the project team until self-service account settings are added.',
        'Contact route: the HKTutor project team, through the contact address published in the ' +
          'project repository README. This is a course project, so please allow for reply times ' +
          'outside teaching hours.',
      ],
      bullets: [],
    },
    {
      heading: '9. How your data is protected',
      paragraphs: [
        'The API is the only component that talks to the database and to file storage. Browser ' +
          'code never receives a database connection string or a service key.',
      ],
      bullets: [
        'All deployed connections between the browser, the API, Resend, and Supabase use TLS.',
        'Every request to a protected endpoint is checked against the signed JWT session and then ' +
          'against local role, account status, and ownership rules.',
        'Tutor documents live in a private bucket and are opened only through signed links that ' +
          'expire within minutes.',
        'Session tokens, database credentials, and service keys are never written to logs, API ' +
          'documentation, or error responses.',
      ],
    },
    {
      heading: '10. Changes to this notice',
      paragraphs: [
        'If the wording changes in a way that affects what is collected or why, HKTutor publishes ' +
          'the notice under a new version and asks you to accept it again before you continue. ' +
          `The current version is ${PRIVACY_POLICY_VERSION}.`,
      ],
      bullets: [],
    },
  ],
};

export interface OnboardingConsent {
  readonly consent: boolean;
  readonly policyVersion: string;
}

/**
 * Builds the consent fields that S1-T12 persists with the Local User onboarding transaction.
 * Returning the version alongside the decision keeps the accepted wording attributable even if
 * the notice is revised between the moment the form is rendered and the moment it is submitted.
 */
export const buildOnboardingConsent = (accepted: boolean): OnboardingConsent => ({
  consent: accepted,
  policyVersion: PRIVACY_POLICY_VERSION,
});
