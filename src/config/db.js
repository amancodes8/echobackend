const mongoose = require('mongoose');

async function connectDB(uri) {
  if (!uri) throw new Error('MONGO_URI not provided');
  return mongoose.connect(uri, { dbName: 'mindecho' });
}

module.exports = { connectDB };
