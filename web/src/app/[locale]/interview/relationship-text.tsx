import type { PreviewRow } from "@/interview/preview";

/** A relationship as the server presented it: the translated segment and the Arabic original, each with its own language and direction. */
export function RelationshipText({ relationship }: { relationship: PreviewRow["relationship"] }) {
  const { translated, original } = relationship;
  return (
    <>
      <span lang={translated.lang} dir={translated.dir}>{translated.text}</span>
      {original.text !== translated.text && (
        <>
          {" "}
          <span lang={original.lang} dir={original.dir}>({original.text})</span>
        </>
      )}
    </>
  );
}
