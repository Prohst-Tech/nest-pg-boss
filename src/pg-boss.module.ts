import {
  DynamicModule,
  Global,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { MetadataScanner, ModuleRef } from "@nestjs/core";
import * as PGBoss from "pg-boss";
import { defer, lastValueFrom } from "rxjs";
import { handleRetry } from "./utils";
import { PGBossJobModule } from "./pg-boss-job.module";
import { HandlerScannerService } from "./handler-scanner.service";
import { PGBossModuleOptions } from "./interfaces/pg-boss-options.interface";
import { Job } from "./job.service";
import {
  ASYNC_OPTIONS_TYPE,
  ConfigurableModuleClass,
  MODULE_OPTIONS_TOKEN,
  OPTIONS_TYPE,
} from "./pg-boss.module-definition";

@Global()
@Module({
  providers: [MetadataScanner, HandlerScannerService],
})
export class PGBossModule
  extends ConfigurableModuleClass
  implements OnModuleInit, OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(this.constructor.name);
  private instance: PGBoss;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly handlerScannerService: HandlerScannerService,
  ) {
    super();
  }

  static forRoot(options: typeof OPTIONS_TYPE): DynamicModule {
    const instanceProvider = {
      provide: PGBoss,
      useFactory: async () => await this.createInstanceFactory(options),
    };

    const dynamicModule = super.forRoot(options);
    if (!dynamicModule.providers) {
      dynamicModule.providers = [];
    }
    dynamicModule.providers.push(instanceProvider);
    dynamicModule.exports ||= [];
    dynamicModule.exports.push(instanceProvider);

    return dynamicModule;
  }

  static forRootAsync(options: ASYNC_OPTIONS_TYPE): DynamicModule {
    const instanceProvider = {
      provide: PGBoss,
      useFactory: async (pgBossModuleOptions: PGBossModuleOptions) => {
        if (options.application_name) {
          return await this.createInstanceFactory({
            ...pgBossModuleOptions,
            application_name: options.application_name,
          });
        }
        return await this.createInstanceFactory(pgBossModuleOptions);
      },
      inject: [MODULE_OPTIONS_TOKEN],
    };

    const dynamicModule = super.forRootAsync(options);
    if (!dynamicModule.providers) {
      dynamicModule.providers = [];
    }
    dynamicModule.providers.push(instanceProvider);
    if (!dynamicModule.exports) {
      dynamicModule.exports = [];
    }
    dynamicModule.exports.push(instanceProvider);

    return dynamicModule;
  }

  private static async createInstanceFactory(options: PGBossModuleOptions) {
    const pgBoss = await lastValueFrom(
      defer(async () => new PGBoss(options).start()).pipe(
        handleRetry(
          options.retryAttempts,
          options.retryDelay,
          options.toRetry,
        ),
      ),
    );

    return pgBoss;
  }

  static forJobs(jobs: Job[]) {
    return {
      module: PGBossJobModule,
      providers: jobs.map((job) => job.ServiceProvider),
      exports: jobs.map((job) => job.ServiceProvider.provide),
    };
  }

  onModuleInit() {
    this.instance = this.moduleRef.get<PGBoss>(PGBoss);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.setupWorkers();
  }

  async onModuleDestroy(): Promise<void> {
    await this.instance.stop();
  }

  private async setupWorkers() {
    if (!this.instance) {
      throw new Error(
        "setupWorkers must be called after onApplicationBootstrap",
      );
    }

    // Sort job handlers by whether they have a dead letter queue.
    // This is to ensure that the dead letter queues are created before the job queues,
    // however this will not solve the issue if a dead letter queue has a dead letter queue
    // on it, but why would that happen. It's a rhetorical question, of course it will happen,
    // so if you're reading this, don't put a dead letter queue on a dead letter queue,
    // it doesn't make sense.
    const jobHandlers = [...this.handlerScannerService.getJobHandlers()].sort((a, b) => {
      if (a.metadata.createQueueOptions?.deadLetter) {
        return 1;
      }
      if (b.metadata.createQueueOptions?.deadLetter) {
        return -1;
      }
      return 0;
    });

    for (const handler of jobHandlers) {
      await this.instance.createQueue(handler.metadata.jobName, {
        name: handler.metadata.jobName,
        ...handler.metadata.createQueueOptions,
      });
    }

    await Promise.all(
      jobHandlers.map(async (handler) => {
        const isBatch = handler.metadata.workOptions?.batchSize;
        const workerID = await this.instance.work(
          handler.metadata.jobName,
          handler.metadata.workOptions,
          isBatch ? handler.callback : ([job]: PGBoss.Job<unknown>[]) => handler.callback(job),
        );
        this.logger.log(
          "Registered Worker",
          { workerID, jobName: handler.metadata.jobName },
        );
      }),
    );
  }
}
