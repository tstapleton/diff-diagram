export interface AuditEventModel {
  id: string;
  userId: string;
  action: string;
  details: Record<string, unknown>;
  performedBy: string;
  performedAt: string;
}
