// App Review 2.3.6 (April 2026): the age rating claimed In-App Controls.
// Apple asked for Parental Controls = None and Age Assurance = None. The app
// has neither (no parental-control feature, no age-verification flow), so both
// are answered false.
//
// Dry run unless the workflow's `apply` box is ticked (ASC_APPLY=1). Prints the
// declaration before and after. If App Store Connect does not accept these
// attribute names on this API version, the error names them and nothing else is
// changed; the owner then sets them in App Store Connect > App Information >
// Age Rating > Edit.
//
// Run: gh workflow run asc-iap.yml -f mode=release-age-rating [-f apply=true]

import { mintToken, asc } from "./asc-client.mjs";
import { APPLY, findApp, ageRatingDeclaration } from "./release-lib.mjs";

const WANT = { parentalControls: false, ageAssurance: false };

const token = mintToken();
const app = await findApp(token);
const decl = await ageRatingDeclaration(token, app.id);
if (!decl) {
  console.error("No age rating declaration found");
  process.exit(1);
}
const show = (d, label) => {
  console.log(label);
  for (const [k, v] of Object.entries(d.attributes ?? {})) console.log(`  ${k} = ${JSON.stringify(v)}`);
};
show(decl, `BEFORE (id=${decl.id})`);

const changes = Object.fromEntries(Object.entries(WANT).filter(([k, v]) => decl.attributes?.[k] !== v));
if (!Object.keys(changes).length) {
  console.log("\nAlready Parental Controls = None and Age Assurance = None. Nothing to do.");
  process.exit(0);
}
console.log(`\nCHANGE ${JSON.stringify(changes)}`);
if (!APPLY) {
  console.log("DRY RUN: tick apply to write");
  process.exit(0);
}
await asc(`/v1/ageRatingDeclarations/${decl.id}`, {
  method: "PATCH",
  token,
  body: { data: { type: "ageRatingDeclarations", id: decl.id, attributes: changes } },
});
const after = await ageRatingDeclaration(token, app.id);
show(after, "\nAFTER");
const still = Object.entries(WANT).filter(([k, v]) => after.attributes?.[k] !== v);
if (still.length) {
  console.error(`NOT APPLIED: ${still.map(([k]) => k).join(", ")}`);
  process.exit(1);
}
