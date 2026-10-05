export interface WakeupIntent {
  readonly messageId: string;
  readonly roomId: string;
  readonly startedAt: string;
}
export type WakeupResult =
  | {
      readonly status: 'completed';
      readonly replyIds: readonly string[];
      readonly error: null;
      readonly finishedAt: string;
    }
  | {
      readonly status: 'failed';
      readonly replyIds: readonly string[];
      readonly error: string;
      readonly finishedAt: string;
    };
export type WakeupReceipt = WakeupIntent &
  (
    | {
        readonly status: 'running';
        readonly replyIds: readonly string[];
        readonly error: null;
        readonly finishedAt: null;
      }
    | WakeupResult
  );
export interface WakeupJournal {
  claim(intent: WakeupIntent): boolean;
  finish(messageId: string, result: WakeupResult): void;
  get(messageId: string): WakeupReceipt | undefined;
  list(): readonly WakeupReceipt[];
}
