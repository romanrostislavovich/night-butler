/*
 * The local model, through Ollama (https://ollama.com): an open-weight model on this computer,
 * nothing leaves it. Every question asks for JSON of a given shape (Ollama's structured
 * outputs), so a small model on a CPU still gives answers a program can use.
 */

export interface ModelConfig {
  /** Ollama's address. */
  url: string;
  /** An Ollama model tag, e.g. `qwen2.5:3b`. */
  name: string;
}

export interface Answer<T> {
  value: T;
  /** How long the model thought, in seconds. */
  seconds: number;
}

/** A JSON Schema of the answer, as Ollama's `format` takes it. */
export type Schema = Record<string, unknown>;

export class ModelUnavailable extends Error {}

/** One question; the answer is parsed JSON of `schema`. */
export async function ask<T>(
  model: ModelConfig,
  instruction: string,
  question: string,
  schema: Schema,
): Promise<Answer<T>> {
  const started = performance.now();
  let response: Response;
  try {
    response = await fetch(`${model.url.replace(/\/+$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.name,
        stream: false,
        format: schema,
        // The same question gets the same answer: a butler is not creative with your money.
        options: { temperature: 0 },
        messages: [
          { role: 'system', content: instruction },
          { role: 'user', content: question },
        ],
      }),
    });
  } catch (error) {
    throw new ModelUnavailable(`Ollama is not running at ${model.url} (${String(error)})`);
  }
  if (!response.ok) {
    throw new ModelUnavailable(`Ollama answered ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { message?: { content?: string } };
  return {
    value: JSON.parse(data.message?.content ?? 'null') as T,
    seconds: (performance.now() - started) / 1000,
  };
}

/** Whether Ollama runs and has the model; the reason when not. */
export async function check(model: ModelConfig): Promise<string | null> {
  try {
    const response = await fetch(`${model.url.replace(/\/+$/, '')}/api/tags`);
    const { models } = (await response.json()) as { models: { name: string }[] };
    const names = models.map((one) => one.name);
    if (!names.some((name) => name === model.name || name === `${model.name}:latest`)) {
      return `the model ${model.name} is not pulled: run \`ollama pull ${model.name}\``;
    }
    return null;
  } catch {
    return `Ollama is not running at ${model.url}: install it from https://ollama.com and start it`;
  }
}
