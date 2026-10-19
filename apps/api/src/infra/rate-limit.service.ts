import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from './redis.provider';

/**
 * INCR + EXPIRE as one atomic script: a crash between the two separate
 * commands would leave a counter with no TTL, permanently rate-limiting
 * that key. The TTL==-1 branch also heals any such key left behind by the
 * old implementation.
 */
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) == -1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c`;

@Injectable()
export class RateLimitService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Fixed-window counter. Throws 429 when `limit` is exceeded within `windowSec`.
   */
  async hit(key: string, limit: number, windowSec: number): Promise<void> {
    const k = `rl:${key}`;
    const count = (await this.redis.eval(HIT_SCRIPT, 1, k, windowSec)) as number;
    if (count > limit) {
      throw new HttpException('Too many requests. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
