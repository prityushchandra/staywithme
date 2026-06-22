import { prisma } from "@/lib/db";
import { getFormAmenities } from "@/lib/data-access";
import { CatalogManager } from "@/components/admin/catalog-manager";

export const metadata = { title: "Catalog" };
export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const [amenities, blocks] = await Promise.all([
    getFormAmenities(),
    prisma.block.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Catalog</h1>
        <p className="text-muted-foreground">
          Custom amenities and society blocks that hosts can pick from when
          listing a property.
        </p>
      </div>
      <CatalogManager
        amenities={amenities.map((a) => ({ id: a.id, label: a.label, icon: a.icon }))}
        blocks={blocks.map((b) => ({ id: b.id, name: b.name }))}
      />
    </div>
  );
}
