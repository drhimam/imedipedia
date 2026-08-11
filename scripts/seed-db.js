/**
 * Database Seed Script for iMedipedia
 *
 * Usage:
 *   npx wrangler d1 execute imedipedia-db --local --file=scripts/seed-output.sql
 *   npx wrangler d1 execute imedipedia-db --remote --file=scripts/seed-output.sql
 *
 * This script generates the SQL to drop and recreate all tables,
 * then seeds with initial data (admin user, demo contributors, etc.).
 */

import crypto from 'crypto';

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateId() {
  return bytesToHex(crypto.randomBytes(16));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `${bytesToHex(salt)}:${bytesToHex(hash)}`;
}

const now = Math.floor(Date.now() / 1000);

// Generate hashed password for admin
const adminPasswordHash = await hashPassword('admin123');

const adminId = generateId();

const sql = `
-- Drop existing tables (order matters for FK constraints)
DROP TABLE IF EXISTS totp_secrets;
DROP TABLE IF EXISTS images;
DROP TABLE IF EXISTS applications;
DROP TABLE IF EXISTS submissions;
DROP TABLE IF EXISTS password_reset_tokens;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;

-- Users Table (with profile columns)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'editor',
    full_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    affiliation TEXT DEFAULT '',
    specialty TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    force_password_change INTEGER DEFAULT 0,
    mfa_enabled INTEGER DEFAULT 0
);

-- Sessions Table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Password Reset Tokens Table
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Article Submissions Table
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    tag TEXT DEFAULT '',
    type TEXT DEFAULT 'general',
    subject TEXT DEFAULT '',
    topic TEXT DEFAULT '',
    exams TEXT DEFAULT '[]',
    image TEXT DEFAULT '',
    body TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Contributor Applications Table
CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    about_me TEXT NOT NULL,
    writing_experience TEXT NOT NULL,
    portfolio_links TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    admin_notes TEXT DEFAULT '',
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER,
    reviewed_by TEXT,
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
);

-- Image Uploads Table (R2 storage tracking)
CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    url TEXT NOT NULL,
    name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    folder TEXT DEFAULT 'uploads',
    content_type TEXT DEFAULT 'image/png',
    size_bytes INTEGER DEFAULT 0,
    uploaded_by TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- TOTP MFA Secrets Table
CREATE TABLE IF NOT EXISTS totp_secrets (
    user_id TEXT PRIMARY KEY,
    secret TEXT NOT NULL,
    enabled INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Seed admin user (password: admin123)
INSERT INTO users (id, username, password_hash, role, full_name, email)
VALUES ('${adminId}', 'admin', '${adminPasswordHash}', 'admin', 'Site Administrator', 'admin@imedipedia.org');
`;

import fs from 'fs';
fs.writeFileSync('scripts/seed-output.sql', sql, 'utf-8');
console.log('Seed SQL written to scripts/seed-output.sql');
console.log('Run with: npx wrangler d1 execute imedipedia-db --local --file=scripts/seed-output.sql');
console.log('Or remote: npx wrangler d1 execute imedipedia-db --remote --file=scripts/seed-output.sql');
