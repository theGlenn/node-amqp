import { Channel, ConsumeMessage } from 'amqplib';

export interface AMQPMessage<V = unknown> {
  ack: () => void;
  nack: (e?: Error, requeue?: boolean) => void;
  body: V;
}

export function makeMessage(
  c: Channel,
  m: ConsumeMessage,
  requeueDelayMS: number,
  reportMetrics: (acknowledgment: 'ack' | 'nack', requeue?: boolean, error?: Error) => void
): AMQPMessage {
  const body = JSON.parse(m.content.toString());
  const ack = () => {
    c.ack(m);
    if (reportMetrics) reportMetrics('ack');
  };

  const nack = (error?: Error, requeue = false) => {
    if (requeue === true) setTimeout(() => c.nack(m, false, true), requeueDelayMS);
    else c.nack(m, false, false);

    if (reportMetrics) reportMetrics('nack', requeue, error);
  };

  return { body, ack, nack };
}
