/**
 * Tiny helpers for the route handlers: input validation and consistent errors
 * (PRD §67 — never trust the body, never leak stack traces).
 */

import { z } from "zod";

import { TrainingError } from "@/lib/training/session-service";

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  request: Request,
): Promise<{ data: z.infer<T> } | { error: Response }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: jsonError("expected a JSON body", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      error: jsonError(
        first ? `${first.path.join(".") || "body"}: ${first.message}` : "invalid request body",
        400,
      ),
    };
  }
  return { data: parsed.data };
}

/** Route bodies are wrapped so a bug becomes a 500, not an unhandled rejection. */
export async function handle(
  fn: () => Promise<Response> | Response,
): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TrainingError) return jsonError(error.message, error.status);
    const message = error instanceof Error ? error.message : "internal error";
    console.error("[api]", message);
    return jsonError(message, 500);
  }
}
