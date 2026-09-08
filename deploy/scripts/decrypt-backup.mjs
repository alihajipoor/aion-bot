#!/usr/bin/env node
// Decrypt an AION backup archive. Layout written by modules/backup.ts:
//   salt(16) | iv(12) | tag(16) | ciphertext
// and inside, a JSON header line followed by the gzipped dump and the
// structure JSON, concatenated in that order.
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

const nl = plain.indexOf(0x0a);
const header = JSON.parse(plain.subarray(0, nl).toString('utf8'));
let offset = nl + 1;

const stem = basename(file).replace(/\.tar\.gz\.enc$/, '');
writeFileSync(`${stem}.sql.gz`, plain.subarray(offset, offset + header.sql));
offset += header.sql;
console.log(`wrote ${stem}.sql.gz`);

if (header.structure > 0) {
  writeFileSync(`${stem}.structure.json`, plain.subarray(offset, offset + header.structure));
  console.log(`wrote ${stem}.structure.json`);
}
