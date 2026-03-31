// reset-admin.js — Create/reset admin user in Supabase
// Usage: node reset-admin.js
require('dotenv/config');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const ADMIN_EMAIL = 'admin@ai4dev.com';
const ADMIN_PASS  = 'Admin123';

async function main() {
    const hash = await bcrypt.hash(ADMIN_PASS, 12);

    // Check if admin exists
    const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', ADMIN_EMAIL)
        .single();

    if (existing) {
        // Update password
        const { error } = await supabase
            .from('users')
            .update({ password: hash, role: 'admin', balance: 500000, email_verified: true, profile_completed: true })
            .eq('email', ADMIN_EMAIL);
        if (error) { console.error('❌ Error:', error.message); return; }
        console.log('✅ Admin password reset!');
    } else {
        // Create new admin
        const { error } = await supabase
            .from('users')
            .insert({
                name: 'Admin',
                email: ADMIN_EMAIL,
                password: hash,
                role: 'admin',
                balance: 500000,
                email_verified: true,
                profile_completed: true,
            });
        if (error) { console.error('❌ Error:', error.message); return; }
        console.log('✅ Admin user created!');
    }

    console.log('\n📧 Email:    admin@ai4dev.com');
    console.log('🔑 Password: Admin123');
    console.log('💰 Balance:  500,000đ');
}

main().catch(console.error);
