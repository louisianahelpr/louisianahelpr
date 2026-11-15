/**
 * Types for ./stripeCheckoutForm.mjs (plain JS so the standalone `node` scripts can import it; see that file's header).
 */
import type { FrameLocator, Locator, Page } from "@playwright/test";

export declare const STRIPE_CARD_FIELD: string;
export declare const STRIPE_CARD_METHOD_BUTTON: string;
export declare const STRIPE_CARD_METHOD_ITEM: string;
export declare const STRIPE_SAVED_INFO_CHANGE: string;
export declare const STRIPE_EMBEDDED_FORM_FRAME: string;

/** Where Stripe's payment form lives: the page (layouts 1-4) or the embedded form frame (layout 5). */
export type StripeFormRoot = Pick<Page | FrameLocator, "locator" | "getByTestId" | "getByRole">;

/** A test card and the billing details Stripe may ask for. */
export interface StripeTestCard {
  number: string;
  expiry: string;
  cvc: string;
  name: string;
  line1: string;
  city: string;
  zip: string;
  /** Typed into the hosted page's receipt email when it is visible and editable. */
  email?: string;
}

export declare function stripeForm(page: Page): Promise<{ root: StripeFormRoot; embedded: boolean }>;
export declare function stripePaymentMethodControl(page: Page): Locator;
export declare function stripeLayoutReport(page: Page): Promise<string>;
export declare function waitForStripePaymentMethods(page: Page, timeout?: number): Promise<void>;
export declare function waitForStripeFormDrawn(page: Page, timeout?: number, every?: number): Promise<void>;
export declare function openCardFields(page: Page, attempts?: number): Promise<Locator>;
export declare function fillStripeCardFields(page: Page, card: StripeTestCard): Promise<void>;
export declare function clickStripeSubmit(page: Page): Promise<void>;
export declare function untickStripeLink(page: Page): Promise<void>;
export declare function pressStripePay(page: Page, presses?: number): Promise<void>;
