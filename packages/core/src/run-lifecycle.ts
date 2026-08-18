import process from "node:process";
import type { EffectiveConfig, Run, RunStatus } from "./contracts.js";
import type { RunStore } from "./run-store.js";

type FinalRunStatus = Exclude<RunStatus, "running">;

interface SignalSource {
  once(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  removeListener(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export async function executeRun(
  store: RunStore,
  target: string,
  config: EffectiveConfig,
  operation: (signal: AbortSignal) => Promise<FinalRunStatus>,
  signalSource: SignalSource = process,
): Promise<{ run: Run; filePath: string }> {
  const created = await store.create(target, config);
  const controller = new AbortController();
  let interrupted = false;
  const cancel = () => {
    interrupted = true;
    controller.abort();
  };
  signalSource.once("SIGINT", cancel);
  signalSource.once("SIGTERM", cancel);

  try {
    const status = await operation(controller.signal);
    const run = await store.finish(
      created.filePath,
      created.run,
      interrupted ? "cancelled" : status,
    );
    return { run, filePath: created.filePath };
  } catch (error) {
    await store.finish(created.filePath, created.run, "incomplete");
    throw error;
  } finally {
    signalSource.removeListener("SIGINT", cancel);
    signalSource.removeListener("SIGTERM", cancel);
  }
}
