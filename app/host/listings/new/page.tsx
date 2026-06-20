import { getPlatformSettings } from "@/lib/settings";
import { getFormAmenities, getCancellationPolicies } from "@/lib/data-access";
import { ListingForm } from "@/components/listing-form";

export const metadata = { title: "Create a listing" };
export const dynamic = "force-dynamic";

export default async function NewListingPage() {
  const [amenities, policies, settings] = await Promise.all([
    getFormAmenities(),
    getCancellationPolicies(),
    getPlatformSettings(),
  ]);

  // Keep a stable policy order: Flexible, Moderate, Strict.
  const order = ["FLEXIBLE", "MODERATE", "STRICT"];
  const sortedPolicies = [...policies].sort(
    (a, b) => order.indexOf(a.policy) - order.indexOf(b.policy)
  );

  return (
    <div className="container max-w-3xl py-8">
      <h1 className="text-2xl font-bold tracking-tight">Create a listing</h1>
      <p className="mt-1 text-muted-foreground">
        Show off what makes your place special. Add a clear title, a few great
        photos, and the essentials below — the platform handles guest inquiries
        for you, so you never have to share personal contact details. Your
        listing goes live once it&apos;s approved.
      </p>
      <div className="mt-8">
        <ListingForm
          amenities={amenities.map((a) => ({ key: a.key, label: a.label }))}
          policies={sortedPolicies.map((p) => ({
            policy: p.policy,
            title: p.title,
            description: p.description,
          }))}
          suggestedMinPaise={settings.suggestedPriceMin}
          suggestedMaxPaise={settings.suggestedPriceMax}
        />
      </div>
    </div>
  );
}
