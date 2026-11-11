// The device text in the recipient's language (F260q, owner 11-11 "Spanish everything"). A member who picked Spanish
// (profiles.language = 'es', saved by the app's language switch) gets each known notice shape re-written in Spanish by
// the same list the app uses (_shared/noticeEs.ts). Anything else, or a text no shape matches, stays as written.
// Guard: src/test/pushInRecipientLanguage.test.ts.
import { noticeInSpanish } from '../_shared/noticeEs.ts'

export function pushTextInLanguage(
  language: string | null | undefined,
  title: string,
  body: string,
): { title: string; body: string } {
  if (language !== 'es') return { title, body }
  return { title: noticeInSpanish(title), body: noticeInSpanish(body) }
}
