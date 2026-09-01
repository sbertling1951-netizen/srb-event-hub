import { type DraftAnswer } from "@/lib/evaluations/answerModel";

// Per-question serialized save queue for the member evaluation page.
//
// Guarantees:
//   * At most one save in flight per question. A newer edit that arrives
//     while a save is running is coalesced -- when the running save
//     settles, the queue re-saves the LATEST draft. An older completion
//     can therefore never overwrite a newer answer.
//   * Every save result is inspected: an RPC `error` marks the question
//     failed and is surfaced; the pending draft is retained so a later
//     flush() retries it.
//   * flush() awaits every queued + in-flight save and reports which
//     questions still failed -- callers use it before navigation, submit,
//     and unmount so no pending debounced text is lost.

export type SaveOutcome = { error: unknown } | { error?: null | undefined };

export type SaveFn = (
  questionId: string,
  draft: DraftAnswer,
) => Promise<SaveOutcome>;

type QuestionState = {
  latest: DraftAnswer;
  latestSeq: number;
  savedSeq: number;
  running: boolean;
  failed: boolean;
  waiters: (() => void)[];
};

export type SaveQueue = {
  /** Record the latest draft for a question and (re)start its saver. */
  enqueue: (questionId: string, draft: DraftAnswer) => void;
  /** Await all queued + in-flight saves; returns ids that still failed. */
  flush: () => Promise<{ ok: boolean; failed: string[] }>;
  /** True while any question has unsaved or in-flight work. */
  hasPending: () => boolean;
  /** Ids of questions whose most recent save attempt errored. */
  failedIds: () => string[];
};

export function createSaveQueue(save: SaveFn): SaveQueue {
  const states = new Map<string, QuestionState>();

  const get = (id: string): QuestionState => {
    let s = states.get(id);
    if (!s) {
      s = {
        latest: { selectedLabels: [], answerText: "", ratingValue: null, commentText: "" },
        latestSeq: 0,
        savedSeq: 0,
        running: false,
        failed: false,
        waiters: [],
      };
      states.set(id, s);
    }
    return s;
  };

  const settled = (s: QuestionState): boolean =>
    !s.running && (s.savedSeq >= s.latestSeq || s.failed);

  const notify = (s: QuestionState) => {
    if (settled(s)) {
      const w = s.waiters;
      s.waiters = [];
      w.forEach((fn) => fn());
    }
  };

  async function run(id: string): Promise<void> {
    const s = get(id);
    if (s.running) {
      return;
    }
    s.running = true;
    try {
      // Keep saving until the latest draft is what got persisted. Each
      // pass reads `latest` fresh, so intermediate drafts are coalesced
      // and the newest value always wins.
      while (s.savedSeq < s.latestSeq) {
        const attemptSeq = s.latestSeq;
        const draft = s.latest;
        let outcome: SaveOutcome;
        try {
          outcome = await save(id, draft);
        } catch (err) {
          outcome = { error: err ?? new Error("save threw") };
        }
        if (outcome && "error" in outcome && outcome.error) {
          s.failed = true;
          break;
        }
        s.failed = false;
        s.savedSeq = Math.max(s.savedSeq, attemptSeq);
      }
    } finally {
      s.running = false;
      notify(s);
    }
  }

  return {
    enqueue(questionId, draft) {
      const s = get(questionId);
      s.latestSeq += 1;
      s.latest = draft;
      s.failed = false;
      void run(questionId);
    },

    async flush() {
      const failed: string[] = [];
      const pending: Promise<void>[] = [];
      for (const [id, s] of states) {
        if (settled(s)) {
          if (s.failed) {
            failed.push(id);
          }
          continue;
        }
        // ensure a saver is active (it may have exited between edits)
        void run(id);
        pending.push(
          new Promise<void>((resolve) => {
            s.waiters.push(resolve);
          }).then(() => {
            if (s.failed || s.savedSeq < s.latestSeq) {
              failed.push(id);
            }
          }),
        );
      }
      await Promise.all(pending);
      return { ok: failed.length === 0, failed: [...new Set(failed)] };
    },

    hasPending() {
      for (const s of states.values()) {
        if (!settled(s)) {
          return true;
        }
      }
      return false;
    },

    failedIds() {
      const out: string[] = [];
      for (const [id, s] of states) {
        if (s.failed) {
          out.push(id);
        }
      }
      return out;
    },
  };
}
