import type { en } from './en';

type CatalogShape<T> = T extends (...args: infer A) => string ? (...args: A) => string
  : T extends string ? string : { readonly [K in keyof T]: CatalogShape<T[K]> };
export type Messages = CatalogShape<typeof en>;

export function isolate(value: string | number): string {
  return `\u2068${value}\u2069`;
}
