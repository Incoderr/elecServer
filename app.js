const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: ['http://localhost:5173', 'https://elec-app.vercel.app'],
  methods: ['GET', 'POST']
}));

app.get('/', (req, res) => {
  res.send('Chat server is running');
});

module.exports = app;