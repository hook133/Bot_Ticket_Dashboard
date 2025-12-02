import 'dotenv/config';
import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import mongoose from 'mongoose';
import { createTicketService } from './src/services/ticketService.js';
import { startWebServer } from './src/web/server.js';

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  error: (...args) => console.error('[ERROR]', ...args)
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.GuildMember, Partials.Channel, Partials.Message]
});

async function bootstrap() {
  const { DISCORD_TOKEN, MONGO_URI } = process.env;
  if (!DISCORD_TOKEN) {
    throw new Error('DISCORD_TOKEN مفقود في ملف .env');
  }
  if (!MONGO_URI) {
    throw new Error('MONGO_URI مفقود في ملف .env');
  }

  await mongoose.connect(MONGO_URI);
  logger.info('متصل بقاعدة بيانات MongoDB');

  const ticketService = createTicketService({ client, logger });

  client.once(Events.ClientReady, async (c) => {
    logger.info(`تم تسجيل الدخول باسم ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isStringSelectMenu() && interaction.customId.startsWith('ticket-panel:')) {
        await ticketService.handleSelectInteraction(interaction);
      } else if (interaction.isButton()) {
        await ticketService.handleTicketButton(interaction);
      }
    } catch (error) {
      logger.error('فشل التعامل مع التفاعل', error);
      const content = 'حدث خطأ أثناء معالجة التفاعل. الرجاء إبلاغ الإدارة.';
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  });

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const baseUrl = process.env.BASE_URL || null;
  await startWebServer({ client, logger, ticketService, port, host, baseUrl });

  await client.login(DISCORD_TOKEN);
}

bootstrap().catch((err) => {
  logger.error('فشل تشغيل البوت', err);
  process.exit(1);
});
