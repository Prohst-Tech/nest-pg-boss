import type { ConstructorOptions } from "pg-boss";

// TODO: Figure at "name", "application_name", "instanceName"

export type PGBossModuleOptions = {
  /**
   * Number of times to retry connecting
   * Default: 10
   */
  retryAttempts?: number;
  /**
   * Delay between connection retry attempts (ms)
   * Default: 3000
   */
  retryDelay?: number;
  /**
   * Function that determines whether the module should
   * attempt to connect upon failure.
   *
   * @param error error that was thrown
   * @returns whether to retry connection or not
   */
  toRetry?: (error: any) => boolean;
} & ConstructorOptions;
