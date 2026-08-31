// Render a react-email component to the two parts every send needs.
//
// The plaintext body comes from react-email's OWN renderer
// (`{ plainText: true }`) — the same call auth-email-hook already made — rather
// than from a regex over the rendered HTML. That matters for more than tidiness:
// a regex stripper drops link HREFs, so the text/plain part of an email could
// end up with the words of a button and no URL behind them. Deriving both parts
// from one component also means they cannot drift.

import { renderAsync } from 'npm:@react-email/components@0.0.22'

export interface RenderedEmail {
  html: string
  text: string
}

/**
 * @param element a react-email element, e.g. `React.createElement(SignupEmail, props)`
 */
// deno-lint-ignore no-explicit-any
export async function renderEmail(element: any): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    renderAsync(element),
    renderAsync(element, { plainText: true }),
  ])
  return { html, text }
}
