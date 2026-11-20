/**
 * Guest requests as `/admin/guest-requests` answers them (`apps/api/src/routes/guestRequestsAdmin.ts`),
 * and the words the screens use for their stored codes. The labels match the notification mail
 * (`apps/api/src/lib/mail/guestMail.ts`), so the screen and the inbox describe a request the same way.
 */

import type { StatusTone } from '@sq/ui';

export type GuestRequestStatus = 'new' | 'transferred' | 'declined' | 'spam';

export interface GuestRequestRow {
  id: string;
  number: string;
  status: GuestRequestStatus;
  name: string;
  email: string;
  mobile: string;
  typeId: string;
  typeName: string;
  suburb: string;
  state: string;
  postcode: string;
  spanMm: number;
  lengthMm: number;
  heightMm: number;
  reviewFlags: string[];
  createdAt: string;
}

export interface GuestRequestList {
  items: GuestRequestRow[];
  counts: Record<GuestRequestStatus, number>;
}

export interface GuestOpening {
  type: string;
  wall: string;
  size: { width: number; height: number };
  motorised?: boolean;
}

/** The stored design. Read defensively: an old row may lack a field a newer page sends. */
export interface GuestDesign {
  typeId?: string;
  site?: { street?: string; suburb?: string; state?: string; postcode?: string; placeId?: string };
  building?: {
    span?: number;
    height?: number;
    pitchDeg?: number;
    roof?: string;
    bayWidths?: number[];
    slab?: string;
    kneeBrace?: string;
    cladding?: string;
  };
  openings?: GuestOpening[];
  colours?: { walls?: string; roof?: string; trim?: { barge?: string; gutter?: string; downpipe?: string } };
}

export interface GuestRequestDetail extends GuestRequestRow {
  contact: Record<string, unknown>;
  design: GuestDesign | null;
  notes: string | null;
  source: Record<string, unknown> | null;
  estimate: {
    buildingClass?: string;
    enclosure?: string;
    importanceLevel?: number;
    region?: string | null;
    windSpeedMs?: number;
  } | null;
  transcript: { role: 'guest' | 'assistant'; text: string }[];
  declineReason: string | null;
  transferredTenantId: string | null;
  transferredAt: string | null;
  updatedAt: string;
}

export const STATUS_LABEL: Record<GuestRequestStatus, string> = {
  new: 'New',
  transferred: 'Transferred',
  declined: 'Declined',
  spam: 'Spam',
};

export const STATUS_TONE: Record<GuestRequestStatus, StatusTone> = {
  new: 'attention',
  transferred: 'ok',
  declined: 'neutral',
  spam: 'danger',
};

export const OPENING_LABEL: Record<string, string> = {
  roller_door: 'Roller door',
  pa_door: 'Personal access door',
  sliding_door: 'Sliding door',
  window: 'Window',
};

export const ROOF_LABEL: Record<string, string> = { gable: 'Gable', skillion: 'Skillion' };

export const SLAB_LABEL: Record<string, string> = {
  in_slab: 'In Slab',
  on_slab: 'On Slab',
  footing_only: 'Footing Only',
};

export const KNEE_LABEL: Record<string, string> = {
  standard: 'Knee Brace',
  none_if_possible: 'No Knee Brace – If Possible',
};

export const CLADDING_LABEL: Record<string, string> = { vertical: 'Vertical', horizontal: 'Horizontal' };

export const FLAG_LABEL: Record<string, string> = {
  pitch: 'Roof pitch below the book',
  bay: 'Bay wider than the book',
  span: 'Span above the book',
};

/** `9000` → `9 m`, `2950` → `2.95 m`. */
export function metres(mm: number): string {
  return `${Number((mm / 1000).toFixed(3))} m`;
}

export function sizeText(row: Pick<GuestRequestRow, 'spanMm' | 'lengthMm' | 'heightMm'>): string {
  if (row.spanMm === 0) return '—';
  return `${metres(row.spanMm)} × ${metres(row.lengthMm)} × ${metres(row.heightMm)}`;
}
