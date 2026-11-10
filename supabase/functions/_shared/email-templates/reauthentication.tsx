/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Heading,
  Text,
} from 'npm:@react-email/components@0.0.22'

import {
  h1,
  text,
  codeStyle,
} from './styles.ts'
import { BaseLayout, TransactionalFooter } from './components.tsx'

interface ReauthenticationEmailProps {
  token: string
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <BaseLayout preheader="Your Louisiana Helpr confirmation code">
      {/* Owner's message review 11-09, F165: "Verify your identity" read like the photo-ID check; this is only a code. */}
      <Heading className="e-h1" style={h1}>Your confirmation code</Heading>
      <Text className="e-text" style={text}>Enter this code in the app to confirm it&apos;s you:</Text>
      <Text className="e-h1" style={codeStyle}>{token}</Text>
      <TransactionalFooter>
        It expires soon. If you didn&apos;t ask for it, you can ignore this email; nothing changes without the code.
        {/* F460 (audit 11-10): say who sent it. */}
        <br />- Louisiana Helpr
      </TransactionalFooter>
  </BaseLayout>
)

export default ReauthenticationEmail
