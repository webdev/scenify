/**
 * Heuristic predictor for whether OpenAI's gpt-image-2 content checker
 * will reject a prompt. Used to skip the wasted call and route directly
 * to a more permissive model (nano-banana-2, flux-kontext).
 *
 * False positives are cheap (we just use a different model). False
 * negatives are caught by the post-flight fallback chain.
 */

const RISKY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bintimate\b/i, reason: "intimate" },
  { re: /\blingerie\b/i, reason: "lingerie" },
  { re: /\bnegligee\b/i, reason: "negligee" },
  { re: /\bbabydoll\b/i, reason: "babydoll" },
  { re: /\bteddy\b/i, reason: "teddy" },
  { re: /\bcorset\b/i, reason: "corset" },
  { re: /\bbustier\b/i, reason: "bustier" },
  { re: /\bbra\b/i, reason: "bra" },
  { re: /\bpanties?\b/i, reason: "panties" },
  { re: /\bunderwear\b/i, reason: "underwear" },
  { re: /\bthong\b/i, reason: "thong" },
  { re: /\bbodysuit\b/i, reason: "bodysuit" },
  { re: /\bbikini\b/i, reason: "bikini" },
  { re: /\bswimsuit\b/i, reason: "swimsuit" },
  { re: /\bswimwear\b/i, reason: "swimwear" },
  { re: /\bone[- ]piece\b/i, reason: "one-piece" },
  { re: /\bsheer\b/i, reason: "sheer" },
  { re: /\bsee[- ]through\b/i, reason: "see-through" },
  { re: /\bsemi[- ]sheer\b/i, reason: "semi-sheer" },
  { re: /\btransparent\b/i, reason: "transparent" },
  { re: /\bmesh\b/i, reason: "mesh" },
  { re: /\blace\b/i, reason: "lace" },
  { re: /\bopenwork\b/i, reason: "openwork" },
  { re: /\bcut[- ]?out\b/i, reason: "cutout" },
  { re: /\bstrapless\b/i, reason: "strapless" },
  { re: /\bbandeau\b/i, reason: "bandeau" },
  { re: /\btube top\b/i, reason: "tube top" },
  { re: /\bcrop top\b/i, reason: "crop top" },
  { re: /\bbody[- ]hugging\b/i, reason: "body-hugging" },
  { re: /\bform[- ]fitting\b/i, reason: "form-fitting" },
  { re: /\bplunging\b/i, reason: "plunging" },
  { re: /\blow[- ]cut\b/i, reason: "low-cut" },
  { re: /\bbackless\b/i, reason: "backless" },
  { re: /\bskin[- ]baring\b/i, reason: "skin-baring" },
  { re: /\bbare (?:shoulders?|midriff|legs?|chest|back)\b/i, reason: "bare-body" },
  { re: /\bmidriff\b/i, reason: "midriff" },
  { re: /\bcleavage\b/i, reason: "cleavage" },
  { re: /\bnude\b/i, reason: "nude" },
];

export interface SafetyPrediction {
  risky: boolean;
  matched: string[];
}

export function predictGptImageRejection(prompt: string): SafetyPrediction {
  const matched: string[] = [];
  for (const { re, reason } of RISKY_PATTERNS) {
    if (re.test(prompt)) matched.push(reason);
  }
  return { risky: matched.length > 0, matched };
}
