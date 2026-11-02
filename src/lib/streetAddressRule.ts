/**
 * ONE rule for when a poster's street address is shared (Q2614, Jobs audit 1102b row 28): Post a job's step 5 said
 * "your street address after you hire" in its header and "sent only to the Helpr you offer the job to" under
 * Location. The job page shows it to an offered Helpr before they accept, so the offer is the moment.
 * Guard: src/test/streetAddressOneRule.test.tsx.
 */
export const STREET_ADDRESS_RULE = "Your street address goes only to the Helpr you offer the job to.";
