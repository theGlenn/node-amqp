
## Running tests

    pnpm test

To run the tests, you will need RabbitMQ. You can either install it using your package manager or use [docker][] to run a RabbitMQ instance.
    docker run -d --name amqp.test -p 5672:5672 rabbitmq