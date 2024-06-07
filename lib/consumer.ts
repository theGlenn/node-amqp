/* eslint-disable @typescript-eslint/restrict-template-expressions */
import * as uuid from 'uuid';
import { Queue, queueOptions } from './queue';
import { Connection } from './connections';
import StatsdLike from './Metrics';
import { LoggerInterface } from './Logger';
import { makeMessage } from './delivery';

export interface NewConsumerArgs {
  prefetch: number;
  queues: Queue[];
  tag?: string;
  logger?: LoggerInterface;
  metrics?: StatsdLike;
  erroHandler?: (err: Error | unknown) => void;
}

const toMS = (t: number) => Math.floor(t * 1000);
const toSeconds = (t: number) => Math.floor(t / 1000);
const toMSIfNecessary = (t: number) => (t > toSeconds(Date.now()) ? t : toMS(t));

export default class AMQPConsumer {
  private readonly tag: string;

  private connection?: Connection;

  public readonly queues: Queue[];

  private readonly erroHandler?: NewConsumerArgs['erroHandler'];

  public logger?: NewConsumerArgs['logger'];

  public metrics?: NewConsumerArgs['metrics'];

  constructor(args: NewConsumerArgs) {
    this.tag = args.tag || uuid.v4();

    this.logger = args.logger;
    this.metrics = args.metrics;
    this.queues = args.queues;

    this.erroHandler = args.erroHandler;
  }

  public bindOn(connection: Connection): this {
    this.connection = connection;
    return this;
  }

  public async start(): Promise<void> {
    if (!this.connection) throw new Error('bindOn not called');

    await this.connection.declareQueues(this.queues);
    const consumes = this.queues.map(q => this.consume(q));
    await Promise.all(consumes);
  }

  public async consume(q: Queue): Promise<void> {
    if (!this.connection) throw new Error('bindOn not called');

    const channel = await this.connection.createChannel(q);
    if (!channel) throw new Error('Error creating channel');

    const { queue } = await channel.assertQueue(q.name, queueOptions(q));

    const { metrics, logger: log } = this;

    log?.debug(`amqp.consume.on | queue: ${queue}`);

    const options = { consumerTag: this.tag };

    channel.on('error', e => {
      if (this.erroHandler) this.erroHandler(e);
    });

    await channel.consume(
      queue,
      message => {
        const deliveryTime = Date.now();
        if (message == null) {
          log?.error(`amqp.empty | queue: ${queue}`);
          return;
        }

        const payload = message.content.toString();

        const metricsTags = {
          queue: queue,
          exchange: message.fields.exchange,
          'routing-key': message.fields.routingKey,
        };

        const logFields = {
          rabbitmq: {
            ...metricsTags,
            payload: payload,
            'message-id': message.properties.messageId,
            'published-at': message.properties.timestamp,
          },
        };

        let publishTime = Number(message.properties.timestamp);
        if (publishTime && publishTime > 0) {
          publishTime = toMSIfNecessary(publishTime);
          const lagMS = deliveryTime - publishTime;

          metrics?.timing('rabbitmq.consumers.consume.lag', lagMS, metricsTags);
          log?.debug(
            {
              'rabbitmq-debug': {
                ...logFields,
                publishTime,
                lagMS,
              },
            },
            `amqp.consumers.consume.lag: ${lagMS}ms | queue: ${queue}`
          );
        }

        const reportMetrics = (
          acknowledgment: 'ack' | 'nack',
          requeue?: boolean,
          error?: Error
        ) => {
          const duration = Date.now() - deliveryTime;

          metrics?.timing('rabbitmq.consumers.consume.duration', duration, metricsTags);

          const fields = {
            ...logFields,
            error: error,
            'rabbitmq-result': {
              duration,
              acknowledgment,
            },
          };

          // eslint-disable-next-line default-case
          switch (acknowledgment) {
            case 'ack':
              if (error) log?.warn(fields, `processing completed with warning | queue: ${queue}`);
              else log?.info(fields, `processing completed | queue: ${queue}`);
              break;
            case 'nack':
              if (requeue) log?.error(fields, `processing failed with requeue | queue: ${queue}`);
              else log?.error(fields, `processing failed | queue: ${queue}`);
              break;
          }
        };

        const { requeueDelayMS = 50 } = q;
        const handlerMessage = makeMessage(channel, message, requeueDelayMS, reportMetrics);
        Promise.resolve()
          .then(() => q.handler(handlerMessage))
          .catch(e => handlerMessage.nack(e));
      },
      options
    );
  }
}
