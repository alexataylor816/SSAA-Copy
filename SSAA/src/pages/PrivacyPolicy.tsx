import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'SSAA Privacy Policy';
    return () => {
      document.title = prevTitle;
    };
  }, []);

  const handleBack = () => {
    if (window.history.length <= 1) {
      window.close();
      return;
    }
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
            SSAA Privacy Policy
          </h1>

          <p className="text-sm text-muted-foreground">
            Last Updated: 7/11/2026
          </p>

          <p>
            At SSAA (Schedule Someone Anytime Anywhere), we are committed to
            protecting your privacy. This Privacy Policy outlines how we
            collect, use, and protect your information, with specific
            disclosures regarding our automated SMS messaging program.
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">1. Information We Collect</h2>
            <p>
              We collect information that you voluntarily provide to us when
              you register for an account or opt-in to our communications. This
              includes your mobile phone number when you consent to receive
              automated text messages through the SSAA Text Alert Consent form.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              2. How We Use Your Information
            </h2>
            <p>
              We use your information, including your mobile phone number,
              specifically to operate our platform and deliver requested
              services. For our SMS program, this means using your number to
              send automated text messages regarding schedule requests,
              confirmations, cancellations, reminders, and important account
              updates. Your information will not be shared unless it is
              necessary for the platform to operate. Your information will not
              be sold, or used by us outside of this platform.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">
              3. Information Sharing &amp; Third Parties
            </h2>
            <p>
              We may share general data with necessary third-party service
              providers (such as cloud hosting or payment processors) strictly
              to operate the SSAA platform.
            </p>
            <p>
              However, All the above categories exclude text messaging
              originator opt-in data and consent; this information won't be
              shared with any third parties.
            </p>
            <p>
              Furthermore, selling, renting, transferring, or sharing consumer
              opt-in consent or mobile phone numbers is strictly prohibited. We
              do not share your mobile information with any third parties or
              affiliates for marketing or promotional purposes.
            </p>
            <p>
              To be explicitly clear, No mobile information will be shared with
              third party/affiliates for marketing or promotional purposes.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">4. Security</h2>
            <p>
              We implement standard security measures to protect the personal
              information and mobile numbers you provide to us from
              unauthorized access or disclosure.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">5. Contact Us</h2>
            <p>
              If you have any questions or concerns about this Privacy Policy
              or how your data is handled, please contact us at:
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
        </article>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
