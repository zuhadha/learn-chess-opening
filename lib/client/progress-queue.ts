/**
 * Debounced progress sync (PRD §42, §75).
 *
 * Attempts are judged locally and queued. The queue posts a batch every
 * `batchSize` attempts (or every `flushIntervalMs`), retries with backoff when
 * the network is unavailable, and flushes on `pagehide` so closing the tab does
 * not lose the last few repetitions.
 *
 * Training never blocks on this: a failed sync is queued again, never surfaced
 * as an error that interrupts the session (PRD §69).
 */

import type { AttemptInput, AttemptResult } from "@/lib/types";

export interface ProgressQueueOptions {
  sessionId: string;
  batchSize?: number;
  flushIntervalMs?: number;
  /** Called with the authoritative per-attempt results after a successful post. */
  onSynced?: (results: AttemptResult[]) => void;
  onStateChange?: (state: { pending: number; syncing: boolean; failed: boolean }) => void;
}

export class ProgressQueue {
  private queue: AttemptInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private syncing = false;
  private failed = false;
  private attempts = 0;
  private disposed = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  constructor(private readonly options: ProgressQueueOptions) {
    this.batchSize = options.batchSize ?? 5;
    this.flushIntervalMs = options.flushIntervalMs ?? 4000;
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", this.handleUnload);
      document.addEventListener("visibilitychange", this.handleVisibility);
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  push(attempt: AttemptInput): void {
    if (this.disposed) return;
    this.queue.push(attempt);
    this.emit();
    if (this.queue.length >= this.batchSize) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
    }
  }

  async flush(): Promise<void> {
    if (this.syncing || this.queue.length === 0 || this.disposed) return;
    this.clearTimer();
    this.syncing = true;
    this.emit();

    const batch = this.queue.splice(0, this.batchSize * 4);

    try {
      const response = await fetch("/api/training/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: this.options.sessionId, attempts: batch }),
      });
      if (!response.ok) throw new Error(`sync failed (${response.status})`);

      const data = (await response.json()) as { results: AttemptResult[] };
      this.failed = false;
      this.attempts = 0;
      this.options.onSynced?.(data.results ?? []);
    } catch {
      // Put the batch back at the front and retry later. Training continues.
      this.queue = [...batch, ...this.queue];
      this.failed = true;
      this.attempts += 1;
      const backoff = Math.min(30_000, 1000 * 2 ** Math.min(5, this.attempts));
      this.timer = setTimeout(() => void this.flush(), backoff);
    } finally {
      this.syncing = false;
      this.emit();
      if (this.queue.length > 0 && !this.timer) {
        this.timer = setTimeout(() => void this.flush(), this.flushIntervalMs);
      }
    }
  }

  /** Last-chance flush when the page goes away. */
  private handleUnload = (): void => {
    if (this.queue.length === 0) return;
    const payload = JSON.stringify({
      sessionId: this.options.sessionId,
      attempts: this.queue.splice(0, this.queue.length),
    });
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      navigator.sendBeacon(
        "/api/training/attempt",
        new Blob([payload], { type: "application/json" }),
      );
    } else {
      void fetch("/api/training/attempt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true,
      });
    }
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === "hidden") void this.flush();
  };

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.handleUnload);
      document.removeEventListener("visibilitychange", this.handleVisibility);
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private emit(): void {
    this.options.onStateChange?.({
      pending: this.queue.length,
      syncing: this.syncing,
      failed: this.failed,
    });
  }
}
