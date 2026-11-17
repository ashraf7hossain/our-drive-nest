import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import Redis from 'ioredis';

export type CachedResult<T> = {
  data: T;
  cache: 'HIT' | 'MISS';
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly logger = new Logger(RedisService.name);
  private lastError: string;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 2000,
      retryStrategy: (times) => Math.min(times * 200, 5000),
    });
    this.client.on('error', (err: Error) => {
      if (this.lastError === err.message) return;
      this.lastError = err.message;
      this.logger.error(`Redis error: ${err.message}`);
    });
  }

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('Connected to Redis');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Redis unavailable: ${message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }

  isReady() {
    return this.client.status === 'ready';
  }

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<CachedResult<T>> {
    const cached = await this.safeGet(key);
    if (cached !== null) {
      try {
        return { data: JSON.parse(cached) as T, cache: 'HIT' };
      } catch {
        this.logger.warn(`Ignoring unreadable cache entry ${key}`);
      }
    }

    const data = await loader();
    await this.safeSet(key, JSON.stringify(data), ttlSeconds);
    return { data, cache: 'MISS' };
  }

  async getJson<T>(key: string): Promise<T | null> {
    this.assertReady();
    const raw = await this.client.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds: number) {
    this.assertReady();
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async acquireLock(key: string, ttlSeconds: number) {
    this.assertReady();
    const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string) {
    await this.del(key);
  }

  async del(...keys: string[]) {
    if (!this.isReady() || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`DEL failed: ${message}`);
    }
  }

  async delByPrefix(prefix: string) {
    if (!this.isReady()) return;
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          `${prefix}*`,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`DEL ${prefix}* failed: ${message}`);
    }
  }

  private assertReady() {
    if (!this.isReady()) {
      throw new ServiceUnavailableException('Redis is unavailable');
    }
  }

  private async safeGet(key: string) {
    if (!this.isReady()) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`GET ${key} failed: ${message}`);
      return null;
    }
  }

  private async safeSet(key: string, value: string, ttlSeconds: number) {
    if (!this.isReady()) return;
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`SET ${key} failed: ${message}`);
    }
  }
}
