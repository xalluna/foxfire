/** Pure, so the one header the desktop changes on Foxfire Media's player is tested. See embedHeaders.ts. */

/** frame-ancestors out of a CSP header's directives; everything else kept as sent. */
export function withoutFrameAncestors(policy: string): string {
  return policy
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive !== '' && !/^frame-ancestors(\s|$)/i.test(directive))
    .join('; ')
}
