/* eslint-disable @typescript-eslint/no-explicit-any */
import AMQP from 'amqplib';
import { AMQPMessage } from './delivery';

export interface ExchangeParams {
  name: string;
  type: 'direct' | 'topic' | 'headers' | 'fanout';
  // Usage description: https://www.squaremobius.net/amqp.node/channel_api.html#channel_assertExchange
  options?: AMQP.Options.AssertExchange;
}

export interface AMQPMessageHandler<T = any> {
  (msg: AMQPMessage<T>): Promise<void> | void;
}

export interface QueueBindings {
  routing: string;
  exchange: ExchangeParams;
}

export interface Queue {
  name: string;
  handler: AMQPMessageHandler;
  bindings: QueueBindings[];

  exclusive?: boolean;
  durable?: boolean;
  autoDelete?: boolean;
  arguments?: unknown;

  requeueDelayMS?: number;
}

export const queueOptions = (q: Queue): AMQP.Options.AssertQueue => {
  return {
    exclusive: q.exclusive,
    durable: q.durable,
    autoDelete: q.autoDelete,
    arguments: q.arguments,
  };
};
