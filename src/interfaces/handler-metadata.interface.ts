import type { WorkOptions, Queue } from "pg-boss";

export interface HandlerMetadata {
  token: string;
  jobName: string;
  workOptions: WorkOptions;
  createQueueOptions?: Omit<Queue, "name">;
}
