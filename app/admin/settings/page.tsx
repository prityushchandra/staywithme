import { getPlatformSettings } from "@/lib/settings";
import { getCancellationPolicies } from "@/lib/data-access";
import { SettingsForm } from "@/components/admin/settings-form";
import { CancellationPoliciesForm } from "@/components/admin/cancellation-policies-form";

export const metadata = { title: "Admin · Settings" };
export const dynamic = "force-dynamic";

const POLICY_ORDER: Record<string, number> = { FLEXIBLE: 0, MODERATE: 1, STRICT: 2 };

export default async function AdminSettingsPage() {
  const settings = await getPlatformSettings();
  const policies = await getCancellationPolicies();
  const sortedPolicies = [...policies].sort(
    (a, b) => (POLICY_ORDER[a.policy] ?? 9) - (POLICY_ORDER[b.policy] ?? 9)
  );

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Platform settings</h1>
          <p className="text-muted-foreground">
            These apply across the whole platform and update everywhere immediately.
          </p>
        </div>
        <SettingsForm
          initial={{
            whatsappNumber: settings.whatsappNumber,
            platformFeePercent: settings.platformFeePercent,
            suggestedPriceMinRupees: Math.round(settings.suggestedPriceMin / 100),
            suggestedPriceMaxRupees: Math.round(settings.suggestedPriceMax / 100),
            rankWeightView: settings.rankWeightView,
            rankWeightSave: settings.rankWeightSave,
            rankWeightClick: settings.rankWeightClick,
            reviewsOpenToAll: settings.reviewsOpenToAll,
          }}
        />
      </section>

      <section className="space-y-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Cancellation policies</h2>
          <p className="text-muted-foreground">
            Edit the title and description guests see for each policy. The refund
            rules themselves are fixed; only the wording changes here.
          </p>
        </div>
        <CancellationPoliciesForm
          initial={sortedPolicies.map((p) => ({
            policy: p.policy,
            title: p.title,
            description: p.description,
          }))}
        />
      </section>
    </div>
  );
}
