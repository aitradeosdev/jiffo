import { CaptureType, JobType, UseSmileIDBuilder } from '@smileid/usesmileid';
import type { SelfieCaptureProps } from './selfie-capture.types';
import { faceAnalyzer } from './smile-face';

/**
 * Smile ID's SmartSelfie Authentication, in their own SDK (docs/security-plan.md, I2, I8): a live selfie
 * compared with the face Smile ID kept from the agent's ID check. The token the server gave is for this
 * person and this product only; the verdict goes from Smile ID to the server, never through the app.
 */
export default function SmileCapture({ session, givenNames, lastName, consentedAt, onEnd }: SelfieCaptureProps) {
  return (
    <UseSmileIDBuilder
      builder={(b) => {
        // Crash reports go to our own error reporting, not Smile ID's.
        b.config((c) => {
          c.enableCrashReporting = false;
        });
        b.userId = session.enrolledId;
        b.userDetails = { givenNames, lastName };
        // Agreed on our screen just before, with the notice it showed.
        b.consentInformation = {
          granted: true,
          grantedAt: consentedAt,
          noticeLanguage: 'en',
          noticePrivacyPolicyUrl: session.privacyPolicyUrl ?? '',
        };
        b.network((n) => {
          n.config((c) => {
            c.jobType = JobType.smartSelfieAuthentication;
            c.token = session.token ?? '';
            c.partnerConfig((p) => {
              p.partnerId = session.partnerId ?? '';
              // The SDK's own default is the sandbox: the server says which.
              p.useSandbox = session.sandbox ?? false;
              p.partnerParams = { reference: session.reference };
            });
          });
        });
        b.ml((m) => {
          m.analyzers((a) => {
            a.forCaptureType(CaptureType.selfie, (face) => {
              if (faceAnalyzer) face.add(faceAnalyzer);
            });
          });
        });
        b.screens((s) => {
          s.instructions();
          s.capture((c) => {
            c.captureType = CaptureType.selfie;
          });
          s.processing();
        });
        b.onResult = (result) => {
          onEnd(result.status === 'success' ? 'sent' : result.status === 'cancelled' ? 'cancelled' : 'error');
        };
      }}
    />
  );
}
