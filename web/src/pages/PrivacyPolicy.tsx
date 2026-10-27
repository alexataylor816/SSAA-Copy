import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";

export default function PrivacyPolicy() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "SSAA Privacy Policy";
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
          <h1 className="text-3xl font-bold tracking-tight">{t("privacyPolicy.ssaaPrivacyPolicy")}</h1>

          <p className="text-sm text-muted-foreground">{t("privacyPolicy.lastUpdated7112026")}</p>

          <p>
            
            {t("privacyPolicy.atSsaaScheduleSomeoneAnytimeAnywhere")}
          </p>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("privacyPolicy.n1InformationWeCollect")}</h2>
            <p>
              
              {t("privacyPolicy.weCollectInformationThatYouVoluntarily")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("privacyPolicy.n2HowWeUseYourInformation")}</h2>
            <p>
              
              {t("privacyPolicy.weUseYourInformationIncludingYour")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("privacyPolicy.n3InformationSharingThirdParties")}</h2>
            <p>
              
              {t("privacyPolicy.weMayShareGeneralDataWith")}
            </p>
            <p>
              
              {t("privacyPolicy.howeverAllTheAboveCategoriesExclude")}
            </p>
            <p>
              
              {t("privacyPolicy.furthermoreSellingRentingTransferringOrS")}
            </p>
            <p>
              
              {t("privacyPolicy.toBeExplicitlyClearNoMobile")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("privacyPolicy.n4Security")}</h2>
            <p>
              
              {t("privacyPolicy.weImplementStandardSecurityMeasuresTo")}
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">{t("privacyPolicy.n5ContactUs")}</h2>
            <p>
              
              {t("privacyPolicy.ifYouHaveAnyQuestionsOr")}
            </p>
            <ul className="list-disc pl-6 space-y-1">
              <li>
                <strong>{t("privacyPolicy.email")}</strong>{" "}
                <a href="mailto:luke.aaron@ssaainc.com" className="text-primary hover:underline">
                  luke.aaron@ssaainc.com
                </a>
              </li>
              <li>
                <strong>{t("privacyPolicy.phone")}</strong>{" "}
                <a href="tel:+13017935107" className="text-primary hover:underline">
                  301-793-5107
                </a>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
