// Minimal, logic-less renderer for contract_templates bodies (a strict subset of
// Handlebars): {{a.b}} inserts an HTML-escaped value, {{#if a.b}}…{{else}}…{{/if}}
// (not nested) toggles a block. No raw output exists, so customer-supplied text
// can never inject markup into a contract.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

const lookup = (data, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), data);

export function renderTemplate(body, data) {
  return body
    .replace(/\{\{#if ([\w.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, path, yes, no = "") =>
      lookup(data, path) ? yes : no,
    )
    .replace(/\{\{([\w.]+)\}\}/g, (_, path) => escapeHtml(lookup(data, path)));
}
