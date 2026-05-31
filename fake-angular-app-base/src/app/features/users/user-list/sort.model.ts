export type SortDirection = 'asc' | 'desc';

export interface SortModel {
  field: string;
  direction: SortDirection;
}

export const defaultSort: SortModel = { field: 'lastName', direction: 'asc' };
