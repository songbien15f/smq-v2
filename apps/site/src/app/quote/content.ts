/**
 * The vendor's words on the Guest page, in one place (spec ④: the reply time "is the vendor's
 * sentence, kept in content config, not hard-coded").
 *
 * Plain copy only — nothing here is a rule the API checks. Change a line here and rebuild the site;
 * moving it to an admin-edited setting is a later slice.
 */
export const GUEST_CONTENT = {
  /** Finishes "You get the quote by email — …". */
  replyTime: 'usually within 2 business days',
  nextSteps: [
    'We check your design and site.',
    'A local team prepares a formal quote, including the wind rating for your address.',
  ],
  consent: 'I agree to be contacted about this quote by phone and email.',
} as const;
