export type Tags = { [key: string]: string };

export default interface Metrics {
  increment(stat: string, tags?: Tags): void;
  timing(stat: string, value: number | Date, tags?: Tags): void;
}
