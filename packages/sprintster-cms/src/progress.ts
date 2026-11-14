export type Log = (message: string) => void;

export interface Progress {
  // A phase starting: always logged.
  say(message: string): void;
  // How far a phase is: logged at most once per interval.
  step(label: string, done: number, total?: number): void;
}

export function progress(log: Log | undefined, everyMs = 60_000, now: () => number = Date.now): Progress {
  let last = now();
  return {
    say(message) {
      if (log === undefined) return;
      last = now();
      log(message);
    },
    step(label, done, total) {
      if (log === undefined || now() - last < everyMs) return;
      last = now();
      log(total === undefined ? `${label} ${done}` : `${label} ${done}/${total}`);
    },
  };
}
