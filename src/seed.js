require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const { connectDB } = require('./config/db');
const User = require('./models/User');
const Profile = require('./models/Profile');
const Session = require('./models/Session');

async function seed() {
  await connectDB(process.env.MONGO_URI || 'mongodb://localhost:27017/mindecho');

  // wipe for dev
  await User.deleteMany({});
  await Profile.deleteMany({});
  await Session.deleteMany({});

  const passwordHash = await bcrypt.hash('password', 10);
  const user = await User.create({
    name: 'Sarah Connor',
    email: 'sarah@example.com',
    passwordHash,
    consent: { neurofeedback: true, camera: true, audio: true }
  });

  const profile = await Profile.create({
    userId: user._id,
    displayName: 'Sarah',
    bio: 'Just trying to be more mindful. Software engineer by day, amateur musician by night. Looking to find a bit more calm in the chaos.',
    location: 'San Francisco, CA',
    avatarUrl: `https://placehold.co/100x100/A78BFA/FFFFFF?text=SC`,
    tags: ['Mindfulness', 'Tech', 'Anxiety', 'Music'],
    baselineMetrics: { calm: 0.6, anxiety: 0.3, focus: 0.7 }
  });

  await Session.create([
    {
      userId: user._id,
      timestamp: new Date(Date.now() - 86400000 * 1),
      type: 'Breathing Exercise',
      duration: 300,
      startEmotion: 'anxious',
      endEmotion: 'calm',
      summary: 'Felt a significant reduction in stress after 3 minutes.'
    },
    {
      userId: user._id,
      timestamp: new Date(Date.now() - 86400000 * 2),
      type: 'Grounding Exercise',
      duration: 180,
      startEmotion: 'neutral',
      endEmotion: 'neutral',
      summary: 'A quick check-in during the workday.'
    }
  ]);

  console.log('Seeded Sarah user and profile');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
