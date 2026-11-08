/**
 * Product mark: a person walking forward in a blue flame. public/logo.svg,
 * the same artwork as the favicon (app/icon.svg); keep the two files equal.
 * Deliberately not the AIESEC logo, which is a registered trademark.
 * Decorative: the app's name is always shown next to it.
 */
export default function BrandLogo({ size = 32 }: { size?: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo.svg" alt="" width={size} height={Math.round(size * 280 / 240)} style={{ display: "block" }} />;
}
