import type { ChatInputCommandInteraction, SlashCommandOptionsOnlyBuilder, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import type { AionClient } from './client.js';

export type CommandData = SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;

export interface Command {
  data: CommandData;
  /** Guard runs before execute; return a string to refuse with that message. */
  guard?: (i: ChatInputCommandInteraction) => Promise<string | null> | string | null;
  execute: (i: ChatInputCommandInteraction, client: AionClient) => Promise<void>;
}

export interface EventHandler<K extends string = string> {
  name: K;
  once?: boolean;
  run: (client: AionClient, ...args: unknown[]) => Promise<void> | void;
}
