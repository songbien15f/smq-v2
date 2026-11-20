import Image from 'next/image'

import { hasUsableImage } from '@/lib/media'

type SafeImageProps = {
  src?: string | null
  alt: string
  width: number
  height: number
  className?: string
  priority?: boolean
  /**
   * Rendered width hints for `next/image`. Without this Next assumes the image
   * can fill the viewport (`100vw`) and always serves the largest candidate;
   * stating the real slot lets it pick a smaller file.
   */
  sizes?: string
}

/**
 * Renders the image when the source is usable, otherwise a neutral placeholder
 * with the same aspect ratio so a missing upload never collapses the layout.
 */
export function SafeImage({
  src,
  alt,
  width,
  height,
  className,
  priority,
  sizes,
}: SafeImageProps) {
  if (!hasUsableImage(src)) {
    return (
      <div
        data-image-fallback=""
        aria-hidden="true"
        className={className}
        style={{ aspectRatio: `${width} / ${height}` }}
      />
    )
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      sizes={sizes}
    />
  )
}
