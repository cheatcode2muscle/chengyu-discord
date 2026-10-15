const fs = require('fs');
const dotenv = require('dotenv');
const { Redis } = require('@upstash/redis');

dotenv.config({
  path: '.env.local',
});

const redis = Redis.fromEnv();

const PLAYERS_KEY = 'chengyu:players';

async function migrate() {
  if (!fs.existsSync('players.json')) {
    console.error(
      '❌ players.json was not found.'
    );
    return;
  }

  const players = JSON.parse(
    fs.readFileSync(
      'players.json',
      'utf8'
    )
  );

  const count =
    Object.keys(players).length;

  console.log(
    `Found ${count} player(s).`
  );

  await redis.set(
    PLAYERS_KEY,
    players
  );

  const savedPlayers =
    await redis.get(PLAYERS_KEY);

  const savedCount =
    Object.keys(
      savedPlayers || {}
    ).length;

  console.log(
    '✅ Redis migration complete.'
  );

  console.log(
    `Players in Redis: ${savedCount}`
  );

  if (savedCount !== count) {
    console.warn(
      '⚠️ Player counts do not match.'
    );
  }
}

migrate().catch((error) => {
  console.error(
    '❌ Migration failed:',
    error
  );

  process.exit(1);
});