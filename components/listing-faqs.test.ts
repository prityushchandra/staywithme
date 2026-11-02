import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ListingFaqs } from "./listing-faqs";

describe("ListingFaqs", () => {
  it("does not display an empty section", () => {
    expect(renderToStaticMarkup(createElement(ListingFaqs, { faqs: [] }))).toBe("");
  });

  it("renders ordered, initially collapsed native disclosures", () => {
    const html = renderToStaticMarkup(createElement(ListingFaqs, {
      faqs: [
        { question: "First question?", answer: "First answer." },
        { question: "Second question?", answer: "Second answer." },
      ],
    }));
    expect(html.match(/<details\b/g)).toHaveLength(2);
    expect(html.match(/<summary\b/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html.indexOf("First question?")).toBeLessThan(html.indexOf("Second question?"));
    expect(html).toContain("First answer.");
    expect(html).toContain("Second answer.");
  });

  it("treats supplied FAQ content as text rather than executable markup", () => {
    const html = renderToStaticMarkup(createElement(ListingFaqs, {
      faqs: [{ question: "<img src=x onerror=alert(1)>", answer: "<script>alert(1)</script>" }],
    }));
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
  });
});
