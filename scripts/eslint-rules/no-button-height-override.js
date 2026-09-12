/**
 * no-button-height-override — a <Button> takes its height from `size`, never
 * from a hand-written `h-*` / `min-h-*` class.
 *
 * WHY THIS RULE EXISTS
 * Owner, 2026-09-12, on /complete-profile: "buttons should be the same size".
 * "Enter App" rendered 49.5px directly above a 60px "Sign Out". The primary
 * carried a hand-written `min-h-[60px]`, which index.css's unlayered
 * `button { min-height: 44px }` silently beat. Every hand-set height is a
 * private sizing decision that the shared scale (button.tsx `size`: sm 44,
 * default 56, lg 60, icon 56) cannot keep consistent, and some of them do not
 * even take effect. A reader sees the class and believes it.
 *
 * WHAT IT FLAGS
 * `h-<n>`, `h-[..]`, `min-h-<n>`, `min-h-[..]`, with any variant prefix or `!`,
 * inside a <Button className> string, template literal or cn()/clsx() string
 * argument. `h-auto` and `h-full` are allowed: they release or fill a height
 * rather than inventing one.
 *
 * FIX
 * Use `size="sm" | "default" | "lg" | "icon"`. If none fits, add a size to
 * button.tsx so every caller gets the same rung. Files that predate the rule
 * live on BUTTON_HEIGHT_LEGACY in eslint.config.js, which may only shrink
 * (src/test/buttonHeightLedger.test.ts).
 */
const TOKEN = /(^|\s)(?:[a-z0-9-]+:)*!?(?:min-)?h-(?:\d|\[)[^\s]*/;

function stringsIn(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string") out.push([node, node.value]);
      break;
    case "TemplateLiteral":
      node.quasis.forEach((q) => out.push([q, q.value.cooked ?? ""]));
      node.expressions.forEach((e) => stringsIn(e, out));
      break;
    case "JSXExpressionContainer":
      stringsIn(node.expression, out);
      break;
    case "CallExpression":
      node.arguments.forEach((a) => stringsIn(a, out));
      break;
    case "LogicalExpression":
    case "BinaryExpression":
      stringsIn(node.left, out);
      stringsIn(node.right, out);
      break;
    case "ConditionalExpression":
      stringsIn(node.consequent, out);
      stringsIn(node.alternate, out);
      break;
    case "ArrayExpression":
      node.elements.forEach((e) => stringsIn(e, out));
      break;
    default:
      break;
  }
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Button height comes from `size`, not a hand-written h-*/min-h-* class" },
    schema: [],
    messages: {
      override:
        "<Button> height '{{token}}' is hand-set. Use size=\"sm|default|lg|icon\" (or add a size to button.tsx) so sibling buttons match. See scripts/eslint-rules/no-button-height-override.js.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(el) {
        if (el.name.type !== "JSXIdentifier" || el.name.name !== "Button") return;
        const cls = el.attributes.find(
          (a) => a.type === "JSXAttribute" && a.name?.name === "className",
        );
        if (!cls?.value) return;
        const found = [];
        stringsIn(cls.value, found);
        for (const [node, text] of found) {
          const m = TOKEN.exec(text);
          if (m) context.report({ node, messageId: "override", data: { token: m[0].trim() } });
        }
      },
    };
  },
};
