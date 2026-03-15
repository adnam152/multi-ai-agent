/**
 * db.js — Supabase client singleton
 */
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.warn('[db] SUPABASE_URL or SUPABASE_SERVICE_KEY not set — running in file-only mode');
}

const supabase = url && key ? createClient(url, key) : null;

module.exports = supabase;
