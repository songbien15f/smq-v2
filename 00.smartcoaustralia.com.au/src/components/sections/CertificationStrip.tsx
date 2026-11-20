import type { HomePage } from '@/payload-types'

type CertificationStripProps = {
  label?: string | null
  certifications?: HomePage['certifications']
}

export function CertificationStrip({ label, certifications }: CertificationStripProps) {
  if (!certifications?.length) return null

  return (
    <div className="compliance" aria-label="Certifications and standards">
      <div className="wrap">
        {label ? <span className="c-label">{label}</span> : null}
        {certifications.map((item, index) => (
          <span className="badge" key={`${item.label}-${index}`} data-testid="certification">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m4 12.5 5 5L20 6.5"
                stroke="#e83238"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}
