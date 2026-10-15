import { DiscordSDK } from '@discord/embedded-app-sdk';

export let discordSdk = null;
export let discordAuth = null;
export let discordAccessToken = null;
export let discordPlayer = null;

export async function setupDiscord() {
  // Allow the game to work normally outside Discord.
  if (window.self === window.top) {
    console.log(
      '🌐 Browser mode - Discord authentication skipped'
    );

    return null;
  }

  try {
    const clientId =
      import.meta.env.VITE_DISCORD_CLIENT_ID;

    discordSdk = new DiscordSDK(clientId);

    await discordSdk.ready();

    console.log('✅ Discord SDK ready');

    // Ask Discord for permission to identify the player.
    const { code } =
      await discordSdk.commands.authorize({
        client_id: clientId,
        response_type: 'code',
        state: '',
        prompt: 'none',
        scope: ['identify'],
      });

    // Exchange the temporary Discord code for an access token.
    const response = await fetch('/api/token', {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json',
      },

      body: JSON.stringify({
        code,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Token request failed: ${response.status}`
      );
    }

    const { access_token } =
      await response.json();

    discordAccessToken = access_token;

    // Authenticate this Activity session.
    discordAuth =
      await discordSdk.commands.authenticate({
        access_token,
      });

    if (!discordAuth) {
      throw new Error(
        'Discord authentication failed'
      );
    }

    // Register the Discord player with our backend.
    const playerResponse =
      await fetch('/api/player', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          accessToken: access_token,
          guildId: discordSdk.guildId,
        }),
      });

    if (!playerResponse.ok) {
      console.error(
        'Failed to register Discord player'
      );
    } else {
      const player =
        await playerResponse.json();

        discordPlayer = player;

      console.log(
        '✅ Player saved:',
        player
      );

      window.dispatchEvent(
  new CustomEvent('discord-player-loaded', {
    detail: player,
  })
);
    }

    console.log(
      '🎮 Discord user authenticated!'
    );

    console.log(
      'Username:',
      discordAuth.user.username
    );

    console.log(
      'User ID:',
      discordAuth.user.id
    );

    console.log(
      'Guild ID:',
      discordSdk.guildId
    );

    console.log(
      'Channel ID:',
      discordSdk.channelId
    );

    window.dispatchEvent(
      new CustomEvent(
        'discord-authenticated',
        {
          detail: discordAuth,
        }
      )
    );

    return discordAuth;

  } catch (error) {
    console.error(
      '❌ Discord authentication error:',
      error
    );

    return null;
  }
}