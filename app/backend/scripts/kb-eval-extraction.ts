/**
 * Harness offline de evaluación del prompt de extracción pasiva.
 *
 * Uso (desde app/backend, con OPENAI_API_KEY en el entorno):
 *   pnpm exec ts-node -r dotenv/config scripts/kb-eval-extraction.ts
 *
 * Mide precisión / recall contra golden-transcripts.json.
 * NO escribe en la base de datos.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { config as loadEnv } from 'dotenv';
import {
  quoteSupportedByTranscript,
  toSubjectSlug,
} from '../src/knowledge-base/kb-text.util';

loadEnv({ path: join(__dirname, '../../../.env') });

interface ExpectedFact {
  subject_slug: string;
  canonical_contains: string[];
  fact_type: string;
}

interface GoldenCase {
  id: string;
  transcript: string;
  expected_facts: ExpectedFact[];
}

interface ExtractedFact {
  fact_type?: string;
  subject?: string;
  canonical_text?: string;
  confidence?: number;
  source_quote?: string;
}

async function extract(text: string, model: string, apiKey: string): Promise<ExtractedFact[]> {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: [
                'Extrae hechos de negocio persistentes del transcript.',
                'Devuelve SOLO JSON válido: {"facts":[...]}',
                'Cada fact: fact_type (hecho|decision|preferencia|procedimiento|regla),',
                'subject, value (objeto JSON), canonical_text (oración en español),',
                'confidence (0-1), source_quote (span LITERAL del transcript que lo sustenta).',
                'No inventes hechos. Si no hay hechos claros, {"facts":[]}.',
                'source_quote es obligatorio y debe aparecer casi textual en el transcript.',
              ].join(' '),
            },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      ],
      text: { format: { type: 'json_object' } },
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM failed (${response.status}): ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
  };
  const raw =
    payload.output_text ??
    payload.output?.flatMap((o) => o.content ?? []).find((c) => c.text)?.text ??
    '{}';
  const parsed = JSON.parse(raw) as { facts?: ExtractedFact[] };
  return Array.isArray(parsed.facts) ? parsed.facts : [];
}

function matchesExpected(fact: ExtractedFact, expected: ExpectedFact): boolean {
  const slug = toSubjectSlug(fact.subject ?? '');
  const text = (fact.canonical_text ?? '').toLowerCase();
  const slugOk =
    slug === expected.subject_slug ||
    slug.includes(expected.subject_slug) ||
    expected.subject_slug.includes(slug);
  const contentOk = expected.canonical_contains.some((c) =>
    text.includes(c.toLowerCase()),
  );
  return slugOk && contentOk;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required');
  }
  const model = process.env.OPENAI_TEXT_MODEL ?? 'gpt-4.1';
  const goldenPath = join(
    __dirname,
    '../src/knowledge-base/eval/golden-transcripts.json',
  );
  const cases = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenCase[];

  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  let quoteFailures = 0;

  for (const c of cases) {
    process.stdout.write(`Evaluating ${c.id}... `);
    const facts = await extract(c.transcript, model, apiKey);
    const matchedExpected = new Set<number>();
    let localTp = 0;
    let localFp = 0;

    for (const fact of facts) {
      if (
        fact.source_quote &&
        !quoteSupportedByTranscript(fact.source_quote, c.transcript)
      ) {
        quoteFailures += 1;
        localFp += 1;
        continue;
      }

      const idx = c.expected_facts.findIndex(
        (e, i) => !matchedExpected.has(i) && matchesExpected(fact, e),
      );
      if (idx >= 0) {
        matchedExpected.add(idx);
        localTp += 1;
      } else if (c.expected_facts.length === 0) {
        localFp += 1;
      } else {
        localFp += 1;
      }
    }

    const localFn = c.expected_facts.length - matchedExpected.size;
    truePositives += localTp;
    falsePositives += localFp;
    falseNegatives += localFn;
    console.log(`tp=${localTp} fp=${localFp} fn=${localFn}`);
  }

  const precision =
    truePositives + falsePositives === 0
      ? 1
      : truePositives / (truePositives + falsePositives);
  const recall =
    truePositives + falseNegatives === 0
      ? 1
      : truePositives / (truePositives + falseNegatives);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);

  console.log('\n=== KB extraction eval ===');
  console.log(`cases=${cases.length}`);
  console.log(`precision=${precision.toFixed(3)}`);
  console.log(`recall=${recall.toFixed(3)}`);
  console.log(`f1=${f1.toFixed(3)}`);
  console.log(`quote_failures=${quoteFailures}`);
  console.log(
    '\nCalibrate thresholds (0.92 cosine, 0.85 overlap, 0.75 confidence, 3 observations, 0.6 passive default) against these results before enabling KB_EXTRACTION_ENABLED=true.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
