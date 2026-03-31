// ===== Supabase Client Module =====
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment variables!');
    console.error('   SUPABASE_URL:', SUPABASE_URL ? 'set' : 'MISSING');
    console.error('   SUPABASE_SERVICE_KEY:', SUPABASE_KEY ? 'set' : 'MISSING');
}

const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        global: { fetch: fetch },
    })
    : null;

module.exports = supabase;
