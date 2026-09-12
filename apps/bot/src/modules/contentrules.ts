import { Events, PermissionFlagsBits, type Message } from 'discord.js';
import { asciiFold } from '../lib/text.js';
import { settings } from '../lib/settings.js';
import { ignoreOnce } from '../lib/logbus.js';
import { logger } from '../lib/log.js';
import type { AionClient } from '../client.js';

const log = logger('content');

/** How long the "wrong channel" notice stays before removing itself. */
const NOTICE_MS = 8_000;

const matches = (channelName: string, patterns: readonly string[]): boolean => {
  const name = asciiFold(channelName).toLowerCase();
  return patterns.some(p => name.includes(asciiFold(p).toLowerCase()));
};

/** A post counts as media if it carries an upload or a sticker. */
const hasMedia = (msg: Message): boolean =>
  msg.attachments.size > 0 || msg.stickers.size > 0;

/**
 * Keeps the board channels to one kind of post each.
 *
 * A caption on a picture is still a picture post, so media channels ask only
 * that something was actually uploaded rather than banning words outright —
 * the rule is "do not chat here", not "do not speak".
 *
 * Links are left alone in both directions. A Tenor link renders as an image
 * but is not an upload, and telling the two apart reliably is not worth
 * deleting someone's message over.
 */
export function installContentRules(client: AionClient): void {
  client.on(Events.MessageCreate, (msg: Message) => {
    void (async () => {
      const cfg = settings().content;
      if (!cfg.enabled) return;
      if (!msg.inGuild() || msg.author.bot || msg.system) return;

      // Anyone who can clean up after themselves is trusted to post anyway.
      if (msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return;

      const name = 'name' in msg.channel ? msg.channel.name : '';
      if (!name) return;

      let reason: string | null = null;
      if (matches(name, cfg.mediaOnly) && !hasMedia(msg)) {
        reason = 'Inja faghat aks va video — baraye harf zadan az chat estefade kon.';
      } else if (matches(name, cfg.textOnly) && hasMedia(msg)) {
        reason = 'Inja faghat matn — aks va video ja-ye dige.';
      }
      if (!reason) return;

      try {
        // Our own deletion is not news; the log should show what people did.
        ignoreOnce(`msgdel:${msg.id}`);
        await msg.delete();

        const notice = await msg.channel.send({
          content: `<@${msg.author.id}> ${reason}`,
          allowedMentions: { users: [msg.author.id] },
        });
        setTimeout(() => void notice.delete().catch(() => {}), NOTICE_MS);
      } catch (e) {
        log.warn(`could not enforce rules in #${name}: ${(e as Error).message}`);
      }
    })();
  });

  log.info('content rules installed');
}
