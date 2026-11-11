import emblem from "../assets/brand/eyes-emblem.webp";
import emblemSmall from "../assets/brand/eyes-emblem-small.png";

export function BrandMark({
  size,
  decorative = false,
}: {
  size: "header" | "hero";
  decorative?: boolean;
}) {
  const hero = size === "hero";
  return (
    <img
      src={hero ? emblem : emblemSmall}
      alt={decorative ? "" : "Eyes Without a Face emblem"}
      width={hero ? 180 : 40}
      height={hero ? 180 : 40}
      className={hero ? "size-[180px] object-contain" : "size-10 object-contain"}
      decoding="async"
    />
  );
}
