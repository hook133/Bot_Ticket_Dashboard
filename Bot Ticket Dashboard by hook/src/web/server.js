import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChannelType } from 'discord.js';
import { TicketPanel } from '../models/ticketPanel.js';
import { StaffStats } from '../models/staffStats.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

export async function startWebServer({ client, logger, ticketService, port, host, baseUrl }) {
  const app = express();
  app.use(
    cors(
      baseUrl
        ? {
            origin: baseUrl,
            credentials: false
          }
        : undefined
    )
  );
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/guilds/:guildId/stats/top', async (req, res) => {
    const guildId = req.params.guildId;
    try {
      const limit = Math.min(parseInt(req.query.limit ?? '10', 10) || 10, 50);
      const docs = await StaffStats.find({ guildId })
        .sort({ claimedCount: -1 })
        .limit(limit)
        .lean();

      const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));
      const ids = docs.map((d) => d.userId);
      let membersMap = new Map();
      if (guild) {
        try {
          const members = await guild.members.fetch({ user: ids });
          members.forEach((m) => membersMap.set(m.id, m));
        } catch {}
      }

      const enriched = await Promise.all(
        docs.map(async (d) => {
          const m = membersMap.get(d.userId);
          let displayName = undefined;
          if (m) displayName = m.displayName || m.user?.globalName || m.user?.username;
          if (!displayName && guild) {
            try {
              const u = await client.users.fetch(d.userId);
              displayName = u.globalName || u.username;
            } catch {}
          }
          return { ...d, displayName: displayName || d.userId };
        })
      );

      res.json(enriched);
    } catch (error) {
      logger.error('فشل جلب إحصائيات الطاقم', error);
      res.status(500).json({ message: 'خطأ داخلي' });
    }
  });

  app.post('/api/guilds/:guildId/stats/reset', async (req, res) => {
    const guildId = req.params.guildId;
    try {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) return res.status(404).json({ message: 'السيرفر غير موجود لدى البوت' });

      const { userId } = req.body || {};
      if (userId) {
        await StaffStats.updateOne({ guildId, userId }, { $set: { claimedCount: 0 } }, { upsert: true });
      } else {
        await StaffStats.updateMany({ guildId }, { $set: { claimedCount: 0 } });
      }
      res.json({ ok: true });
    } catch (error) {
      logger.error('فشل تصفير الإحصائيات', error);
      res.status(500).json({ message: 'خطأ داخلي' });
    }
  });

  app.get('/api/guilds', async (_req, res) => {
    try {
      const guilds = client.guilds.cache.map((g) => ({ id: g.id, name: g.name }));
      res.json(guilds);
    } catch (error) {
      logger.error('فشل جلب السيرفرات', error);
      res.status(500).json({ message: 'خطأ داخلي' });
    }
  });

  app.get('/api/guilds/:guildId/channels', async (req, res) => {
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const channels = guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildText)
        .map((ch) => ({ id: ch.id, name: ch.name }));
      res.json(channels);
    } catch (error) {
      logger.error('فشل جلب القنوات', error);
      res.status(500).json({ message: 'لم يتم العثور على السيرفر أو القنوات' });
    }
  });

  app.get('/api/guilds/:guildId/resources', async (req, res) => {
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      await guild.channels.fetch();
      await guild.roles.fetch();

      const channels = guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildText)
        .map((ch) => ({ id: ch.id, name: ch.name }));

      const categories = guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildCategory)
        .map((ch) => ({ id: ch.id, name: ch.name }));

      const roles = guild.roles.cache
        .filter((role) => role.editable || !role.managed)
        .map((role) => ({ id: role.id, name: role.name }));

      res.json({ channels, categories, roles });
    } catch (error) {
      logger.error('فشل جلب الموارد', error);
      res.status(500).json({ message: 'تعذر تحميل القنوات/التصنيفات/الأدوار' });
    }
  });

  app.get('/api/guilds/:guildId/panel', async (req, res) => {
    try {
      const panel = await TicketPanel.findOne({ guildId: req.params.guildId });
      res.json(panel ?? null);
    } catch (error) {
      logger.error('فشل جلب لوحة التذاكر', error);
      res.status(500).json({ message: 'خطأ داخلي' });
    }
  });

  app.post('/api/guilds/:guildId/panel', async (req, res) => {
    try {
      const panel = await ticketService.savePanel(req.params.guildId, req.body);
      res.json(panel);
    } catch (error) {
      logger.error('فشل حفظ لوحة التذاكر', error);
      res.status(400).json({ message: error.message });
    }
  });

  app.post('/api/guilds/:guildId/panel/publish', async (req, res) => {
    try {
      const panel = await ticketService.postPanel(req.params.guildId);
      res.json(panel);
    } catch (error) {
      logger.error('فشل نشر لوحة التذاكر', error);
      res.status(400).json({ message: error.message });
    }
  });

  app.use(express.static(publicDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return new Promise((resolve) => {
    app.listen(port, host, () => {
      if (baseUrl) {
        logger.info(`لوحة التحكم تعمل على ${baseUrl}`);
      } else {
        const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
        logger.info(`لوحة التحكم تعمل على http://${displayHost}:${port}`);
      }
      resolve();
    });
  });
}
