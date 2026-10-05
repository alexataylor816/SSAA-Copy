import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LegalScreen, LegalSection } from '@/components/ui/legal-screen';
import { TextLink } from '@/components/ui/text-link';

export default function PrivacyPolicyScreen() {
  return (
    <LegalScreen title="SSAA Privacy Policy" subtitle="Last Updated: 7/11/2026">
      <ThemedText type="default" themeColor="brandForeground">
        At SSAA (Schedule Someone Anytime Anywhere), we are committed to protecting your privacy. This
        Privacy Policy outlines how we collect, use, and protect your information, with specific
        disclosures regarding our automated SMS messaging program.
      </ThemedText>

      <LegalSection heading="1. Information We Collect">
        <ThemedText type="default" themeColor="brandForeground">
          We collect information that you voluntarily provide to us when you register for an account or
          opt-in to our communications. This includes your mobile phone number when you consent to receive
          automated text messages through the SSAA Text Alert Consent form.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="2. How We Use Your Information">
        <ThemedText type="default" themeColor="brandForeground">
          We use your information, including your mobile phone number, specifically to operate our
          platform and deliver requested services. For our SMS program, this means using your number to
          send automated text messages regarding schedule requests, confirmations, cancellations,
          reminders, and important account updates. Your information will not be shared unless it is
          necessary for the platform to operate. Your information will not be sold, or used by us outside
          of this platform.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="3. Information Sharing & Third Parties">
        <ThemedText type="default" themeColor="brandForeground">
          We may share general data with necessary third-party service providers (such as cloud hosting or
          payment processors) strictly to operate the SSAA platform.
        </ThemedText>
        <ThemedText type="default" themeColor="brandForeground">
          However, all the above categories exclude text messaging originator opt-in data and consent;
          this information won’t be shared with any third parties.
        </ThemedText>
        <ThemedText type="default" themeColor="brandForeground">
          Furthermore, selling, renting, transferring, or sharing consumer opt-in consent or mobile phone
          numbers is strictly prohibited. We do not share your mobile information with any third parties or
          affiliates for marketing or promotional purposes.
        </ThemedText>
        <ThemedText type="default" themeColor="brandForeground">
          To be explicitly clear, no mobile information will be shared with third party/affiliates for
          marketing or promotional purposes.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="4. Security">
        <ThemedText type="default" themeColor="brandForeground">
          We implement standard security measures to protect the personal information and mobile numbers
          you provide to us from unauthorized access or disclosure.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="5. Contact Us">
        <ThemedText type="default" themeColor="brandForeground">
          If you have any questions or concerns about this Privacy Policy or how your data is handled,
          please contact us at:
        </ThemedText>
        <TextLink label="Email: luke.aaron@ssaainc.com" onPress={() => Linking.openURL('mailto:luke.aaron@ssaainc.com')} />
        <TextLink label="Phone: 301-793-5107" onPress={() => Linking.openURL('tel:+13017935107')} />
      </LegalSection>
    </LegalScreen>
  );
}
