const express = require('express');
const dotenv = require('dotenv');
const { Redis } = require('@upstash/redis');

const fs = require('fs');
const path = require('path');
const os = require('os');

const fontDirectory = path.join(__dirname, 'fonts');

const fontConfigPath = path.join(
  os.tmpdir(),
  'chengyu-fonts.conf'
);

fs.writeFileSync(
  fontConfigPath,
  `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontDirectory}</dir>
  <cachedir>/tmp/chengyu-font-cache</cachedir>
</fontconfig>`
);

process.env.FONTCONFIG_FILE = fontConfigPath;

const sharp = require('sharp');

const {
  InteractionType,
  InteractionResponseType,
  verifyKeyMiddleware,
} = require('discord-interactions');

dotenv.config({ path: '.env.local' });

const redis = Redis.fromEnv();
const PLAYERS_KEY = 'chengyu:players';

const app = express();
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'chengyu-backend',
  });
});
const PORT = 3001;

async function loadPlayers() {
  try {
    const players =
      await redis.get(PLAYERS_KEY);

    if (
      !players ||
      typeof players !== 'object'
    ) {
      return {};
    }

    return players;
  } catch (error) {
    console.error(
      '❌ Failed to load players from Redis:',
      error
    );

    return {};
  }
}

async function savePlayers(players) {
  try {
    await redis.set(
      PLAYERS_KEY,
      players
    );
  } catch (error) {
    console.error(
      '❌ Failed to save players to Redis:',
      error
    );

    throw error;
  }
}

function findDiscordGameMessageId(
  players,
  guildId,
  channelId,
  gameId
) {
  for (const player of Object.values(players)) {
    if (player.guildId !== guildId) continue;

    const gameResult = player.results?.[gameId];

    if (
      gameResult?.discordMessageId &&
      gameResult?.discordChannelId === channelId
    ) {
      return gameResult.discordMessageId;
    }
  }

  return null;
}

function escapeXml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getCellColor(cell) {
  if (cell === '🟩') return '#6aaa64';
  if (cell === '🟨' || cell === '🟧') return '#c9b458';
  if (cell === '⬜') return '#3a3a3c';
  if (cell === '⬛') return '#3a3a3c';

  return '#3a3a3c';
}

function getScoreText(gameResult) {
  return gameResult.result === 'won'
    ? `${gameResult.attempts}/6`
    : 'X/6';
}

async function fetchImageAsDataUri(url) {
  if (!url) return null;

  try {
    const response = await fetch(url);

    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const contentType =
      response.headers.get('content-type') || 'image/png';

    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('Failed to fetch image:', error);
    return null;
  }
}

function renderBoardSvg(boardStates = []) {
  const cellSize = 30;
  const gap = 5;
  const rows = 6;
  const cols = 4;

  let svg = '';

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * (cellSize + gap);
      const y = r * (cellSize + gap);

      const cell = boardStates?.[r]?.[c] || null;

      const fill = cell
        ? getCellColor(cell)
        : '#17181a';

      const stroke = cell
        ? fill
        : '#3f4145';

      svg += `
        <rect
          x="${x}"
          y="${y}"
          width="${cellSize}"
          height="${cellSize}"
          rx="2"
          fill="${fill}"
          stroke="${stroke}"
          stroke-width="2"
        />
      `;
    }
  }

  return svg;
}

async function generateChengyuResultCard({
  gameId,
  players,
}) {
  const visiblePlayers = players.slice(0, 4);

  const cardWidth = 900;
  const cardHeight = visiblePlayers.length <= 2 ? 460 : 760;

  const slotPositions =
    visiblePlayers.length <= 2
      ? [
          { x: 170, y: 120 },
          { x: 470, y: 120 },
        ]
      : [
          { x: 140, y: 120 },
          { x: 500, y: 120 },
          { x: 140, y: 420 },
          { x: 500, y: 420 },
        ];

  const preparedPlayers = await Promise.all(
    visiblePlayers.map(async (player) => {
      const avatarUrl = player.avatar
        ? `https://cdn.discordapp.com/avatars/${player.userId}/${player.avatar}.png?size=128`
        : null;

      const avatarDataUri = await fetchImageAsDataUri(avatarUrl);

      return {
        ...player,
        avatarDataUri,
      };
    })
  );

  const playerCardsSvg = preparedPlayers
    .map((player, index) => {
      const pos = slotPositions[index];
      const x = pos.x;
      const y = pos.y;

      const score = getScoreText(player.gameResult);

      const avatarCx = x + 70;
      const avatarCy = y + 36;

      const boardX = x + 18;
      const boardY = y + 95;

      const avatarPart = player.avatarDataUri
        ? `
          <clipPath id="avatarClip${index}">
            <circle cx="${avatarCx}" cy="${avatarCy}" r="32" />
          </clipPath>
          <image
            href="${player.avatarDataUri}"
            x="${avatarCx - 32}"
            y="${avatarCy - 32}"
            width="64"
            height="64"
            clip-path="url(#avatarClip${index})"
            preserveAspectRatio="xMidYMid slice"
          />
        `
        : `
          <circle
            cx="${avatarCx}"
            cy="${avatarCy}"
            r="32"
            fill="#5865F2"
          />
          <text
            x="${avatarCx}"
            y="${avatarCy + 10}"
            text-anchor="middle"
            font-size="24"
            font-weight="700"
            fill="#ffffff"
          >
            ${escapeXml(
              (player.displayName || player.username || '?')
                .charAt(0)
                .toUpperCase()
            )}
          </text>
        `;

      return `
        <rect
          x="${x}"
          y="${y}"
          width="170"
          height="250"
          rx="24"
          fill="#111214"
          stroke="#2f3336"
          stroke-width="2"
        />

        ${avatarPart}

        <text
          x="${x + 85}"
          y="${y + 82}"
          text-anchor="middle"
          font-size="16"
          font-weight="700"
          fill="#ffffff"
        >
          ${escapeXml(player.displayName || player.username)}
        </text>

        <g transform="translate(${boardX}, ${boardY})">
          ${renderBoardSvg(player.gameResult.boardStates || [])}
        </g>

        <text
          x="${x + 85}"
          y="${y + 220}"
          text-anchor="middle"
          font-size="22"
          font-weight="700"
          fill="#ffffff"
        >
          ${escapeXml(score)}
        </text>
      `;
    })
    .join('\n');

  const svg = `
    <svg width="${cardWidth}" height="${cardHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#111214" rx="28" />

      <text
        x="${cardWidth / 2}"
        y="60"
        text-anchor="middle"
        font-size="30"
        font-weight="700"
        fill="#ffffff"
      >
        Chengyu No. ${escapeXml(gameId)}
      </text>

      <text
        x="${cardWidth / 2}"
        y="95"
        text-anchor="middle"
        font-size="18"
        fill="#b5bac1"
      >
        ${preparedPlayers.length} player${preparedPlayers.length > 1 ? 's' : ''} completed this Chengyu
      </text>

      ${playerCardsSvg}
    </svg>
  `;

  return sharp(Buffer.from(svg))
    .png()
    .toBuffer();
}

async function upsertDiscordGameMessage({
  players,
  guildId,
  channelId,
  gameId,
}) {
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('Missing DISCORD_BOT_TOKEN');
    return null;
  }

  if (!channelId) {
    console.error('Missing Discord channel ID');
    return null;
  }

  try {
    const gamePlayers = Object.values(players)
      .filter((player) => {
        return (
          player.guildId === guildId &&
          player.results?.[gameId]
        );
      })
      .sort((a, b) => {
        const aTime =
          a.results?.[gameId]?.completedAt || '';

        const bTime =
          b.results?.[gameId]?.completedAt || '';

        return (
          new Date(aTime) -
          new Date(bTime)
        );
      });

    if (gamePlayers.length === 0) {
      return null;
    }

    const cardPlayers = gamePlayers.slice(0, 2).map((player) => ({
  userId: player.userId,
  username: player.username,
  displayName: player.displayName || player.username,
  avatar: player.avatar || null,
  gameResult: player.results[gameId],
}));

const cardBuffer =
  await generateChengyuResultCard({
    gameId,
    players: cardPlayers,
  });

    const existingMessageId =
      findDiscordGameMessageId(
        players,
        guildId,
        channelId,
        gameId
      );

    const method =
      existingMessageId
        ? 'PATCH'
        : 'POST';

    const url =
  `https://discord.com/api/v10/channels/${channelId}/messages`;

    const form = new FormData();

form.append(
  'payload_json',
  JSON.stringify({
    embeds: [
      {
        image: {
          url: 'attachment://chengyu-card.png',
        },
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            label: 'Play now!',
            custom_id: `play_chengyu_${gameId}`,
          },
        ],
      },
    ],
  })
);

form.append(
  'files[0]',
  new Blob([cardBuffer], { type: 'image/png' }),
  'chengyu-card.png'
);

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
  },
  body: form,
});

    const data = await response.json();

    if (!response.ok) {
      console.error(
        '❌ Discord game message failed:',
        response.status,
        data
      );

      return null;
    }

    const messageId = data.id;

    // Remove the previous scoreboard message after
// successfully posting the new updated one.
if (
  existingMessageId &&
  existingMessageId !== messageId
) {
  const deleteUrl =
    `https://discord.com/api/v10/channels/${channelId}/messages/${existingMessageId}`;

  const deleteResponse =
    await fetch(deleteUrl, {
      method: 'DELETE',
      headers: {
        Authorization:
          `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
    });

  if (
    !deleteResponse.ok &&
    deleteResponse.status !== 404
  ) {
    console.error(
      '❌ Failed to delete old Discord game message:',
      deleteResponse.status
    );
  } else {
    console.log(
      '🗑️ Old Discord game message removed:',
      existingMessageId
    );
  }
}
    gamePlayers.forEach((player) => {
      const gameResult =
        player.results?.[gameId];

      if (!gameResult) return;

      gameResult.discordMessageId =
        messageId;

      gameResult.discordChannelId =
        channelId;
    });

    console.log(
      existingMessageId
        ? `✅ Discord game message reposted: ${messageId}`
        : `✅ Discord game message posted: ${messageId}`
    );

    return data;
  } catch (error) {
    console.error(
      '❌ Failed to update Discord game message:',
      error
    );

    return null;
  }
}

app.post(
  '/api/interactions',
  verifyKeyMiddleware(process.env.DISCORD_PUBLIC_KEY),
  (req, res) => {
    const interaction = req.body;

    if (
      interaction.type === InteractionType.MESSAGE_COMPONENT &&
      interaction.data?.custom_id?.startsWith('play_chengyu_')
    ) {
      console.log(
        '🎮 Launch Activity button clicked:',
        interaction.data.custom_id
      );

      return res.json({
        type: InteractionResponseType.LAUNCH_ACTIVITY,
      });
    }

    return res.status(400).json({
      error: 'Unknown interaction',
    });
  }
);

app.use(express.json());

app.post(['/api/token', '/token'], async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    const response = await fetch(
      'https://discord.com/api/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.VITE_DISCORD_CLIENT_ID,
          client_secret: process.env.DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('Discord token exchange failed:', data);
      return res.status(response.status).json({
        error: 'Token exchange failed',
      });
    }

    res.json({
      access_token: data.access_token,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: 'Internal server error',
    });
  }
});

app.post(['/api/player', '/player'], async (req, res) => {
  const { accessToken, guildId } = req.body;

  if (!accessToken) {
    return res.status(400).json({
      error: 'Missing access token',
    });
  }

  try {
    // Verify the Discord account ourselves.
    const discordResponse = await fetch(
      'https://discord.com/api/users/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!discordResponse.ok) {
      return res.status(401).json({
        error: 'Invalid Discord access token',
      });
    }

    const user = await discordResponse.json();

    const players = await loadPlayers();

    if (!players[user.id]) {
      players[user.id] = {
        userId: user.id,
        username: user.username,
        displayName: user.global_name || user.username,
        avatar: user.avatar || null,
        guildId: guildId || null,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastDailyDate: null,
        results: {},
      };
    } else {
      players[user.id].username = user.username;
      players[user.id].displayName = user.global_name || user.username;
      players[user.id].avatar = user.avatar || null;
      players[user.id].guildId =
        guildId || players[user.id].guildId;
    }

    await savePlayers(players);

    res.json(players[user.id]);
  } catch (error) {
    console.error('Player registration error:', error);

    res.status(500).json({
      error: 'Failed to register player',
    });
  }
});

app.post(['/api/result', '/result'], async (req, res) => {
  const {
    accessToken,
    guildId,
    channelId,
    gameId,
    result,
    attempts,
    isDaily,
    dailyDate,
    board,
    boardStates,
  } = req.body;
  
  console.log('🔍 RESULT RECEIVED:', {
  gameId,
  result,
  hasBoard: Array.isArray(board),
  boardRows: Array.isArray(board)
    ? board.filter((row) => row?.s).length
    : 0,
});

  if (
    !accessToken ||
    !gameId ||
    !['won', 'lost'].includes(result) ||
    (
      isDaily === true &&
      !/^\d{4}-\d{2}-\d{2}$/.test(dailyDate || '')
    )
  ) {
    return res.status(400).json({
      error: 'Invalid result data',
    });
  }

  try {
    // Verify who this Discord user actually is
    const discordResponse = await fetch(
      'https://discord.com/api/users/@me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!discordResponse.ok) {
      return res.status(401).json({
        error: 'Invalid Discord access token',
      });
    }

    const user = await discordResponse.json();
    const players = await loadPlayers();

    // Create player if somehow missing
    if (!players[user.id]) {
      players[user.id] = {
        userId: user.id,
        username: user.username,
        guildId: guildId || null,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastDailyDate: null,
        results: {},
      };
    }

    const player = players[user.id];
    player.username = user.username;
    player.displayName = user.global_name || user.username;
    player.avatar = user.avatar || null;

    // Compatibility in case old player record lacks fields
    player.results ||= {};
    player.gamesPlayed ||= 0;
    player.wins ||= 0;
    player.losses ||= 0;
    player.currentStreak ||= 0;
    player.bestStreak ||= 0;
    player.lastDailyDate ??= null;

   // Prevent the same puzzle from counting twice
if (player.results[gameId]) {
  const existingResult =
    player.results[gameId];

  // Upgrade older daily result data.
  if (isDaily === true && dailyDate) {
    existingResult.isDaily = true;
    existingResult.dailyDate = dailyDate;

    if (!player.lastDailyDate) {
      player.lastDailyDate = dailyDate;
    }
  }

  // Store the board so it can be used
  // for Discord result cards.
  if (Array.isArray(board)) {
  existingResult.board = board;
}

if (Array.isArray(boardStates)) {
  existingResult.boardStates = boardStates;
}

  // If this old result has never been posted
  // to Discord, post it now.
if (channelId) {
  await upsertDiscordGameMessage({
    players,
    guildId,
    channelId,
    gameId,
  });
}

  await savePlayers(players);

  return res.json({
    alreadySaved: true,
    player,
  });
}

  

   player.results[gameId] = {
  result,
  attempts: result === 'won' ? attempts : null,
  completedAt: new Date().toISOString(),
  isDaily: isDaily === true,
  dailyDate: isDaily === true ? dailyDate : null,

  board:
    Array.isArray(board)
      ? board
      : [],

  boardStates:
    Array.isArray(boardStates)
      ? boardStates
      : [],
};

// RANDOM / CHOOSE puzzles are still saved,
// but they do not affect daily stats or streaks.
if (isDaily === true) {
  player.gamesPlayed += 1;

  if (result === 'won') {
    player.wins += 1;

    const previousDate = new Date(
      `${dailyDate}T00:00:00Z`
    );

    previousDate.setUTCDate(
      previousDate.getUTCDate() - 1
    );

    const yesterdayDate = previousDate
      .toISOString()
      .slice(0, 10);

    // Continue streak only if the previous
    // daily puzzle was completed yesterday.
    if (player.lastDailyDate === yesterdayDate) {
      player.currentStreak += 1;
    } else {
      player.currentStreak = 1;
    }

    player.bestStreak = Math.max(
      player.bestStreak,
      player.currentStreak
    );
  } else {
    player.losses += 1;
    player.currentStreak = 0;
  }

  player.lastDailyDate = dailyDate;
}
if (channelId) {
  await upsertDiscordGameMessage({
    players,
    guildId,
    channelId,
    gameId,
  });
}

    await savePlayers(players);

    console.log(
      `Saved ${result} for ${user.username}, game ${gameId}`
    );

    return res.json({
      alreadySaved: false,
      player,
    });
  } catch (error) {
    console.error('Result save error:', error);

    return res.status(500).json({
      error: 'Failed to save result',
    });
  }
});

app.get(['/api/leaderboard', '/leaderboard'], async (req, res) => {
  const { guildId, gameId } = req.query;

  if (!guildId || !gameId) {
    return res.status(400).json({
      error: 'Missing guildId or gameId',
    });
  }

  try {
  const players = await loadPlayers();

  const now = new Date();

  const todayDate = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');

  const yesterday = new Date(
    `${todayDate}T00:00:00Z`
  );

  yesterday.setUTCDate(
    yesterday.getUTCDate() - 1
  );

  const yesterdayDate = yesterday
    .toISOString()
    .slice(0, 10);

  const guildPlayers = Object.values(players).filter(
    (player) => player.guildId === guildId
  );

    // Today's/current puzzle results
    const daily = guildPlayers
      .filter((player) => player.results?.[gameId])
      .map((player) => {
        const result = player.results[gameId];

        return {
          userId: player.userId,
          username: player.username,
          displayName: player.displayName || player.username,
          avatar: player.avatar || null,
          result: result.result,
          attempts: result.attempts,
          completedAt: result.completedAt,
        };
      })
      .sort((a, b) => {
        // Winners above losses
        if (a.result === 'won' && b.result !== 'won') return -1;
        if (a.result !== 'won' && b.result === 'won') return 1;

        // Fewer attempts is better
        if (
          a.result === 'won' &&
          b.result === 'won' &&
          a.attempts !== b.attempts
        ) {
          return a.attempts - b.attempts;
        }

        // Earlier completion wins tie
        return new Date(a.completedAt) - new Date(b.completedAt);
      });

    // Current streak ranking
    const streaks = guildPlayers
      .map((player) => ({
        userId: player.userId,
        username: player.username,
        displayName: player.displayName || player.username,
        avatar: player.avatar || null,
        currentStreak:
  player.lastDailyDate === todayDate ||
  player.lastDailyDate === yesterdayDate
    ? player.currentStreak || 0
    : 0,
        bestStreak: player.bestStreak || 0,
        wins: player.wins || 0,
        gamesPlayed: player.gamesPlayed || 0,
           winRate:
      player.gamesPlayed > 0
        ? Math.round(
            (player.wins / player.gamesPlayed) * 100
          )
        : 0,
  }))
  .sort((a, b) => {
    if (b.currentStreak !== a.currentStreak) {
      return b.currentStreak - a.currentStreak;
    }

    if (b.bestStreak !== a.bestStreak) {
      return b.bestStreak - a.bestStreak;
    }

    return b.winRate - a.winRate;
  });

    return res.json({
      gameId,
      daily,
      streaks,
    });
  } catch (error) {
    console.error('Leaderboard error:', error);

    return res.status(500).json({
      error: 'Failed to load leaderboard',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Discord auth server running on http://localhost:${PORT}`);
});