import { Linking } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { LegalScreen, LegalSection } from '@/components/ui/legal-screen';
import { TextLink } from '@/components/ui/text-link';

export default function TermsOfServiceScreen() {
  return (
    <LegalScreen title="SSAA Terms of Service">
      <ThemedText type="default" themeColor="brandForeground">
        Welcome to SSAA (Schedule Someone Anytime Anywhere). These Terms of Service govern your use of our
        platform and our automated SMS communications program.
      </ThemedText>

      <ThemedText type="smallBold" themeColor="brandForeground">
        SMS Program Disclosures & Terms
      </ThemedText>
      <ThemedText type="default" themeColor="brandForeground">
        By providing your mobile phone number and opting in through the SSAA Text Alert Consent form, you
        agree to receive recurring automated text messages from SSAA (Schedule Someone Anytime Anywhere).
      </ThemedText>

      <LegalSection heading="1. Program Description">
        <ThemedText type="default" themeColor="brandForeground">
          SSAA will send automated text messages regarding your account and operational activities. These
          messages specifically include schedule requests, confirmations, cancellations, schedule updates,
          and important account updates.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="2. Message Frequency">
        <ThemedText type="default" themeColor="brandForeground">
          Message frequency may vary.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="3. Pricing & Charges">
        <ThemedText type="default" themeColor="brandForeground">
          Message and data rates may apply. SSAA does not charge a separate fee for this text messaging
          service, but you are responsible for any charges and fees associated with text messaging imposed
          by your mobile phone service plan.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="4. Opt-Out Information">
        <ThemedText type="default" themeColor="brandForeground">
          You can opt out of receiving automated text messages at any time. To cancel, reply with any of
          the following standard wireless keywords to a message you receive from us: STOP, UNSUBSCRIBE,
          END, QUIT, or HALT. Upon sending one of these keywords, you will receive a final confirmation
          message stating that you have been unsubscribed, and no further automated messages will be sent
          to your number. Consent to receive text messages is not required to use the SSAA app.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="5. Customer Care Contact Information">
        <ThemedText type="default" themeColor="brandForeground">
          If you require assistance or are experiencing issues with the messaging program, reply HELP,
          INFO, or SUPPORT to any of our messages. For additional direct assistance, please contact our
          support team using the pathways below:
        </ThemedText>
        <TextLink label="Email: luke.aaron@ssaainc.com" onPress={() => Linking.openURL('mailto:luke.aaron@ssaainc.com')} />
        <TextLink label="Phone: 301-793-5107" onPress={() => Linking.openURL('tel:+13017935107')} />
      </LegalSection>

      <LegalSection heading="6. Carrier Liability Disclosure">
        <ThemedText type="default" themeColor="brandForeground">
          Wireless carriers are not liable for delayed or undelivered messages.
        </ThemedText>
      </LegalSection>

      <LegalSection heading="7. Privacy Policy">
        <ThemedText type="default" themeColor="brandForeground">
          Your participation in this SMS program is also subject to our Privacy Policy. We do not share
          mobile information with third parties or affiliates for marketing or promotional purposes.
        </ThemedText>
      </LegalSection>
    </LegalScreen>
  );
}
