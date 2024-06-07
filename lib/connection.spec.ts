import { Channel } from 'amqplib';
import * as uuid from 'uuid';

import { Connection } from './connections';
import { ExchangeParams, Queue, QueueBindings } from './queue';
import './jest.utils';
import { makeMockLogger } from './__mocks__/logger';

describe('Test connection', () => {
  const mockLogger =  makeMockLogger();
  describe('open', () => {
    let c: Connection | null | undefined = null;

    afterAll(() => c?.close());

    it('success', async () => {
      const rabbitURL = 'amqp://localhost:5672';
      c = await new Connection(rabbitURL, mockLogger).open();

      expect(c.connection).not.toBeNull();
      expect(mockLogger.info).toHaveBeenNthCalledWith(1, 'amqp connecting');
    });

    it('fail', async () => {
      const rabbitURL = 'amqp://localhost:5673';
      c = new Connection(rabbitURL, mockLogger);

      // connect ECONNREFUSED 127.0.0.1:5673
      await expect(c.open()).rejects.toThrow('');
      expect(c.connection).not.toBeNull();
    });
  });

  describe('events', () => {
    let c: Connection | null | undefined = null;

    afterAll(() => c?.close());

    const makeContext = () => {
      const suffix = uuid.v4();

      const rabbitURL = 'amqp://localhost:5672';
      const exch = <ExchangeParams>{ name: `test_exchange_${suffix}`, type: 'topic' };
      const queue = <Queue>{
        name: `test_queue_${suffix}`,
        durable: false,
        autoDelete: true,
        bindings: [
          {
            exchange: exch,
            routing: 'testing',
          },
        ],
      };

      const publish = (
        pc: Channel,
        payload: string,
        bindings: QueueBindings,
        t?: number
      ): boolean => {
        const { exchange, routing } = bindings;

        const buffer = Buffer.from(payload);
        return pc.publish(exchange.name, routing, buffer, {
          messageId: uuid.v4(),
          timestamp: t,
          headers: {
            'Content-Type': 'application/json',
          },
        });
      };

      const closeEventListener = jest.fn();
      const errorEventListener = jest.fn();

      return {
        exch,
        queue,
        publish,
        closeEventListener,
        errorEventListener,
        rabbitURL,
      };
    };

    it('close', async () => {
      const ctx = makeContext();
      c = await new Connection(ctx.rabbitURL, mockLogger)
        .on('close', ctx.closeEventListener)
        .open();

      const ch = await c.createChannel(ctx.queue);
      await c.declareExchanges([ctx.exch], ch);
      await c.checkExchange(ctx.exch, ch);
      await c.declareQueues([ctx.queue], ch);

      c.connection?.emit('close');

      expect(mockLogger.info).nthCalledWith(1, 'amqp connecting');
      expect(mockLogger.info).nthCalledWith(2, 'amqp connection close');

      // expect(mockLogger.info).nthCalledWith(2, 'amqp.channel closed');

      expect(ctx.closeEventListener).toBeCalledTimes(1);
      expect(ctx.closeEventListener).nthCalledWith(1);
    });

    it('close w/ error', async () => {
      const ctx = makeContext();
      c = await new Connection(ctx.rabbitURL, mockLogger)
        .on('close', ctx.closeEventListener)
        .open();

      const ch = await c.createChannel(ctx.queue);
      await c.declareExchanges([ctx.exch], ch);
      await c.checkExchange(ctx.exch, ch);
      await c.declareQueues([ctx.queue], ch);

      const error = new Error('cluster non-sense error');
      c.connection?.emit('close', error);

      await new Promise(r => setTimeout(r, 1000));

      expect(mockLogger.error).toBeCalledWith({ error }, 'amqp connection close with error');

      expect(mockLogger.info).nthCalledWith(1, 'amqp connecting');
      expect(mockLogger.info).nthCalledWith(2, 'amqp reconnecting');

      expect(mockLogger.info).toBeCalledTimes(2);

      expect(ctx.closeEventListener).not.toBeCalled();
    });

    it('close w/ error resulting in retry', async () => {
      const ctx = makeContext();
      c = await new Connection(ctx.rabbitURL, mockLogger, { maxReconnect: 3 })
        .on('close', ctx.closeEventListener)
        .open();

      const ch = await c.createChannel(ctx.queue);
      await c.declareExchanges([ctx.exch], ch);
      await c.checkExchange(ctx.exch, ch);
      await c.declareQueues([ctx.queue], ch);

      const errors = {
        nonsense: new Error('cluster non-sense error'),
        network: new Error('getaddrinfo ENOTFOUND ok'),
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      (c as any).rabbitMQURL = 'amqp://ok';

      c.connection?.emit('close', errors.nonsense);

      await new Promise(r => setTimeout(r, 1000));

      expect(mockLogger.info).toBeCalledTimes(4);
      expect(mockLogger.error).toBeCalledTimes(4);

      expect(mockLogger.info).nthCalledWith(1, 'amqp connecting');
      expect(mockLogger.error).nthCalledWith(
        1,
        { error: errors.nonsense },
        'amqp connection close with error'
      );

      for (let i = 2; i < 5; i += 1) {
        expect(mockLogger.info).nthCalledWith(i, 'amqp reconnecting');
        expect(mockLogger.error).nthCalledWith(
          i,
          { error: expect.errorLike(errors.network) },
          `amqp re-connection failed on attempt ${i - 1}`
        );
      }

      expect(ctx.closeEventListener).toBeCalledWith(expect.errorLike(errors.network));
    });
  });
});
