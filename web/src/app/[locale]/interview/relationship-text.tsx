import type { PreviewRow } from "@/interview/preview";

/** A relationship as the server presented it: the translated segment and the Arabic original, each with its own language and direction. */
export function RelationshipText({ relationship }: { relationship: PreviewRow["relationship"] }) {
  const { translated, original } = relationship;
  return (
    <>
      <bdi lang={translated.lang} dir={translated.dir}>{translated.text}</bdi>
      {original.text !== translated.text && (
        <>
          {" "}
          <bdi lang={original.lang} dir={original.dir}>({original.text})</bdi>
        </>
      )}
    </>
  );
}
