import { Plus } from "lucide-react";
import type { ListingFaq } from "@/lib/validation";

export function ListingFaqs({ faqs }: { faqs: ListingFaq[] }) {
  if (faqs.length === 0) return null;

  return (
    <section id="faqs" aria-labelledby="faqs-heading" className="scroll-mt-28 border-t border-foreground/10 py-9 sm:py-11">
      <h2 id="faqs-heading" className="font-serif text-2xl tracking-tight sm:text-3xl">
        Frequently asked questions
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        A few things to know before you make yourself at home.
      </p>
      <div className="mt-5 divide-y divide-foreground/10">
        {faqs.map((faq, index) => (
          <details key={index} className="group">
            <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-5 rounded-lg py-5 text-sm font-medium leading-relaxed outline-none transition-colors hover:text-brand-dark focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 sm:text-base [&::-webkit-details-marker]:hidden">
              <span className="min-w-0 break-words">{faq.question}</span>
              <Plus aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45" />
            </summary>
            <p className="max-w-2xl whitespace-pre-line break-words pb-6 pr-8 text-sm leading-7 text-muted-foreground">
              {faq.answer}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
