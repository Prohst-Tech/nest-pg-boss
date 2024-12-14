import { Logger } from "@nestjs/common";
import { delay, Observable, retryWhen, scan } from "rxjs";

const logger = new Logger("PGBossModule");

export function getJobToken(jobName: string): string {
  return `JobService(${jobName})`;
}

export function handleRetry(
  retryAttempts = 9,
  retryDelay = 3000,
  toRetry?: (err: any) => boolean,
): <T>(source: Observable<T>) => Observable<T> {
  return <T>(source: Observable<T>) =>
    source.pipe(
      retryWhen((e) =>
        e.pipe(
          scan((errorCount, error: Error) => {
            if (toRetry && !toRetry(error)) {
              throw error;
            }

            logger.error(
              "Unable to connect to the database, retrying",
              {
                error,
                retryAttempts,
                retryDelay,
              },
            );
            if (errorCount + 1 >= retryAttempts) {
              throw error;
            }
            return errorCount + 1;
          }, 0),
          delay(retryDelay),
        ),
      ),
    );
}
