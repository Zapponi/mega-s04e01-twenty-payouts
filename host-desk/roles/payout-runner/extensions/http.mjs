// http: one HTTP request, through the request layer (lib/net.mjs, plan.md § 0). {{NAME}} references from vars are
// filled in when the request is sent, so the model works with the reference only. The model's http sends GET only;
// writes to the course API go through the checked scripts. Every reply comes back masked.
import { send } from '../lib/net.mjs';

const MAX_BODY = 20_000;

export default function (pi) {
  pi.registerTool({
    name: 'http',
    label: 'http',
    description: 'Sends one GET request and returns the status, the final URL and the response body. {{NAME}} references from vars are filled in when it is sent. Writes (POST, PUT, PATCH, DELETE) are refused here: they go through the scripts in scripts/.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        method: { type: 'string', description: 'GET (default). Other methods are refused.' },
        url: { type: 'string' },
        headers: { type: 'object', additionalProperties: { type: 'string' } },
        body: { description: 'A string, or a JSON value (sent as JSON).' },
      },
    },
    async execute(_id, p, signal) {
      const r = await send({ method: p.method ?? 'GET', url: p.url, headers: p.headers, body: p.body, caller: 'model', signal });
      if (r.refused) {
        return { content: [{ type: 'text', text: `refused, not sent: ${r.refused}` }], details: { failed: true, refused: r.refused } };
      }
      if (r.error) {
        return { content: [{ type: 'text', text: `request failed: ${r.error}` }], details: { failed: true } };
      }
      const out = `${r.status} ${r.url}\n${r.body.length > MAX_BODY ? `${r.body.slice(0, MAX_BODY)}\n…(cut at ${MAX_BODY} of ${r.body.length} characters)` : r.body}`;
      return { content: [{ type: 'text', text: out }], details: { status: r.status, url: r.url } };
    },
  });
}
