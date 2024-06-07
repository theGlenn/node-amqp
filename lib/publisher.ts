import AMQP from 'amqplib';

import * as uuid from 'uuid';
import { Connection } from './connections';
import { ExchangeParams } from './queue';

import StatsdLike from './Metrics';
import { LoggerInterface } from './Logger';

export default class AMQPPublisher {
  private channel?: AMQP.Channel;

  public logger?: LoggerInterface;

  public metrics?: StatsdLike;

  public readonly allowedExchanges: { [key: string]: ExchangeParams } = {};

  constructor(private readonly serviceName: string, exchanges: ExchangeParams[]) {
    exchanges.forEach(ex => {
      this.allowedExchanges[ex.name] = ex;
    });
  }

  public async bindAsyncOn(connection: Connection): Promise<this> {
    this.channel = await connection.createChannel();
    const exchanges = Object.values(this.allowedExchanges);
    await connection.declareExchanges(exchanges, this.channel);
    return this;
  }

  public publish = (
    exchange: string,
    routingKey: string,
    payload: Buffer,
    options?: AMQP.Options.Publish
  ): void => {
    if (!this.channel) throw new Error('bindAsyncOn not called');

    const start = Date.now();
    let err;
    try {
      const unixTimestamp = Math.floor(start / 1000);
      this.channel?.publish(exchange, routingKey, payload, {
        contentType: 'application/json',
        ...options,
        persistent: options?.persistent || true,
        appId: this.serviceName,
        messageId: uuid.v4(),
        timestamp: unixTimestamp,
        headers: {
          ...options?.headers,
          from: this.serviceName,
          'sent-at': unixTimestamp,
        },
      });
    } catch (e) {
      if (e instanceof Error) err = e;
    }

    const elapsed = Date.now() - start;
    this.metrics?.timing('rabbitmq.producers.publish.time', elapsed, {
      statsd: 'true',
      'routing-key': routingKey,
      'exchange-name': exchange,
      success: err ? 'false' : 'true',
    });

    if (err) {
      this.logger?.error(
        {
          error: err,
          exchange: exchange,
          'routing-key': routingKey,
          message: payload.toString(),
        },
        'unable to publish message to rabbitMQ. Send failed'
      );
    }
  };

  public close = async (): Promise<void> => {
    await this.channel?.close();
  };
}
