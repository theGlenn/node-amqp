/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as uuid from 'uuid';
import AMQP from 'amqplib';
import { assert } from 'console';
import AMQPPublisher from './publisher';
import { ExchangeParams, Queue } from './queue';
import { Connection } from './connections';

describe('Test publisher', () => {
  const rabbitURL = 'amqp://localhost:5672';
  const c: Connection = new Connection(rabbitURL);

  beforeAll(() => c.open());
  afterAll(() => c.close());

  it('should create exchange and publish', async () => {
    // If an error is thrown into the channel it means a check failed and the test should also fail.
    c.on('error', err => {
      c.close().catch(e => expect(e).toBeNull());
      expect(err).toBeNull();
    });

    const suffix = uuid.v4();

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

    const p = await new AMQPPublisher('test', [exch]).bindAsyncOn(c);

    const ch = await c.createChannel(queue);
    await c.checkExchange(exch, ch);
    await c.declareQueues([queue], ch);

    const payload = '{"ping": "pong"}';
    expect(p.publish(exch.name, 'testing', Buffer.from(payload))).toBeUndefined();
    expect(p.publish(exch.name, 'testing', Buffer.from(payload))).toBeUndefined();

    const state = { msgCount: 0, msg: <AMQP.ConsumeMessage | null>null };
    await ch.consume(queue.name, (msg: AMQP.ConsumeMessage | null) => {
      assert(msg != null);
      state.msg = msg;
      state.msgCount += 1;
      ch.ack(msg!);
    });

    await new Promise(r => setTimeout(r, 200));

    expect(state.msgCount).toBe(2);
    expect(state.msg).not.toBeNull();
    expect(state.msg?.content.toString()).toBe(payload);
    expect(state.msg).toMatchObject({
      fields: {
        redelivered: false,
        exchange: exch.name,
        routingKey: 'testing',
      },
      properties: {
        contentType: 'application/json',
        headers: {
          'sent-at': expect.any(Number),
          from: 'test',
        },
        messageId: expect.any(String),
        timestamp: expect.any(Number),
        appId: 'test',
      },
    });
  });
});
