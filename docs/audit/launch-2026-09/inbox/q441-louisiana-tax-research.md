# Q441: Louisiana sales tax on Helpr jobs, fees, gift cards and boosts (research, 2026-09-27)

Ledger: Q441, audit-bus ME-019 and ME-043. This is research only. No code or Stripe settings were changed.

The owner has no CPA. Everything below comes from primary sources: the Louisiana Revised Statutes on legis.la.gov, Louisiana Department of Revenue (LDR) FAQs, the Louisiana Sales and Use Tax Commission for Remote Sellers, and Stripe's docs. Each claim carries its URL and a verbatim quote. **This is not tax advice.** The last section lists the points that need an LDR ruling or a tax professional.

Confidence labels:
- **CONFIDENT**: the statute or LDR text says it directly.
- **UNCERTAIN**: it is an inference, or the sources are silent.

## Background: the law changed on Dec 4, 2024

The 2024 Third Extraordinary Session rewrote the list of taxable services.
- Act 11 (HB 10) enacted R.S. 47:301.3 "Services" and repealed 47:301(4)(m) and (n).
  - Source note on 47:301.3 (https://legis.la.gov/legis/Law.aspx?d=1392324): "Acts 2024, 3rd Ex. Sess., No. 11, §2, eff. Dec. 4, 2024; Acts 2025, No. 384, §3, eff. June 20, 2025."
- Act 10 taxes digital products from Jan 1, 2025.
  - LDR FAQ (https://revenue.louisiana.gov/tax-education-and-faqs/faqs/sales-tax-reform/are-digital-products-subject-to-sales-and-use-tax/): "Act 10 of the 2024 Third Extraordinary session expands the sales tax base to include the taxation of digital products for taxable periods beginning on or after January 1, 2025."

Services are taxable only if they are on the enumerated list.
- 47:301.3 opens: "The sales and use tax levied by any taxing authority shall apply to the following services:"
- LDR FAQ (https://www.revenue.la.gov/tax-education-and-faqs/faqs/sales-tax-reform/how-many-services-are-subject-to-sales-tax-in-louisiana): "There are 10 categories of services subject to Louisiana state sales tax."
- LDR FAQ (https://revenue.louisiana.gov/tax-education-and-faqs/faqs/sales-tax-reform/what-services-are-subject-to-sales-tax-in-louisiana/): the listed services are "subject to state (and local, unless otherwise noted) sales tax".

Citation correction: the marketplace facilitator definitions are in **R.S. 47:340.1(A)(6)-(8)**. They are not in 47:301(4)(m) or (n), which Act 11 repealed. 47:301 (https://legis.la.gov/legis/Law.aspx?d=101815) reads: "(m, n) Repealed by Acts 2024, 3rd Ex. Sess., No. 11, §4, eff. Dec. 4, 2024."

## 1. Are the job categories taxable services?

The deciding line is **movable property (taxable when repaired, maintained or cleaned) versus immovable property, meaning the house and land (not taxable)**.

Sources:
- LDR FAQ (https://revenue.louisiana.gov/tax-education-and-faqs/faqs/sales-tax-reform/are-repairs-and-maintenance-to-my-home-taxable/): "Repairs and maintenance to immovable property, such as a residence, are not taxable." It also says "repairs and maintenance of tangible personal property within a home (movable property) are subject to sales tax" (refrigerators, washing machines, dryers, furniture).
- LDR FAQ (https://revenue.louisiana.gov/tax-education-and-faqs/faqs/sales-tax/do-i-have-to-collect-sales-tax-on-charges-for-labor/): "Labor to fabricate, repair, or maintain tangible personal property is generally subject to sales tax." It also says "Labor to construct, install, remodel, or repair immovable (real) property is generally not subject to Louisiana sales tax."
- 47:301.3(5): "Laundry, cleaning, pressing, alterations, repair, and dyeing services, including but not limited to the cleaning and renovation of clothing, furs, linens, furniture, carpets, and rugs..."
- 47:301.3(7)(a): "Repairs and maintenance of tangible personal property. Repairs and maintenance include but are not limited to the repair and servicing of automobiles, ... furniture, rugs, ... This includes service calls and trip or travel charges."

| Category | Answer | Confidence | Basis |
|---|---|---|---|
| House cleaning (the home itself: floors, bathrooms, kitchens) | Not taxable | **UNCERTAIN, leaning not taxable** | The home is immovable property, and "cleaning of a residence" is not an enumerated service. No LDR text names residential cleaning directly. |
| Cleaning of furniture, carpets, rugs, linens (movable items) | **Taxable** | **CONFIDENT** | 47:301.3(5) quoted above. A "house cleaning" job that includes carpet or upholstery cleaning may be partly taxable. |
| Repair of movable items (appliances, furniture, bikes) | **Taxable** | **CONFIDENT** | 47:301.3(7)(a) and the LDR repairs FAQ, quoted above. |
| Repair or maintenance of the house (drywall, fixtures) | Not taxable | **CONFIDENT** | LDR repairs FAQ: "Repairs and maintenance to immovable property, such as a residence, are not taxable." |
| Furniture or item assembly | Unclear | **UNCERTAIN** | "Assembly" is not an enumerated service. It is labor on tangible personal property, but it is neither repair nor maintenance. If the Helpr also sells the item, 47:301(13)(a) matters: "Sales price shall not include the amount charged for labor or services rendered in installing, applying, remodeling, or repairing property sold if that charge is separately billed to the customer at the time of the sale." Needs a ruling. |
| Moving help and hauling | Likely not taxable | **UNCERTAIN, leaning not taxable** | Not on the 47:301.3 list, and no quote found that taxes it. |
| Yard work and lawn care | Likely not taxable | **UNCERTAIN, leaning not taxable** | Land is immovable property (LDR labor FAQ above), and landscaping is not on the list. |
| Event setup | Likely not taxable | **UNCERTAIN** | Not on the list. Paragraphs (1) and (2) of 47:301.3 (accommodations and admissions) do not reach a Helpr who sets up a private event. |
| Delivery (errands) | Likely not taxable as a standalone service | **UNCERTAIN** | Not on the list. Delivery charged by the seller of the goods is a separate question that the platform does not have. |

### Is the platform's service fee taxable?

**Answer:** Likely not taxable when the underlying job is nontaxable. Possibly taxable when it is attached to a taxable job. **UNCERTAIN.**

- 47:301.3 includes "service, facilitator, processing, delivery, and other similar fees ... even if such fee or charge is separately stated" in the price. That language appears only in paragraph (1) (accommodations) and paragraph (2) (admissions). It does not appear in (5) or (7).
- No provision found makes a marketplace's own fee a separately enumerated taxable service.
- For a taxable repair or cleaning job, the fee could be treated as part of the "sales price" of that taxable service.
- **Needs a professional.**

## 2. Is the platform a marketplace facilitator that must collect?

**Is Louisiana Helpr a marketplace facilitator? Yes, by definition. CONFIDENT on the definition.**

- R.S. 47:340.1 (https://legis.la.gov/legis/Law.aspx?d=1186690), (A)(6): "'Marketplace' means any physical or electronic platform or forum ... through which a marketplace seller may sell or offer for sale tangible personal property, digital products, or sales of services for delivery into Louisiana."
- (A)(7)(a): "'Marketplace facilitator' means any person ... that facilitates a sale for a marketplace seller through a marketplace ... by any of the following: (i) Offering for sale through any means, by a marketplace seller, tangible personal property or sales of services for delivery into Louisiana. (ii) Collecting payment from the purchaser and transmitting all or part of the payment to the marketplace seller, regardless of whether the person receives compensation..."
  - Helpr collects the poster's payment (Stripe Connect escrow) and transmits it to the Helpr. That fits (ii).
- (A)(7)(b)(i) excludes only "A payment processor that only handles the processing of payments between the marketplace facilitator and the purchaser." That exclusion covers Stripe, not Helpr.

**Duty to collect: CONFIDENT on the rule, UNCERTAIN on how the threshold applies.**

- (B): "A marketplace facilitator shall be considered the dealer for each remote sale for delivery into Louisiana..."
- (C)(1): "shall collect and remit state and local sales and use tax on all taxable remote sales"
- (C)(2) sets the threshold: "gross revenue for retail sales delivered into Louisiana exceeded one hundred thousand dollars"
- (C)(3): "only remote sales that are retail sales ... shall be considered. However, a marketplace facilitator may voluntarily register"
- (E)(1): "the marketplace facilitator shall be responsible for the determination of taxability of remote sales"
- Being based in Louisiana does not exempt the platform. RSIB 23-001 (Sept 8, 2023), https://remotesellers.louisiana.gov/Documents/RSIB%2023-001%20Marketplace%20Facilitators%20and%20Louisiana%20Merchants.pdf:
  - "All marketplace facilitators are required to collect and remit sales taxes to the Commission on behalf of all of their marketplace sellers, including those marketplace sellers located in Louisiana."
  - "A marketplace facilitator is not required to operate or have a presence outside of Louisiana. Sales occurring on a marketplace that are facilitated by a marketplace facilitator are remote sales, requiring sales tax to be remitted to the Commission."
  - Caveat from the RSIB itself: it "does not have the force and effect of law and is not binding".

**In practice:**
- Once past the threshold, Helpr would register with the Remote Sellers Commission.
- It would collect state and local tax on the taxable jobs only: movable-item repair and cleaning of furniture, carpets and rugs.
- Nontaxable jobs carry no tax.
- **Open question:** does the $100k of "retail sales" count GMV from nontaxable services? This is unclear. See the open questions below.

## 3. Stripe Tax product tax codes

Source: https://docs.stripe.com/tax/tax-codes (all 677 codes parsed on 2026-09-27). Stripe's descriptions are quoted.

| Item | Suggested code | Confidence | Stripe description / note |
|---|---|---|---|
| House cleaning (the home) | `txcd_20010006` Residential Cleaning Services | CONFIDENT that it fits; LA taxability UNCERTAIN | "A charge for custodial services to residential structures, including the cleaning of floors, carpets, walls, windows, appliances, furniture, fixtures, exterior..." Stripe tax type: ServicesImmovableProperty. |
| Carpet, rug or upholstery cleaning | `txcd_20010003` Cleaning of Tangible Personal Property | CONFIDENT | "A charge for the cleaning of tangible personal property, other than motor vehicles or clothing." |
| Repair of movable items | `txcd_20080005` Repair of Tangible Personal Property (`txcd_20080009` Appliance Repair) | CONFIDENT | "A charge to repair or restore tangible personal property that was broken, worn, damaged, defective, or malfunctioning." |
| Home repairs | `txcd_20080007` Repairs to Real Property | CONFIDENT | "A charge to repair or maintain real property including repairs to HVAC, electrical, flooring, and so on." |
| Yard work | `txcd_20070008` Lawn Maintenance Services (or `txcd_20070007` Landscaping) | CONFIDENT | "general lawn and grounds maintenance, including lawn cutting, weeding, yard clean-up, shrub and tree trimming..." |
| Assembly | `txcd_20020018` Installation of Tangible Personal Property, or `txcd_20030000` | UNCERTAIN | Stripe's "Assembly" codes (`txcd_20090022`/`23`) are defined as tied to the purchase of the article, which does not fit a Helpr who does not sell the item. |
| Moving, event setup, delivery, other labor | `txcd_20030000` General - Services | UNCERTAIN (no specific code exists) | "General category for services. Only use this if you don't have a more specific category." |
| Platform service fee | `txcd_20030000` General - Services, or the same code as the job | UNCERTAIN | Stripe has no "marketplace facilitator fee" code. See Q1 on the fee. |
| Gift card | `txcd_10502000` Gift Card | CONFIDENT | "Gift card or gift certificate that you purchase and receive electronically and assumed to be multi-purpose." |
| Job boost | `txcd_10701000` Website Advertising | UNCERTAIN | "Online advertising services such as creating and uploading advertisements on the internet. This is a standalone service..." Alternative: `txcd_20060002` Advertising Services. Whether a boost is a taxable LA "digital product" (an in-app add-on) is open; see Q4 and the open questions below. |
| Explicit nontaxable override | `txcd_00000000` Nontaxable | n/a | "Any nontaxable good or service which can be used to ensure no tax is applied, even for jurisdictions that impose a tax." Use it only after a professional confirms. |

How to use these codes:
- The job categories are chosen at run time, so the product tax code would be set per Checkout/PaymentIntent line from the job category.
- Nothing in Stripe was changed in this task.

## 4. Gift cards: taxed at sale or at redemption?

**Answer:** Not taxed when the card is sold. What is bought at redemption is taxed only if that item is taxable. **CONFIDENT on the first part, UNCERTAIN on the second** (no LDR text on redemption timing was found).

- 47:301(31)(b)(v) (https://legis.la.gov/legis/Law.aspx?d=101815): "'Digital code' does not include any gift certificate or gift card with monetary value that may be redeemable for an item other than a digital product."
  - A Helpr gift card is redeemable for services, so its sale is not the sale of a taxable digital code.
  - The digital-code rule (31)(d), "The sale of a digital code that may be utilized to obtain a digital product shall be taxed in the same manner as the digital product," therefore does not apply.
- A gift card is a stored-value payment method, not a service on the 47:301.3 list. So nothing taxable is sold when the card is bought.
- When the card is redeemed on a job, the job's own taxability controls (Q1).
- No LDR FAQ or statute stating "tax at redemption" in those words was found. Only secondary sources say it. That wording should be confirmed.

## Open questions for an LDR ruling or a tax professional

These are tracked in [docs/OPEN.md](../../../OPEN.md) as Q374 (the CPA's answers before launch) and Q441 (the Stripe Tax half). That is the one open-work list, and this section is the research behind it.

1. **Residential cleaning.** Is cleaning a home's interior (immovable property) outside 47:301.3(5)? And where is the line when a job includes carpet or upholstery cleaning, which (5) names?
2. **Assembly.** Is assembling a customer's own furniture or equipment "repairs and maintenance of tangible personal property" under 47:301.3(7)? Or is it untaxed labor?
3. **Platform service fee.** When the underlying job is taxable, is the platform's separately stated fee part of the taxable sales price? Why it is unclear: the facilitator-fee language appears only for accommodations and admissions (47:301.3(1),(2)).
4. **$100k threshold.** Does "gross revenue for retail sales" in 47:340.1(C)(2) count GMV from nontaxable service jobs, or only taxable ones? And does an in-state marketplace owe collection from the first dollar under RSIB 23-001, whatever the threshold?
5. **Job boosts.** Is a boost a taxable "digital product" under 47:301(31)? Specifically, is it an "add-on or additional content" to a digital application, per (31)(b)(i): "'Digital applications and games' means any application or game, including add-ons or additional content, that can be used by a computer, mobile device, or tablet". Or is it a nontaxable advertising service?
6. **Local parish tax.** Local rates are collected through the Remote Sellers Commission for remote sales. Do any parishes tax services beyond the state list for sales that are not remote? LDR says "state (and local, unless otherwise noted)", but that was not verified parish by parish.
7. **Gift card redemption.** Confirm in writing that there is no tax at sale and that the item bought at redemption is taxed.

Scope note: only the sources quoted above were read. No parish ordinance, LAC regulation or private letter ruling was reviewed.
