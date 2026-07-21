const mongoose = require('mongoose');
const { env } = require('./env');
const models = require('../models');

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongodbUri, {
    autoIndex: env.nodeEnv !== 'production',
    serverSelectionTimeoutMS: 10_000
  });
  if (env.createIndexes) {
    await Promise.all(Object.values(models).map((model) => model.createIndexes()));
  }
  return mongoose.connection;
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState) await mongoose.disconnect();
}

module.exports = { connectDatabase, disconnectDatabase };
