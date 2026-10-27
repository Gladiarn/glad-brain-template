/**
 * A minimal client for the Gemini REST API, over `fetch`.
 *
 * The key travels only in the `x-goog-api-key` header. It is never put in a
 * URL, and no error message is built from a response body, a request, or the
 * underlying exception, so it cannot leak into a log or a thrown error.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GeminiErrorKind = "rate-limit" | "server" | "timeout" | "network" | "rejected" | "bad-response";

export class GeminiError extends Error {
	readonly kind: GeminiErrorKind;
	constructor(kind: GeminiErrorKind, message: string) {
		super(message);
		this.name = "GeminiError";
		this.kind = kind;
	}
}

export type GeminiResult = { json: unknown; promptTokens: number; outputTokens: number };

export const DEFAULT_TIMEOUT_MS = 20_000;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export async function callGemini(opts: {
	model: string;
	apiKey: string;
	system: string;
	user: string;
	fetchImpl: typeof fetch;
	timeoutMs?: number;
}): Promise<GeminiResult> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	let response: Response;
	try {
		response = await opts.fetchImpl(`${ENDPOINT}/${encodeURIComponent(opts.model)}:generateContent`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
			body: JSON.stringify({
				systemInstruction: { parts: [{ text: opts.system }] },
				contents: [{ role: "user", parts: [{ text: opts.user }] }],
				generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
			}),
			signal: controller.signal,
		});
	} catch (e) {
		if (controller.signal.aborted || (e as Error | undefined)?.name === "AbortError") {
			throw new GeminiError("timeout", `Gemini request timed out after ${Math.round(timeoutMs / 1000)}s`);
		}
		throw new GeminiError("network", "network error reaching Gemini");
	} finally {
		clearTimeout(timer);
	}

	if (response.status === 429) throw new GeminiError("rate-limit", "Gemini rate limit (HTTP 429)");
	if (response.status >= 500) throw new GeminiError("server", `Gemini server error (HTTP ${response.status})`);
	if (!response.ok) throw new GeminiError("rejected", `Gemini rejected the request (HTTP ${response.status})`);

	try {
		const data = (await response.json()) as {
			candidates?: { content?: { parts?: { text?: unknown }[] } }[];
			usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
		};
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (typeof text !== "string") throw new Error("no text");
		const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
		return {
			json: JSON.parse(text),
			promptTokens: num(data.usageMetadata?.promptTokenCount),
			outputTokens: num(data.usageMetadata?.candidatesTokenCount),
		};
	} catch {
		throw new GeminiError("bad-response", "Gemini returned an answer that could not be read");
	}
}

/**
 * Canned answers for the end-to-end test: `<dir>/*.json`, consumed in name
 * order, one per call. A file is `{ "json": <model output>, "prompt": n,
 * "output": n }` or `{ "status": 429 }`.
 */
function fakeFetchFromDir(dir: string): typeof fetch {
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.sort();
	let next = 0;
	return (async () => {
		const file = files[next++];
		if (file === undefined) throw new TypeError("no canned Gemini answer left");
		const step = JSON.parse(readFileSync(join(dir, file), "utf8")) as { json?: unknown; status?: number; prompt?: number; output?: number };
		if (typeof step.status === "number") return new Response("{}", { status: step.status });
		return new Response(
			JSON.stringify({
				candidates: [{ content: { parts: [{ text: JSON.stringify(step.json) }] } }],
				usageMetadata: { promptTokenCount: step.prompt ?? 0, candidatesTokenCount: step.output ?? 0 },
			}),
			{ status: 200 },
		);
	}) as typeof fetch;
}

/** The real fetch, except under NODE_ENV=test with BRAIN_GEMINI_FAKE set. */
export function selectFetch(env: NodeJS.ProcessEnv = process.env): typeof fetch {
	const fake = env["BRAIN_GEMINI_FAKE"];
	if (env["NODE_ENV"] === "test" && fake !== undefined && fake !== "") return fakeFetchFromDir(fake);
	return globalThis.fetch;
}
