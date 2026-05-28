// Web search wrapper. In stub mode (no codebuddy), returns synthesised mock
// results so the rest of the pipeline still exercises the sources path.
import { callWebSearch } from '../codebuddyClient.js';
import { config } from '../config.js';

export function stubSearchResults(queries) {
  return queries.flatMap((q, qi) => Array.from({ length: 3 }, (_, i) => ({
    title: `[stub] ${q} — result ${i + 1}`,
    url: `https://example.invalid/stub/${qi}/${i}`,
    snippet: `Placeholder snippet for "${q}". Real WebSearch results require ENABLE_CODEBUDDY=1.`,
    source: 'example.invalid',
  })));
}

export async function searchWeb({ queries, perQueryMax = 5, onEvent }) {
  if (!Array.isArray(queries) || queries.length === 0) return [];
  if (!config.enableCodebuddy) return stubSearchResults(queries);
  return callWebSearch({ queries, perQueryMax, onEvent });
}
