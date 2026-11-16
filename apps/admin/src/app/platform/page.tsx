import { permanentRedirect } from 'next/navigation';

/**
 * `/platform` was usage, releases and the template catalogue on one page under the nav label "Usage".
 * They are now `/usage`, `/releases` and `/templates`; a bookmark to the old address lands on the
 * first of them.
 */
export default function PlatformRoute() {
  permanentRedirect('/usage');
}
