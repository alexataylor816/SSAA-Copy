import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const TermsOfService = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'SSAA Terms of Service';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const handleBack = () => {
    // If opened in a new tab (no history), close; otherwise go back.
    if (window.history.length <= 1) {
      window.close();
      return;
    }
    // Try close first (works for tabs opened via window.open/target=_blank in some browsers),
    // then fall back to navigate back.
    try {
      window.close();
    } catch {
      // noop
    }
    navigate(-1);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
          className="mb-6 -ml-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>

        <article className="space-y-6 leading-relaxed">
          <h1 className="text-3xl font-bold tracking-tight">
            SSAA Terms of Service
          </h1>

          <p>
            Welcome to SSAA (Schedule Someone Anytime Anywhere). These Terms of
            Service govern your use of our platform and our automated SMS
            communications program.
          </p>

          <h2 className="text-xl font-semibold pt-2">
            SMS Program Disclosures &amp; Terms
          </h2>

          <p>
            By providing your mobile phone number and opting in through the SSAA
            Text Alert Consent form, you agree to receive recurring automated
            text messages from SSAA (Schedule Someone Anytime Anywhere).
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. Program Description</h2>
            <p>
              SSAA will send automated text messages regarding your account and
              operational activities. These messages specifically include
              schedule requests, confirmations, cancellations, schedule updates,
              and important account updates.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">2. Message Frequency</h2>
            <p>Message frequency may vary.</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">3. Pricing &amp; Charges</h2>
            <p>
              Message and data rates may apply. SSAA does not charge a separate
              fee for this text messaging service, but you are responsible for
              any charges and fees associated with text messaging imposed by
              your mobile phone service plan.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. Opt-Out Information</h2>
            <p>
              You can opt out of receiving automated text messages at any time.
              To cancel, reply with any of the following standard wireless
              keywords to a message you receive from us:{' '}
              <strong>STOP, UNSUBSCRIBE, END, QUIT, or HALT</strong>. Upon
              sending one of these keywords, you will receive a final
              confirmation message stating that you have been unsubscribed, and
              no further automated messages will be sent to your number.
              Consent to receive text messages is not required to use the SSAA
              app.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              5. Customer Care Contact Information
            </h2>
            <p>
              If you require assistance or are experiencing issues with the
              messaging program, reply <strong>HELP</strong>,{' '}
              <strong>INFO</strong>, or <strong>SUPPORT</strong> to any of our
              messages. For additional direct assistance, please contact our
              support team using the pathways below:
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>Email:</strong>{' '}
                <a
                  href="mailto:luke.aaron@ssaainc.com"
                  className="text-primary hover:underline"
                >
                  luke.aaron@ssaainc.com
                </a>
              </li>
              <li>
                <strong>Phone:</strong>{' '}
                <a
                  href="tel:+13017935107"
                  className="text-primary hover:underline"
                >
                  301-793-5107
                </a>
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              6. Carrier Liability Disclosure
            </h2>
            <p>
              Wireless carriers are not liable for delayed or undelivered
              messages.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">7. Privacy Policy</h2>
            <p>
              Your participation in this SMS program is also subject to our
              Privacy Policy. We do not share mobile information with third
              parties or affiliates for marketing or promotional purposes.
            </p>
          </section>
        </article>
      </div>
    </div>
  );
};

export default TermsOfService;
