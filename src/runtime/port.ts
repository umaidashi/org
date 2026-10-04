export interface RuntimeTurnInput {
  readonly agent: { readonly id: string; readonly role: string };
  readonly instruction: string;
  readonly message: string;
  readonly sessionId?: string;
}
export interface RuntimeTurnResult {
  readonly sessionId: string;
  readonly text: string;
}
