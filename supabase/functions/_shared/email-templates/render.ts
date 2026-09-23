// Render a react-email component to the two parts every send needs.
//
// The plaintext body comes from react-email's OWN conversion (html-to-text with
// react-email's `plainTextSelectors`) rather than from a regex over the
// rendered HTML. That matters for more than tidiness: a regex stripper drops
// link HREFs, so the text/plain part of an email could end up with the words of
// a button and no URL behind them. Deriving both parts from one render also
// means they cannot drift.
//
// ONE render, not two (Q258). `renderAsync(el, { plainText: true })` in
// @react-email/render 0.0.17 is exactly "render the component to markup, then
// `convert(markup, { selectors: plainTextSelectors })`" — so calling it next to
// `renderAsync(el)` rendered the React tree twice per email. Here the tree is
// rendered once and the text part is converted from that same markup
// (html-to-text ignores the DOCTYPE renderAsync prepends). The versions below
// are the ones @react-email/components@0.0.22 resolves; keep them in step.

import { renderAsync } from 'npm:@react-email/components@0.0.22'
import { plainTextSelectors } from 'npm:@react-email/render@0.0.17'
import { convert } from 'npm:html-to-text@9.0.5'

export interface RenderedEmail {
  html: string
  text: string
}

/**
 * @param element a react-email element, e.g. `React.createElement(SignupEmail, props)`
 */
// deno-lint-ignore no-explicit-any
export async function renderEmail(element: any): Promise<RenderedEmail> {
  const html = await renderAsync(element)
  const text = convert(html, { selectors: plainTextSelectors })
  return { html, text }
}
