import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export default function TermsOfService() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "SSAA Terms of Service";
    return () => {
      document.title = prevTitle;
    };
  }, []);

  function handleBack() {
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
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Button variant="ghost" size="sm" onClick={handleBack} className="mb-6 -ml-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          
          {t("common.back")}
        </Button>

        <article className="space-y-6 leading-relaxed">
          <h1 className="text-3xl font-bold tracking-tight">{t("termsOfService.ssaaTermsOfService")}</h1>

          <p>
            
            {t("termsOfService.welcomeToSsaaScheduleSomeoneAnytime")}
          </p>

          <h2 className="text-xl font-semibold pt-2">{t("termsOfService.smsProgramDisclosuresTerms")}</h2>

          <p>
            
            {t("termsOfService.byProvidingYourMobilePhoneNumber")}
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n1ProgramDescription")}</h2>
            <p>
              
              {t("termsOfService.ssaaWillSendAutomatedTextMessages")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n2MessageFrequency")}</h2>
            <p>{t("termsOfService.messageFrequencyMayVary")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n3PricingCharges")}</h2>
            <p>
              
              {t("termsOfService.messageAndDataRatesMayApply")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n4OptOutInformation")}</h2>
            <p>
              
              {t("termsOfService.youCanOptOutOfReceiving")}{" "}
              <strong>{t("termsOfService.stopUnsubscribeEndQuitOrHalt")}</strong>{t("termsOfService.uponSendingOneOfTheseKeywords")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n5CustomerCareContactInformation")}</h2>
            <p>
              
              {t("termsOfService.ifYouRequireAssistanceOrAre")}{" "}
              <strong>HELP</strong>, <strong>INFO</strong>{t("termsOfService.or")}{" "}<strong>SUPPORT</strong> {" "}{t("termsOfService.toAnyOfOurMessagesFor")}
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>{t("termsOfService.email")}</strong>{" "}
                <a href="mailto:luke.aaron@ssaainc.com" className="text-primary hover:underline">
                  luke.aaron@ssaainc.com
                </a>
              </li>
              <li>
                <strong>{t("termsOfService.phone")}</strong>{" "}
                <a href="tel:+13017935107" className="text-primary hover:underline">
                  301-793-5107
                </a>
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n6CarrierLiabilityDisclosure")}</h2>
            <p>{t("termsOfService.wirelessCarriersAreNotLiableFor")}</p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("termsOfService.n7PrivacyPolicy")}</h2>
            <p>
              
              {t("termsOfService.yourParticipationInThisSmsProgram")}
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
