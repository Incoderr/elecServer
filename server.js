const app = require('./app');
const { initSocket } = require('./socket');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

initSocket(server);