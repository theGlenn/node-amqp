import * as uuid from 'uuid';
import { LoggerInterface } from './Logger';
import AMQPClient from './AMQPClient';
import AMQPPublisher from './publisher';
import AMQPConsumer from './consumer';
import { ExchangeParams, Queue, QueueBindings } from './queue';
import Metrics from './Metrics';
import { makeMockLogger } from './__mocks__/logger';

describe('Test AMQPClient', () => {
  const rabbitURL = 'amqp://localhost:5672';
  const mockLogger = makeMockLogger();

  const mockMetrics = <Metrics>{
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

  const buildMockQueue = (bindings?: QueueBindings[]) => {
    const suffix = uuid.v4();
    const queueName = `test_queue_${suffix}`;

    return <Queue>{
      name: queueName,
      routing: 'testing',
      bindings: bindings || [],
      durable: false,
      autoDelete: true,

      handler: async () => {
        // no-op
      },
    };
  };

  it('should run and throw', async () => {
    const exchanges = [buildMockExchange(), buildMockExchange()];
    const client = new AMQPClient({ url: rabbitURL, exchanges: exchanges });
    await expect(client.run()).rejects.toThrow(new Error('No "connection" available'));

    expect(client.consumer).toBeUndefined();
    expect(client.publisher).toBeUndefined();
  });

  it('should run w/ publisher', async () => {
    const exchanges = [buildMockExchange(), buildMockExchange()];
    const mockPublisher = new AMQPPublisher('test', exchanges);
    const client = new AMQPClient({
      url: rabbitURL,
      publisher: mockPublisher,
      logger: mockLogger,
      exchanges: exchanges,
    });
    await client.run();

    expect(client.publisher).not.toBeUndefined();
    expect(client.publisher).toEqual(mockPublisher);
    expect(client.consumer).toBeUndefined();

    expect(mockLogger.info).toBeCalledWith('amqp connecting');
    expect(mockLogger.debug).toBeCalledWith('amqp.CONN connected');
  });

  it('should run w/ consumer', async () => {
    const exchanges = [buildMockExchange(), buildMockExchange()];
    const queues = [
      buildMockQueue([
        {
          routing: 'r_test',
          exchange: exchanges[0],
        },
      ]),
    ];

    const consummer = new AMQPConsumer({
      prefetch: 10,
      queues: queues,
      erroHandler: err => {
        expect(err).toBeNull();
      },
    });

    const client = new AMQPClient({
      url: rabbitURL,
      consumer: consummer,
      logger: mockLogger,
      metrics: mockMetrics,
      exchanges: exchanges,
    });
    await client.run();

    expect(client.publisher).toBeUndefined();
    expect(client.consumer).not.toBeUndefined();
    expect(client.consumer).toEqual(consummer);

    expect(consummer.logger).toEqual(mockLogger);
    expect(consummer.metrics).toEqual(mockMetrics);

    expect(mockLogger.info).toBeCalledWith('amqp connecting');
    expect(mockLogger.debug).toBeCalledWith('amqp.CONN connected');
  });

  it('should set logger', async () => {
    const exchanges = [buildMockExchange(), buildMockExchange()];
    const mockQueue = buildMockQueue([{ routing: 'r_test', exchange: exchanges[0] }]);
    const client = new AMQPClient({
      url: rabbitURL,
      logger: mockLogger,
      exchanges: exchanges,
      metrics: mockMetrics,

      consumer: new AMQPConsumer({
        prefetch: 10,
        erroHandler: err => expect(err).toBeNull(),
        queues: [mockQueue],
      }),
    });

    await client.run();

    expect(client.consumer?.logger).toEqual(mockLogger);

    client.logger = undefined;
    expect(client.consumer?.logger).toBeUndefined();

    client.logger = {
      ...mockLogger,
      info: () => jest.fn(),
    };
    expect(client.consumer?.logger).toEqual(client.logger);
  });
});
