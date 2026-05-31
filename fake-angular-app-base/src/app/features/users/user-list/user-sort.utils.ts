import { SortModel } from './sort.model';

export function sortComparator<T>(sort: SortModel): (a: T, b: T) => number {
  return (a, b) => {
    const av = (a as Record<string, unknown>)[sort.field];
    const bv = (b as Record<string, unknown>)[sort.field];
    const cmp = String(av ?? '').localeCompare(String(bv ?? ''));
    return sort.direction === 'asc' ? cmp : -cmp;
  };
}
