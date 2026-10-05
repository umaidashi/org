import type { Approval, ApprovalRequest, ApprovalDecisionInput } from './domain.js';
export interface ApprovalStore {
  requestOnce(request: ApprovalRequest): ApprovalRequest;
  get(id: string): Approval;
  list(): readonly Approval[];
  decide(id: string, input: ApprovalDecisionInput, at: string): Approval;
}
