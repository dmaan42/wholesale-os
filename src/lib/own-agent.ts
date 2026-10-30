/**
 * Our own voice agent: a Twilio TwiML state machine, no ElevenLabs,
 * Bland, Vapi, or any other AI voice platform.
 *
 * The agent does Alex's qualification job, the same way, one question
 * at a time:
 *   greeting -> motivation -> timeline -> price -> condition -> wrap-up
 * It never quotes a specific offer price, never claims to be Darren, and
 * never invents a callback number. Voicemail leaves Darren's real number
 * (CALLBACK_NUMBER in own-dialer.ts).
 *
 * Dispositions are derived ONLY from the seller's actual spoken answers
 * (see deriveDisposition). A call that ends with no qualifying answer
 * gets NO disposition — its summary says so plainly — instead of a
 * guessed "hot" or "interested" tag. That rule exists because AI outcome
 * tags were previously verified wrong against real call summaries.
 */
import { CALLBACK_NUMBER } from "./own-dialer";

export type OwnDisposition =
  | "interested"
  | "follow_up"
  | "not_interested"
  | "dnc"
  | "voicemail"
  | "no_answer"
  | "busy"
  | "failed";

export type AgentStep =
  | "greeting"
  | "motivation"
  | "timeline"
  | "price"
  | "condition"
  | "wrapup";

export const AGENT_STEPS: AgentStep[] = [
  "greeting",
  "motivation",
  "timeline",
  "price",
  "condition",
  "wrapup",
];

/** Next step after `step`, or null when the conversation is over. */
export function nextStep(step: AgentStep): AgentStep | null {
  const i = AGENT_STEPS.indexOf(step);
  return i >= 0 && i < AGENT_STEPS.length - 1 ? AGENT_STEPS[i + 1] : null;
}

export interface LeadContext {
  ownerName: string;
  address: string;
  city: string;
}

function nameOrFallback(ctx: LeadContext): string {
  return ctx.ownerName || "there";
}

function cityOrFallback(ctx: LeadContext): string {
  return ctx.city || "your area";
}

/** Escape text for inclusion in TwiML <Say> / attribute values. */
export function twimlEscape(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The spoken prompt for each step (greeting is a statement, not a question). */
export function stepPrompt(step: AgentStep, ctx: LeadContext): string {
  switch (step) {
    case "greeting":
      return (
        `Hi ${nameOrFallback(ctx)}, this is Darren's automated assistant, ` +
        `calling on behalf of Darren, a real estate investor who buys houses in ${cityOrFallback(ctx)}. ` +
        `I'm calling about your property at ${ctx.address || "your property"}.`
      );
    case "motivation":
      return "Are you considering selling that property, and if so, what has you thinking about selling?";
    case "timeline":
      return "If you did sell, how soon would you want that to happen?";
    case "price":
      return "What price would you be hoping to get for the property?";
    case "condition":
      return "How would you describe the general condition of the property?";
    case "wrapup":
      return "";
  }
}

/** Voicemail message. Callback number is Darren's real number, never invented. */
export function voicemailMessage(ctx: LeadContext): string {
  return (
    `Hi ${nameOrFallback(ctx)}, this is Darren's automated assistant, ` +
    `calling on behalf of Darren, a real estate investor who buys houses in ${cityOrFallback(ctx)}. ` +
    `We're calling about your property at ${ctx.address || "your property"}. ` +
    `If you're open to talking about selling, please call Darren back at ` +
    `${CALLBACK_NUMBER}. Thanks, and have a good day.`
  );
}

/** Label used when appending a spoken answer to the transcript. */
export function answerLabel(step: AgentStep): string {
  switch (step) {
    case "motivation":
      return "Motivation";
    case "timeline":
      return "Timeline";
    case "price":
      return "Asking price";
    case "condition":
      return "Condition";
    default:
      return "Answer";
  }
}

const DNC_RE = /remove me|do not call|don'?t call|take me off|stop calling|unsubscribe|do not contact/i;
const NOT_INTERESTED_RE = /not interested|not selling|don'?t want to sell|no thanks|leave me alone|not for sale/i;
const INTERESTED_RE = /yes.*(interested|want to sell|considering selling|thinking about selling)|i'?m interested|i want to sell|ready to sell|i'?d sell|willing to sell/i;
const FOLLOW_UP_RE = /call (me |us )?back|follow ?up|maybe later|think about it|not (right )?now|send (me |us )?(more )?info|later|next (month|year)|in a few/i;

export function isDncAnswer(answer: string): boolean {
  return DNC_RE.test(answer);
}

/**
 * Derive a disposition from the seller's actual answers only.
 * - dnc: any removal request (checked first, always wins).
 * - not_interested: explicit rejection.
 * - interested: explicit interest in selling (not just politeness or a
 *   price quote). A price alone, with no interest language, is NOT
 *   "interested" — that is how mislabeled "hot" leads happened before.
 * - follow_up: engaged (answered at least one question) but not ready,
 *   or asked for a callback / more time.
 * - null: no qualifying answer at all (hung up early, silence). The
 *   caller must leave the outcome blank and say so in the summary,
 *   never guess.
 */
export function deriveDisposition(
  answers: Partial<Record<AgentStep, string>>
): OwnDisposition | null {
  const all = Object.values(answers).join(" ");
  if (!all.trim()) return null;
  if (DNC_RE.test(all)) return "dnc";
  if (NOT_INTERESTED_RE.test(all)) return "not_interested";
  if (INTERESTED_RE.test(all)) return "interested";
  if (FOLLOW_UP_RE.test(all)) return "follow_up";
  // Answered questions without a rejection or a callback request: they
  // engaged, so this is a follow-up candidate, not a confirmed seller.
  return "follow_up";
}

/** Human-readable summary built only from recorded answers. */
export function buildSummary(
  answers: Partial<Record<AgentStep, string>>
): string {
  const parts: string[] = [];
  if (answers.motivation) parts.push(`Motivation: ${answers.motivation}`);
  if (answers.timeline) parts.push(`Timeline: ${answers.timeline}`);
  if (answers.price) parts.push(`Asking price: ${answers.price}`);
  if (answers.condition) parts.push(`Condition: ${answers.condition}`);
  return parts.length
    ? parts.join(" | ")
    : "Call completed but the seller gave no qualifying answers before hanging up.";
}

/**
 * Parse a stored transcript ("Motivation: ...\nTimeline: ...") back
 * into per-step answers. Transcript lines are the source of truth for
 * answers across Gather callbacks.
 */
export function parseAnswers(transcript: string | null): Partial<Record<AgentStep, string>> {
  const out: Partial<Record<AgentStep, string>> = {};
  if (!transcript) return out;
  const byLabel: Record<string, AgentStep> = {
    Motivation: "motivation",
    Timeline: "timeline",
    "Asking price": "price",
    Condition: "condition",
  };
  for (const line of transcript.split("\n")) {
    const m = line.match(/^([^:]+):\s*(.+)$/);
    if (m && byLabel[m[1]]) out[byLabel[m[1]]] = m[2];
  }
  return out;
}

/** Append one labeled answer line to a transcript. */
export function appendAnswer(
  transcript: string | null,
  step: AgentStep,
  answer: string
): string {
  const line = `${answerLabel(step)}: ${answer}`;
  return transcript ? `${transcript}\n${line}` : line;
}
