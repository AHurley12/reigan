import {
  Globe,
  Search,
  FileText,
  Network,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react'

/**
 * Icon routing for the approval card.
 *
 * The card previously showed one `ShieldAlert` for everything, which made a web
 * search and a recursive delete look identical at a glance — the moment the
 * glance matters most. Resolution runs exact id first, then the dotted
 * namespace, then the original shield, so a new capability inherits a sensible
 * family icon without an entry here and nothing ever renders iconless.
 *
 * Same shape as DEVTOOLS_SECTIONS: add a row, done.
 */

/** Exact capability ids, where one member of a family deserves its own glyph. */
const BY_ID: Record<string, LucideIcon> = {
  'web.search': Search,
  'web.extract': FileText,
  'web.crawl': Network,
  'web.map': Network,
}

/** Dotted namespace — the `web` in `web.search`. */
const BY_NAMESPACE: Record<string, LucideIcon> = {
  web: Globe,
}

export const DEFAULT_APPROVAL_ICON: LucideIcon = ShieldAlert

export function approvalIcon(capabilityId: string): LucideIcon {
  const exact = BY_ID[capabilityId]
  if (exact) return exact

  const namespace = capabilityId.split('.')[0]
  return BY_NAMESPACE[namespace] ?? DEFAULT_APPROVAL_ICON
}
