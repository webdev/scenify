import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "",
});

const NAMING_MODEL = "gpt-4o";

const NamingSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(40)
    .describe(
      "A 2-3 word evocative title in title case, like 'Studio Athletic', 'Leather Noir', 'Graffiti Alley', 'Mono Street', 'Shutter Crew'. Editorial, magazine-y feel. NO trailing punctuation.",
    ),
  description: z
    .string()
    .min(3)
    .max(60)
    .describe(
      "A short uppercase tagline of 2-3 words separated by ' · ' (space, middle-dot, space). Names location/setting + lighting/mood. Examples: 'STUDIO · SOFT STROBE', 'INTERIOR · LOW KEY TUNGSTEN', 'ALLEY · BOUNCED DAYLIGHT', 'STREET · OVERCAST CONCRETE', 'ROLLUP DOORS · MORNING SUN'. ALL CAPS. No trailing punctuation.",
    ),
});

const SYSTEM_PROMPT = `You are an editorial naming consultant for a premium e-commerce lifestyle photography studio. Each "preset" represents a visual register — a folder of reference images that define a target scene/lighting style for product photography.

Given the preset's existing name, produce a more evocative, magazine-style name and a short uppercase tagline that hints at setting + lighting/mood.

Style targets:
- name: 2-3 words, title case, editorial. Vivid but restrained — like a fashion-magazine spread title. Examples: "Studio Athletic", "Leather Noir", "Graffiti Alley", "Mono Street", "Shutter Crew", "Golden Drift", "Velvet Hour".
- description: 2-3 ALL-CAPS words separated by " · " (space, middle-dot, space). Names a location/setting and a lighting/mood. Examples: "STUDIO · SOFT STROBE", "INTERIOR · LOW KEY TUNGSTEN", "ALLEY · BOUNCED DAYLIGHT", "STREET · OVERCAST CONCRETE", "ROLLUP DOORS · MORNING SUN".

Hard rules:
- Stay tonally close to the existing name's intent. "Studio Clean" should still read as a studio register; "Golden Hour" should still evoke golden hour. Don't drift into a different register.
- Never invent technical jargon that wasn't implied.
- No emojis, no trailing punctuation, no quote marks in the output.
- Output JSON matching the provided schema.`;

export async function generatePresetName(args: {
  currentName: string;
  currentDescription?: string;
}): Promise<{ name: string; description: string }> {
  const { currentName, currentDescription } = args;
  const userText = `Existing name: ${currentName}${
    currentDescription ? `\nExisting description: ${currentDescription}` : ""
  }

Produce a more evocative editorial name and an uppercase tagline for this preset.`;

  const { object } = await generateObject({
    model: openai(NAMING_MODEL),
    system: SYSTEM_PROMPT,
    schema: NamingSchema,
    messages: [{ role: "user", content: userText }],
    maxOutputTokens: 200,
  });
  return { name: object.name.trim(), description: object.description.trim() };
}
