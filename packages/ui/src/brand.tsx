/**
 * The brand mark: the company's own logo, shipped as an image.
 *
 * ## Why this is no longer an SVG shield
 *
 * It used to be inline SVG — a shield drawn from paths, sharp at any size and free of a request. That
 * was the right call while the product had no logo. It has one now (`public/logo.png`, the same
 * artwork as the Windows icon), and a drawn approximation of a real logo is worse than the logo:
 * two marks that almost match read as a mistake, and the one on the tab, the one in the app and the
 * one on a customer's PDF have to be the same thing.
 *
 * ## What the artwork is, measured rather than assumed
 *
 * Decoding `logo.png` (512×512 RGBA) gives: a white rounded plate covering 41.9% of the pixels, a red
 * mark at the centre (`rgb(241,37,41)`), a dark outline, and 4% transparency at the rounded corners.
 * So the mark carries its own white plate and reads on a **navy** bar without a second asset — the
 * plate becomes the tile, which is what an app icon looks like on a dark surface.
 *
 * ## Why `tone` still exists
 *
 * A raster cannot be recoloured, so `tone` no longer changes the artwork. It decides the *edge*: on a
 * white page the logo's own pale plate disappears into the background, so `ink` adds a hairline
 * border; on navy the plate is already the edge. Keeping the prop means the four call sites did not
 * have to change, and it is documented here so nobody expects it to tint the image.
 */

export interface BrandMarkProps {
  /** Pixel size of the square mark. Default 28. */
  size?: number;
  /** `brand` sits on the navy bar; `ink` sits on a white page and needs a hairline to read. */
  tone?: 'brand' | 'ink';
  /** Accessible name. Pass an empty string when the mark sits next to the wordmark. */
  title?: string;
}

/**
 * The logo file, at the path every app serves.
 *
 * Overridable through `NEXT_PUBLIC_LOGO_SRC` so a deployment can point at its own file — the same
 * variable the document renderer reads through `LOGO_FILE`, which is why a customer's PDF and the
 * app carry one image rather than two that drift. `NEXT_PUBLIC_` because Next inlines it at build
 * time and a value that changed per request could not reach a client component.
 */
const DEFAULT_LOGO_SRC = '/logo.png';

export function BrandMark({ size = 28, tone = 'ink', title = 'SmartQuote' }: BrandMarkProps) {
  const configured = process.env.NEXT_PUBLIC_LOGO_SRC;
  const src = configured !== undefined && configured.trim() !== '' ? configured : DEFAULT_LOGO_SRC;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- the size is a prop, not a layout, and this
    // component must render outside Next too (the site app and tests both use it).
    <img
      src={src}
      width={size}
      height={size}
      alt={title}
      aria-hidden={title === '' || undefined}
      className={tone === 'ink' ? 'rounded-sq-sm border border-sq-line object-contain' : 'rounded-sq-sm object-contain'}
    />
  );
}

/** The mark with the product name beside it. */
export function BrandLogo({
  size = 28,
  tone = 'ink',
  showWordmark = true,
}: {
  size?: number;
  tone?: 'brand' | 'ink';
  showWordmark?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <BrandMark size={size} tone={tone} title={showWordmark ? '' : 'SmartQuote'} />
      {showWordmark && (
        <span
          className="text-sq-body font-semibold tracking-tight"
          style={{ color: tone === 'brand' ? '#ffffff' : 'var(--color-sq-brand)' }}
        >
          SmartQuote
        </span>
      )}
    </span>
  );
}
