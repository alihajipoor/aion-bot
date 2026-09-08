#!/usr/bin/env node
// Decrypt an AION backup archive. Layout written by modules/backup.ts:
//   salt(16) | iv(12) | tag(16) | ciphertext
// The plaintext is an ordinary tar.gz.
import { createDecipheriv, scryptSync } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, passphrase] = process.argv.slice(2);
if (!file || !passphrase) {
  console.error('usage: decrypt-backup.mjs <archive.tar.gz.enc> <passphrase>');
  process.exit(1);
}

const blob = readFileSync(file);
const salt = blob.subarray(0, 16);
const iv = blob.subarray(16, 28);
const tag = blob.subarray(28, 44);
const body = blob.subarray(44);

const decipher = createDecipheriv('aes-256-gcm', scryptSync(passphrase, salt, 32), iv);
decipher.setAuthTag(tag);

let plain;
try {
  plain = Buffer.concat([decipher.update(body), decipher.final()]);
} catch {
  console.error('Could not decrypt. Wrong passphrase, or the file is corrupt.');
  process.exit(1);
}

const out = basename(file).replace(/\.enc$/, '');
writeFileSync(out, plain);
console.log(`wrote ${out}`);
