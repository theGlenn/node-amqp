/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
import amqp from 'amqplib';
import events from 'events';
import { backOff, IBackOffOptions } from 'exponential-backoff';
import { LoggerInterface } from './Logger';
import makeCancellable, { Cancellable } from './makeCancellable';
import { ExchangeParams, Queue, queueOptions } from './queue';

interface AdditionalParams {
  maxReconnect?: number;
}

const DEFAULT_MAX_RECONNECT = 5;

class Connection extends events.EventEmitter {
  public connection?: amqp.Connection;

  private connecting?: Cancellable<void>;

  constructor(
    private readonly rabbitMQURL: string,
    public logger?: LoggerInterface,
    private readonly p?: AdditionalParams
  ) {
    super();
  }

  private get maxReconnect() {
    return this.p?.maxReconnect || DEFAULT_MAX_RECONNECT;
  }

  private async connect() {
    await this.connection?.close();

    this.connection = await amqp.connect(this.rabbitMQURL);
    this.connection
      ?.on('blocked', reason => this.emit('blocked', { reason }))
      ?.on('unblocked', () => this.emit('unblocked'))
      ?.on('error', (error: Error) => this.emit('error', error))
      ?.on('close', (error: Error) => {
        this.connection = undefined;
        if (error) {
          this.logger?.error({ error }, 'amqp connection close with error');
          this.retryOpen();
        } else {
          this.emit('close');
          this.logger?.info('amqp connection close');
        }
      });
  }

  public async open(p?: { re: boolean }): Promise<this> {
    this.logger?.info(`amqp ${p?.re ? 're' : ''}connecting`);

    this.connecting = makeCancellable(this.connect());
    await this.connecting?.promise;
    this.connecting = undefined;

    this.logger?.debug('amqp.CONN connected');
    return this;
  }

  private get backOffOptions(): Partial<IBackOffOptions> {
    return {
      numOfAttempts: this.maxReconnect,
      retry: (err, attempt) => {
        this.logger?.error({ error: err }, `amqp re-connection failed on attempt ${attempt}`);
        return true;
      },
    };
  }

  private retryOpen() {
    backOff(() => this.open({ re: true }), this.backOffOptions).catch((error: Error) => {
      this.emit('close', error);
    });
  }

  public async close(): Promise<void> {
    const { logger } = this;

    this.connecting?.cancel();
    this.connecting = undefined;

    await this.connection?.close();

    logger?.info(`amqp.CONN ${this.connection ? 're' : ''}closed`);
  }

  private async createQuickChannel(): Promise<amqp.Channel> {
    if (!this.connection) throw new Error('Not connected');

    return this.connection.createChannel();
  }

  public async createChannel(queue?: Queue): Promise<amqp.Channel> {
    const channel = await this.createQuickChannel();
    await channel.prefetch(1);

    return channel
      .on('error', (error: Error) => {
        this.emit('error_channel');
        this.logger?.error({ error, queue }, `amqp.channel error ${error.message}`);
      })
      .on('close', () => {
        this.emit('close_channel');
        this.logger?.info('amqp.channel closed');
      });
  }

  private async declareQueue(queue: Queue, channel: amqp.Channel) {
    for (const b of queue.bindings) {
      await channel.assertQueue(queue.name, queueOptions(queue));
      await channel.bindQueue(queue.name, b.exchange.name, b.routing);
    }
  }

  public async declareQueues(queues: Queue[], channel?: amqp.Channel): Promise<void> {
    const c = channel || (await this.createQuickChannel());
    for (const q of queues) {
      await this.declareQueue(q, c);
    }

    if (!channel) await c.close();
  }

  private async declareExchange(exchange: ExchangeParams, channel: amqp.Channel) {
    await channel.assertExchange(exchange.name, exchange.type, exchange.options);
  }

  public async declareExchanges(
    exchanges: ExchangeParams[],
    channel?: amqp.Channel
  ): Promise<void> {
    const c = channel || (await this.createQuickChannel());

    for (const e of exchanges) {
      await this.declareExchange(e, c);
    }

    if (!channel) await c.close();
  }

  public async checkExchange(exchange: ExchangeParams, channel?: amqp.Channel): Promise<void> {
    const c = channel || (await this.createQuickChannel());

    await c.checkExchange(exchange.name);

    if (!channel) await c.close();
  }
}

export default Connection;
export { Connection };
