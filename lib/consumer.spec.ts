import * as uuid from 'uuid';
import Metrics from './Metrics';
import { Connection } from './connections';
import AMQPConsumer from './consumer';
import { LoggerInterface } from './Logger';
import { AMQPMessageHandler, ExchangeParams, Queue, QueueBindings } from './queue';
import './jest.utils';
import { makeMockLogger } from './__mocks__/logger';

describe('Test consummer', () => {
  const rabbitURL = 'amqp://localhost:5672';
  const connection: Connection = new Connection(rabbitURL);

  const mockLogger: LoggerInterface = makeMockLogger();

  const mockMetrics: Metrics = {
    increment: jest.fn(),
    timing: jest.fn(),
  };

  const buildMockExchange = (): ExchangeParams => {
    const suffix = uuid.v4();
    return {
      name: `test_exchange_${suffix}`,
      type: 'topic',
    };
  };

  const buildMockQueue = (handler: AMQPMessageHandler, bindings?: QueueBindings[]) => {
    const suffix = uuid.v4();
    const queueName = `test_queue_${suffix}`;

    return <Queue>{
      name: queueName,
      routing: 'testing',
      handler: handler,
      bindings: bindings || [],
      durable: false,
      autoDelete: true,
    };
  };

  const buildContext = async (exchanges: ExchangeParams[], queue: Queue) => {
    const pubChannel = await connection.createChannel();
    const publish = (payload: string, bindings: QueueBindings, t?: number): boolean => {
      const { exchange, routing } = bindings;

      const buffer = Buffer.from(payload);
      return pubChannel.publish(exchange.name, routing, buffer, {
        messageId: uuid.v4(),
        timestamp: t,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    // If an error is thrown into the channel it means a check failed and the test should also fail.
    const consChannel = await connection.createChannel(queue);
    consChannel.on('error', err => {
      pubChannel.close().catch(e => expect(e).toBeNull());
      consChannel.close().catch(e => expect(e).toBeNull());
      expect(err).toBeNull();
    });

    return {
      publish: publish,
      start: async () => {
        await connection.declareExchanges(exchanges, consChannel);
      },
      finish: async () => {
        await pubChannel.close();
        await consChannel.close();
      },
    };
  };

  beforeAll(() => connection.open());
  afterAll(() => connection.close());

  it('should create consumer and consume', async () => {
    const testState = {
      msgCount: 0,
      failures: 0,
      payloads: <unknown[]>[],
    };

    const handler: AMQPMessageHandler<{ key: string }> = m => {
      const { body } = m;

      testState.msgCount += body.key === 'ok' ? 1 : 0;
      testState.failures += body.key === 'no' ? 1 : 0;
      testState.payloads.push(body);

      if (body.key === 'ok') m.ack();
      else m.nack(new Error('Wrong body'), false);
    };

    const exchanges = [buildMockExchange()];
    const mockQueue = buildMockQueue(handler, [
      {
        routing: 'testing',
        exchange: exchanges[0],
      },
    ]);

    const ctx = await buildContext(exchanges, mockQueue);

    await ctx.start();

    const consummer = new AMQPConsumer({
      prefetch: 10,
      logger: mockLogger,
      metrics: mockMetrics,
      queues: [mockQueue],
      erroHandler: err => {
        ctx.finish().catch(e => expect(e).toBeNull());
        expect(err).toBeNull();
      },
    }).bindOn(connection);

    await consummer.start();

    const payloads = {
      ok: '{"key": "ok"}',
      no: '{"key": "no"}',
    };

    const times = [
      3000, // -3s
      2000, // -2s
      500, // -500ms
    ].map(ms => ({ ms: ms, time: Date.now() - ms }));

    const t0Seconds = Math.floor(times[0].time / 1e3);
    expect(ctx.publish(payloads.ok, mockQueue.bindings[0], t0Seconds)).toBe(true);
    expect(ctx.publish(payloads.ok, mockQueue.bindings[0], times[1].time)).toBe(true);
    expect(ctx.publish(payloads.ok, mockQueue.bindings[0], times[2].time)).toBe(true);
    expect(ctx.publish(payloads.no, mockQueue.bindings[0])).toBe(true);

    await new Promise(r => setTimeout(r, 100));

    expect(testState.msgCount).toEqual(3);
    expect(testState.failures).toEqual(1);
    expect(testState.payloads).toEqual([
      JSON.parse(payloads.ok),
      JSON.parse(payloads.ok),
      JSON.parse(payloads.ok),
      JSON.parse(payloads.no),
    ]);

    const { exchange } = mockQueue.bindings[0];

    const metricsTags = {
      exchange: exchange.name,
      queue: mockQueue.name,
      'routing-key': 'testing',
    };

    expect(mockMetrics.timing).toBeCalledTimes(7);

    times.forEach((t, index) => {
      if (index % 2 !== 0) return;
      expect(mockMetrics.timing).nthCalledWith(
        index + 1,
        'rabbitmq.consumers.consume.lag',
        expect.greaterThanOrEqual(t.ms),
        metricsTags
      );

      expect(mockMetrics.timing).nthCalledWith(
        index + 2,
        'rabbitmq.consumers.consume.duration',
        expect.greaterThanOrEqual(0),
        metricsTags
      );
    });

    await ctx.finish();
  });

  it('should create consumer and fail', async () => {
    const payload = '{"key": "this will fail anyway!"}';
    const error = new Error('Arf');
    const state: { body: string | null } = { body: null };

    const handler: AMQPMessageHandler<string | null> = m => {
      state.body = m.body;
      throw error;
    };

    const exchanges = [buildMockExchange()];
    const mockQueue = buildMockQueue(handler, [
      {
        routing: 'testing',
        exchange: exchanges[0],
      },
    ]);

    const ctx = await buildContext(exchanges, mockQueue);
    await ctx.start();

    const consummer = new AMQPConsumer({
      prefetch: 10,
      logger: mockLogger,
      metrics: mockMetrics,
      queues: [mockQueue],
      erroHandler: err => {
        ctx.finish().catch(e => expect(e).toBeNull());
        expect(err).toBeNull();
      },
    });

    await consummer.bindOn(connection).start();

    expect(ctx.publish(payload, mockQueue.bindings[0])).toBe(true);

    await new Promise(r => setTimeout(r, 100));

    expect(mockLogger.error).toBeCalledWith(
      {
        error: error,
        rabbitmq: {
          payload: payload,
          queue: mockQueue.name,
          exchange: mockQueue.bindings[0].exchange.name,
          'routing-key': mockQueue.bindings[0].routing,
          'message-id': expect.any(String),
          'published-at': undefined,
        },
        'rabbitmq-result': {
          acknowledgment: 'nack',
          duration: expect.any(Number),
        },
      },
      `processing failed | queue: ${mockQueue.name}`
    );

    await ctx.finish();
  });
});
