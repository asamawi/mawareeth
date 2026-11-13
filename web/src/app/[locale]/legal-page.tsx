import type { LegalBlock, LegalPart } from "@/i18n/public-pages";

import { focusRing, sectionClass } from "./ui";

function Parts({ parts }: { parts: LegalPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <span key={index}>{index > 0 ? " " : ""}{part}</span>
        ) : (
          <span key={index}>
            {index > 0 ? " " : ""}
            <a href={part.href} rel="noopener noreferrer" className={`rounded underline underline-offset-4 ${focusRing}`}>{part.text}</a>
          </span>
        ),
      )}
    </>
  );
}

/** A long-form text page: the title is the single h1 and the source blocks keep their order. */
export function LegalPage({ title, blocks }: { title: string; blocks: LegalBlock[] }) {
  return (
    <main className={`${sectionClass} max-w-3xl`}>
      <h1 className="text-3xl font-semibold md:text-4xl">{title}</h1>
      <div className="mt-8 flex flex-col gap-4 leading-relaxed">
        {blocks.map((block, index) => {
          if (block.kind === "ul") {
            return (
              <ul key={index} className="list-disc space-y-2 ps-6">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex}><Parts parts={item} /></li>
                ))}
              </ul>
            );
          }
          if (block.kind === "p") return <p key={index}><Parts parts={block.parts} /></p>;
          const Heading = block.kind;
          return (
            <Heading key={index} className={`${block.kind === "h2" ? "mt-6 text-2xl" : "mt-4 text-xl"} font-semibold`}>
              <Parts parts={block.parts} />
            </Heading>
          );
        })}
      </div>
    </main>
  );
}
