import { INestApplication, Injectable } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { Job } from "pg-boss";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { JobService, PGBossModule, createJob } from "../src";

interface FoobarJobData {
  foo: string;
  bar: boolean;
}

const FoobarJob = createJob<FoobarJobData>("foobar");

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

@Injectable()
class FoobarService {
  constructor(
    @FoobarJob.Inject()
    private readonly foobarJobService: JobService<FoobarJobData>,
  ) {}

  public readonly datastore: FoobarJobData[] = [];

  async sendJob() {
    await this.foobarJobService.send({ foo: "oof", bar: true }, {});
  }

  @FoobarJob.Handle()
  async handleJob(job: Job<FoobarJobData>) {
    this.datastore.push(job.data);
  }
}

describe("PGBossModule (e2e)", () => {
  let postgres: StartedPostgreSqlContainer;
  let app: INestApplication;

  let foobarService: FoobarService;

  beforeAll(async () => {
    postgres = await new PostgreSqlContainer().start();
  });

  afterAll(async () => {
    await postgres.stop();
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PGBossModule.forRoot({
          host: postgres.getHost(),
          port: postgres.getPort(),
          database: postgres.getDatabase(),
          user: postgres.getUsername(),
          password: postgres.getPassword(),

          retryLimit: 10,
          retryDelay: 1,
          retryBackoff: false,
        }),
        PGBossModule.forJobs([FoobarJob]),
      ],
      providers: [FoobarService],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    foobarService = app.get<FoobarService>(FoobarService);
  });

  afterEach(async () => {
    await app.close();
  });

  it("handles a Job", async () => {
    await foobarService.sendJob();
    // Wait for processing
    let lastError: Error | null = null;

    for (let retry = 0; retry < 10; retry++) {
      try {
        expect(foobarService.datastore).toHaveLength(1);
        lastError = null;
        break;
      } catch (err) {
        lastError = err;
        await sleep(1_000);
      }
    }

    expect(foobarService.datastore[0]).toEqual({ foo: "oof", bar: true });
    expect(lastError).toBeNull();
  });
});
