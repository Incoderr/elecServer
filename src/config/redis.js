const { createClient } = require('redis');

const redisClient = createClient({
  username: 'default',
  password: process.env.REDIS_PASSWORD,
  socket: {
    host: process.env.REDIS_URL,
    port: process.env.REDIS_HOST,
  },
});

redisClient.on('error', (err) => console.log('Redis Client Error', err));

redisClient.connect()
  .then(() => {
    console.log('Redis connected');
    // Тестовые операции, если нужно
    // return client.set('foo', 'bar').then(() => client.get('foo')).then(console.log);
  })
  .catch(err => console.error('Connection error:', err));
module.exports = { redisClient };
