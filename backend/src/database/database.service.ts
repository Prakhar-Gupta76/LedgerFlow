import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, PoolClient, QueryResultRow } from "pg";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    const connectionString = config.get<string>("DATABASE_URL");

    if (!connectionString) {
      throw new Error("DATABASE_URL is required to start LedgerFlow API.");
    }

    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl:
        config.get<string>("DATABASE_SSL", "false") === "true"
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }

  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  query<T extends QueryResultRow>(text: string, values?: unknown[]) {
    return this.pool.query<T>(text, values);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
