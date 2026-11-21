import {
  TRAINING_REVIEW_FINDING_TEXT_MAX,
  TRAINING_REVIEW_FINDINGS_MAX,
  type TrainingReviewFact,
  type TrainingReviewFinding,
  type TrainingReviewSegment,
} from "@sunsteel/contracts";
import type { EvidencePack } from "./training-review-evidence";

/**
 * INTEL-04: the one judge of an answer. A review reaches the member only when
 * every finding cites facts that exist and its own words carry no number, no
 * cause, no diagnosis and no advice -- so whatever the model meant, the only
 * values on screen are the server's and nothing explains why.
 */

export type ReviewCheck =
  | { kind: "REVIEW"; findings: TrainingReviewFinding[] }
  | { kind: "NOT_ENOUGH" }
  | { kind: "INVALID"; problems: string[] };

const SEGMENTS_MAX = 40;

/** A whole word, letters on neither side, in any language. */
const words = (list: readonly string[]) =>
  new RegExp(`(?<![\\p{L}])(${list.join("|")})(?![\\p{L}])`, "iu");

/** Numbers written as words; "one" and "un/una" are left alone, being articles too. */
const NUMBER_WORDS = words([
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "fifteen",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "hundreds?",
  "thousands?",
  "half",
  "halved",
  "twice",
  "thrice",
  "double[ds]?",
  "triple[ds]?",
  "dozens?",
  "percent",
  "dos",
  "tres",
  "cuatro",
  "cinco",
  "seis",
  "siete",
  "ocho",
  "nueve",
  "diez",
  "doce",
  "quince",
  "veinte",
  "treinta",
  "cuarenta",
  "cincuenta",
  "cien",
  "cientos?",
  "mil",
  "mitad",
  "doble",
  "triple",
  "docenas?",
  "por ciento",
]);

/** A stated cause in either language. */
const CAUSES = words([
  "because",
  "due to",
  "owing to",
  "thanks to",
  "caused",
  "causes?",
  "as a result",
  "porque",
  "debido a",
  "a causa de",
  "gracias a",
  "causad[oa]s?",
  "causas?",
  "por culpa",
]);

/** What the logs cannot show: conditions and states of the body. */
const DIAGNOSES = words([
  "fatigued?",
  "tired(ness)?",
  "exhaust\\w*",
  "over-?train\\w*",
  "injur\\w*",
  "recover\\w*",
  "sleep\\w*",
  "stress\\w*",
  "sore\\w*",
  "pain\\w*",
  "hormon\\w*",
  "nervous system",
  "cns",
  "nutrition\\w*",
  "diet\\w*",
  "fatiga\\w*",
  "cansad\\w*",
  "cansancio",
  "agotad\\w*",
  "agotamiento",
  "sobreentren\\w*",
  "lesi[oó]n\\w*",
  "lesionad\\w*",
  "recuper\\w*",
  "sueño",
  "dormi\\w*",
  "estr[eé]s",
  "agujetas?",
  "dolor\\w*",
  "sistema nervioso",
  "nutrici[oó]n",
  "dietas?",
]);

/** Telling the member what to do. */
const ADVICE = words([
  "should",
  "must",
  "need to",
  "needs to",
  "try",
  "consider",
  "recommend\\w*",
  "make sure",
  "deber[ií]as?",
  "debes",
  "tienes que",
  "intenta",
  "prueba a",
  "considera",
  "recomiend\\w*",
  "aseg[uú]rate",
  "conviene",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function readSegment(value: unknown): TrainingReviewSegment | null {
  if (!isRecord(value)) return null;
  if (typeof value.text === "string" && value.fact === undefined)
    return { text: value.text };
  if (typeof value.fact === "string" && value.text === undefined)
    return { fact: value.fact };
  return null;
}

export function checkReviewAnswer(
  answer: unknown,
  pack: EvidencePack,
): ReviewCheck {
  if (!isRecord(answer)) {
    return { kind: "INVALID", problems: ["No answer arrived whole."] };
  }
  if (answer.status === "NOT_ENOUGH") return { kind: "NOT_ENOUGH" };
  if (answer.status !== "REVIEW") {
    return {
      kind: "INVALID",
      problems: ["The status must be REVIEW or NOT_ENOUGH."],
    };
  }
  const raw = answer.findings;
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      kind: "INVALID",
      problems: ["A review needs at least one finding."],
    };
  }

  const problems: string[] = [];
  if (raw.length > TRAINING_REVIEW_FINDINGS_MAX) {
    problems.push(
      `A review has at most ${TRAINING_REVIEW_FINDINGS_MAX} findings.`,
    );
  }
  const ids = new Set(pack.facts.map((fact) => fact.id));
  const findings: TrainingReviewFinding[] = [];
  raw.slice(0, TRAINING_REVIEW_FINDINGS_MAX).forEach((value, index) => {
    const label = `Finding ${index + 1}`;
    const segments =
      isRecord(value) && Array.isArray(value.segments) ? value.segments : null;
    if (!segments || segments.length === 0 || segments.length > SEGMENTS_MAX) {
      problems.push(`${label} needs between one and ${SEGMENTS_MAX} segments.`);
      return;
    }
    const read: TrainingReviewSegment[] = [];
    let text = "";
    let cited = 0;
    for (const segment of segments.map(readSegment)) {
      if (!segment) {
        problems.push(
          `${label} has a segment that is neither words nor a fact.`,
        );
        continue;
      }
      if ("fact" in segment) {
        if (!ids.has(segment.fact)) {
          problems.push(
            `${label} cites ${segment.fact}, which is not in the evidence.`,
          );
        }
        cited += 1;
      } else {
        text += segment.text;
      }
      read.push(segment);
    }
    if (cited === 0) problems.push(`${label} cites no fact.`);
    if (!text.trim()) problems.push(`${label} has no words of its own.`);
    if (text.length > TRAINING_REVIEW_FINDING_TEXT_MAX) {
      problems.push(
        `${label}'s words are longer than ${TRAINING_REVIEW_FINDING_TEXT_MAX} characters.`,
      );
    }
    // "1RM" is the name of a measure (the app's own copy says "1RM estimado"),
    // not a value, so it is the one digit the model's words may carry.
    if (/\d/.test(text.replace(/\b1RM\b/gi, ""))) {
      problems.push(
        `${label} writes a digit; insert the fact that holds the value instead.`,
      );
    }
    const checks: ReadonlyArray<[RegExp, string]> = [
      [
        NUMBER_WORDS,
        "writes a number in words; insert the fact that holds it instead",
      ],
      [CAUSES, "states a cause"],
      [DIAGNOSES, "names a condition or state the logs cannot show"],
      [ADVICE, "gives advice"],
    ];
    for (const [pattern, what] of checks) {
      const match = pattern.exec(text);
      if (match) problems.push(`${label} ${what} ("${match[0]}").`);
    }
    findings.push({ segments: read });
  });

  return problems.length
    ? { kind: "INVALID", problems }
    : { kind: "REVIEW", findings };
}

/** The facts the findings cite, in the pack's order, each once. */
export function citedFacts(
  findings: readonly TrainingReviewFinding[],
  pack: EvidencePack,
): TrainingReviewFact[] {
  const cited = new Set(
    findings.flatMap((finding) =>
      finding.segments.flatMap((segment) =>
        "fact" in segment ? [segment.fact] : [],
      ),
    ),
  );
  return pack.facts.filter((fact) => cited.has(fact.id));
}
