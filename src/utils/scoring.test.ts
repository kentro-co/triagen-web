import { describe, expect, it } from 'vitest';
import {
  computeOverallScore,
  MAX_CRITERION_SCORE,
  parseCriteriaScores,
  parseRecommendation,
  toDisplayCriteriaScores,
} from './scoring';

const job = [
  { name: 'Experiência com atendimento', weight: 0.5, mandatory: true },
  { name: 'Disponibilidade de horário', weight: 0.3, mandatory: true },
  { name: 'Comunicação', weight: 0.2, mandatory: false },
];

const entry = (criterion: string, score: number, extra: Record<string, unknown> = {}) => ({
  criterion,
  covered: true,
  evidence: ['...'],
  reasoning: 'r',
  score,
  gaps: null,
  ...extra,
});

describe('computeOverallScore', () => {
  it('weighted average of 0–3 scores normalized to 0–100', () => {
    const scores = [
      entry('Experiência com atendimento', 3),
      entry('Disponibilidade de horário', 2),
      entry('Comunicação', 1),
    ];
    // (3*0.5 + 2*0.3 + 1*0.2) / 1.0 = 2.3 → 2.3/3 = 76.67%
    expect(computeOverallScore(scores, job)).toBe(77);
  });

  it('all zeros → 0, all threes → 100', () => {
    expect(computeOverallScore(job.map((c) => entry(c.name, 0)), job)).toBe(0);
    expect(computeOverallScore(job.map((c) => entry(c.name, MAX_CRITERION_SCORE)), job)).toBe(100);
  });

  it('clamps out-of-range scores instead of exceeding 100', () => {
    expect(computeOverallScore([entry('Comunicação', 7)], job)).toBe(100);
    expect(computeOverallScore([entry('Comunicação', -2)], job)).toBe(0);
  });

  it('returns undefined when there is nothing to score', () => {
    expect(computeOverallScore([], job)).toBeUndefined();
    expect(computeOverallScore(null, job)).toBeUndefined();
    expect(computeOverallScore('garbage', job)).toBeUndefined();
  });

  it('falls back to equal weights when the job has no criteria', () => {
    expect(computeOverallScore([entry('A', 3), entry('B', 0)], null)).toBe(50);
  });

  it('ignores malformed entries in stored JSON', () => {
    const stored = [entry('Comunicação', 3), { criterion: 'x' }, null, 'y', { score: 2 }];
    expect(computeOverallScore(stored, job)).toBe(100);
  });

  // ── CODE_REVIEW H-13: pinned bugs ────────────────────────────────────────

  it.fails('a criterion missing from the analysis counts as 0 (omission must not raise the score)', () => {
    const complete = [
      entry('Experiência com atendimento', 3),
      entry('Disponibilidade de horário', 0),
      entry('Comunicação', 3),
    ];
    const weakestOmitted = complete.filter((e) => e.criterion !== 'Disponibilidade de horário');
    expect(computeOverallScore(weakestOmitted, job)).toBeLessThanOrEqual(
      computeOverallScore(complete, job)!,
    );
  });

  it.fails('a zero on a mandatory criterion caps the overall score', () => {
    const scores = [
      entry('Experiência com atendimento', 3),
      entry('Disponibilidade de horário', 0), // mandatory: cannot work the required shifts
      entry('Comunicação', 3),
    ];
    // Today this ranks at 70/100; a mandatory fail must not look like a good candidate.
    expect(computeOverallScore(scores, job)).toBeLessThan(50);
  });

  it.fails('duplicated criterion entries are counted once', () => {
    const scores = [entry('Comunicação', 3), entry('Comunicação', 3), entry('Experiência com atendimento', 0)];
    const deduped = [entry('Comunicação', 3), entry('Experiência com atendimento', 0)];
    expect(computeOverallScore(scores, job)).toBe(computeOverallScore(deduped, job));
  });

  it.fails('criterion names are matched ignoring case/whitespace (analyzer paraphrase)', () => {
    const exact = [entry('Comunicação', 3), entry('Experiência com atendimento', 0)];
    const paraphrased = [entry('comunicação ', 3), entry('Experiência com atendimento', 0)];
    expect(computeOverallScore(paraphrased, job)).toBe(computeOverallScore(exact, job));
  });
});

describe('toDisplayCriteriaScores', () => {
  it('normalizes entries for rendering', () => {
    const [d] = toDisplayCriteriaScores([
      { criterion: 'Comunicação', score: 2.6, evidence: ['ok', '', '  ', 3], reasoning: '  ', gaps: '' },
    ]);
    expect(d).toEqual({
      criterion: 'Comunicação',
      score: 3,
      covered: true,
      reasoning: null,
      evidence: ['ok'],
      gaps: null,
    });
  });

  it('keeps covered=false (criterion not assessed in the interview)', () => {
    const [d] = toDisplayCriteriaScores([entry('Comunicação', 0, { covered: false })]);
    expect(d.covered).toBe(false);
  });

  it('drops entries without a string criterion or numeric score', () => {
    expect(parseCriteriaScores([{ criterion: 1, score: 2 }, { criterion: 'a', score: '2' }])).toEqual([]);
  });
});

describe('parseRecommendation', () => {
  it.each([
    ['Avançar. Boa candidata.', 'advance', 'Boa candidata.'],
    ['Avançar com ressalvas — precisa de treinamento.', 'advance_with_reservations', 'precisa de treinamento.'],
    ['Não avançar: indisponível aos sábados.', 'do_not_advance', 'indisponível aos sábados.'],
    ['nao avancar - sem experiência', 'do_not_advance', 'sem experiência'],
  ])('%s', (summary, recommendation, summaryText) => {
    expect(parseRecommendation(summary)).toEqual({ recommendation, summaryText });
  });

  it('"Avançar com ressalvas" is not mistaken for "Avançar"', () => {
    expect(parseRecommendation('Avançar com ressalvas').recommendation).toBe('advance_with_reservations');
  });

  it('no recommendation prefix → null, summary untouched', () => {
    expect(parseRecommendation('Candidato comunicativo.')).toEqual({
      recommendation: null,
      summaryText: 'Candidato comunicativo.',
    });
    expect(parseRecommendation(undefined)).toEqual({ recommendation: null, summaryText: '' });
  });

  it('bare verdict keeps the full text as summary', () => {
    expect(parseRecommendation('Não avançar')).toEqual({ recommendation: 'do_not_advance', summaryText: 'Não avançar' });
  });
});
