const { execSync } = require('child_process');

// Remove and re-add SUPABASE_URL (might have newline)
try {
    execSync('npx vercel env rm SUPABASE_URL production --yes', { stdio: ['pipe', 'pipe', 'pipe'], timeout: 15000 });
    console.log('Removed old SUPABASE_URL');
} catch (e) {
    console.log('Remove failed (may not exist):', e.stderr?.toString()?.slice(0, 100));
}

try {
    execSync('npx vercel env add SUPABASE_URL production', {
        input: 'https://lpcwdnrrceblzbjvxbyj.supabase.co',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 15000,
    });
    console.log('OK: SUPABASE_URL re-added');
} catch (e) {
    console.log('Add result:', e.stdout?.toString()?.slice(0, 200) || e.stderr?.toString()?.slice(0, 200));
}
