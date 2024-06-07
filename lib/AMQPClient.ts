import { EventEmitter } from 'events';
import { Connection } from './connections';
import { LoggerInterface } from './Logger';
import { ExchangeParams } from './queue';
import AMQPConsumer from './consumer';
import AMQPPublisher from './publisher';
import Metrics from './Metrics';

export interface AMQPClientArgs {
  url: string;
  consumer?: AMQPConsumer;
  publisher?: AMQPPublisher;
  logger?: LoggerInterface;
  metrics?: Metrics;
  exchanges: ExchangeParams[];
  doNotExitProcessOnMaxRetry?: boolean;
}

export default class AMQPClient extends EventEmitter {
  private readonly publishConnection?: Connection;

  private readonly consumeConnection?: Connection;

  public readonly consumer?: AMQPConsumer;

  public readonly publisher?: AMQPPublisher;

  private plogger?: LoggerInterface;

  private pMetrics?: Metrics;

  constructor(public readonly args: AMQPClientArgs) {
    super();
    if (!args.exchanges) throw new Error('Mising "exchanges" arg');
    if (args.exchanges.length === 0) throw new Error('Empty "exchanges" array');

    if (args.publisher) {
      this.publishConnection = this.makeConnection(args);
      this.publisher = args.publisher;
    }

    if (args.consumer) {
      this.consumeConnection = this.makeConnection(args);
      this.consumer = args.consumer;
    }

    this.logger = args.logger;
    this.metrics = args.metrics;
  }

  // eslint-disable-next-line class-methods-use-this
  private makeConnection(args: AMQPClientArgs): Connection {
    return new Connection(args.url, args.logger).on('close', () => {
      this.emit('close');

      if (!args.doNotExitProcessOnMaxRetry) {
        args.logger?.fatal('connection closed unexpectedly exiting process');
        process.exit(1);
      }
    });
  }

  public get logger(): LoggerInterface | undefined {
    return this.plogger;
  }

  public set logger(value: LoggerInterface | undefined) {
    this.plogger = value;

    if (this.consumer) this.consumer.logger = value;
    if (this.consumeConnection) this.consumeConnection.logger = value;

    if (this.publisher) this.publisher.logger = value;
    if (this.publishConnection) this.publishConnection.logger = value;
  }

  public get metrics(): Metrics | undefined {
    return this.pMetrics;
  }

  public set metrics(value: Metrics | undefined) {
    this.pMetrics = value;

    if (this.consumer && !this.consumer.metrics) this.consumer.metrics = value;
    if (this.publisher && !this.publisher.metrics) this.publisher.metrics = value;
  }

  public async run(): Promise<void> {
    const connection = this.publishConnection || this.consumeConnection;

    if (!connection) throw new Error('No "connection" available');

    await this.publishConnection?.open();
    await this.consumeConnection?.open();

    await connection.declareExchanges(this.args.exchanges);

    if (this.publishConnection) {
      await this.publisher?.bindAsyncOn(this.publishConnection);
    }

    if (this.consumeConnection) {
      await this.consumer?.bindOn(this.consumeConnection).start();
    }
  }

  public async stop(): Promise<void> {
    await this.publishConnection?.close();
    await this.consumeConnection?.close();
  }
}
