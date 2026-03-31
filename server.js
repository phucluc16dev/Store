// ====================================================
//  AI4DEV � Express Backend Server (Supabase Edition)
// ====================================================
require('dotenv').config();

const express = require('express');
const cors     = require('cors');
const helmet   = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const fs       = require('fs');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const supabase = require('./supabase');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'ai4dev-jwt-secret-change-in-production';
const AUDIT_PATH = path.join(__dirname, 'audit.log');

// ������ EMAIL SETUP ������������������������������������������������������������������������������������
let emailTransporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    emailTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
    emailTransporter.verify().catch(err => {
        console.log('  �a�️  Email config error:', err.message);
        emailTransporter = null;
    });
} else {
    console.log('  �a�️  Email not configured � OTP codes, will be logged to console');
}

// In-memory OTP/reset code store
const otpStore = new Map();
const OTP_EXPIRY_MINUTES = 10;

function generateOTP() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendEmail(to, subject, html) {
    if (!emailTransporter) return false;
    try {
        await emailTransporter.sendMail({ from: `"AI4DEV" <${process.env.EMAIL_USER}>`, to, subject, html });
        return true;
    } catch (err) {
        console.error('[EMAIL ERROR]', err.message);
        return false;
    }
}

// ====== TELEGRAM BOT NOTIFICATION ======
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8270194394:AAFSxM7OcTRw8MGFn68a9oq7PmA1NR9AWfI';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '7810649476,8759562170';

async function sendTelegramNotification(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
        console.log('[TELEGRAM] Chat ID not configured, skipping notification');
        return false;
    }
    try {
        const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
        const chatIds = TELEGRAM_CHAT_ID.split(',').map(id => id.trim()).filter(id => id);
        let allSuccess = true;
        
        for (const chatId of chatIds) {
            const resp = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML',
                }),
            });
            const data = await resp.json();
            if (!data.ok) {
                console.error(`[TELEGRAM] Send failed to ${chatId}:`, data.description);
                allSuccess = false;
            } else {
                console.log(`[TELEGRAM] Notification sent to ${chatId}`);
            }
        }
        return allSuccess;
    } catch (err) {
        console.error('[TELEGRAM] Error:', err.message);
        return false;
    }
}

// ====== SECURITY ������������������������������������������������������������������������������������������
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES   = 15;
const failedLogins = new Map();

function auditLog(action, meta = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        ...meta,
    };
    try {
        fs.appendFileSync(AUDIT_PATH, JSON.stringify(entry) + '\n');
    } catch { /* ignore */ }
}

function maskSensitive(obj) {
    const clone = { ...obj };
    ['password', 'token', 'accountPassword'].forEach(k => {
        if (clone[k]) clone[k] = '***';
    });
    return clone;
}

function recordFailedLogin(email) {
    const rec = failedLogins.get(email) || { count: 0, lockedUntil: null };
    rec.count += 1;
    if (rec.count >= MAX_FAILED_LOGINS) {
        rec.lockedUntil = Date.now() + LOCKOUT_MINUTES * 60 * 1000;
    }
    failedLogins.set(email, rec);
}

function isAccountLocked(email) {
    const rec = failedLogins.get(email);
    if (!rec || !rec.lockedUntil) return false;
    if (Date.now() < rec.lockedUntil) return true;
    failedLogins.delete(email);
    return false;
}

function clearFailedLogins(email) {
    failedLogins.delete(email);
}

// Clean up stale lockout records, every 30 min
setInterval(() => {
    const now = Date.now();
    for (const [email, rec] of failedLogins.entries()) {
        if (rec.lockedUntil && now >= rec.lockedUntil) failedLogins.delete(email);
    }
}, 30 * 60 * 1000);

// ������ INPUT SANITIZATION ����������������������������������������������������������������������
const SANITIZE_RE = /[<>"'`\\;{}()\[\]]/g;
const NO_SANITIZE = new Set(['password', 'confirmPassword', 'productName', 'accountTypeLabel', 'message', 'docs', 'description', 'imageUrl', 'link', 'referred_by']);

function sanitize(val) {
    if (typeof val !== 'string') return val;
    return val.replace(SANITIZE_RE, '');
}

function sanitizeBody(body) {
    const out = {};
    for (const [k, v] of Object.entries(body)) {
        if (NO_SANITIZE.has(k)) { out[k] = v; continue; }
        if (typeof v === 'string') out[k] = sanitize(v);
        else if (typeof v === 'object' && v !== null && !Array.isArray(v)) out[k] = sanitizeBody(v);
        else out[k] = v;
    }
    return out;
}

app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeBody(req.body);
    }
    next();
});

// ������ VALIDATION ��������������������������������������������������������������������������������������
const Validate = {
    name(v) {
        if (!v || typeof v !== 'string') return 'Tên là bắt buộc';
        if (v.trim().length < 2) return 'Tên phải có ít nhất 2 ký tự';
        if (v.trim().length > 50) return 'Tên không �được quá 50 ký tự';
        return null;
    },
    email(v) {
        if (!v || typeof v !== 'string') return 'Email là bắt buộc';
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!re.test(v.trim())) return 'Email không hợp lệ';
        return null;
    },
    password(v) {
        if (!v || typeof v !== 'string') return 'Mật khẩu là bắt buộc';
        if (v.length < 6) return 'Mật khẩu phải có ít nhất 6 ký tự';
        if (v.length > 128) return 'Mật khẩu quá dài';
        if (!/\d/.test(v)) return 'Mật khẩu phải có ít nhất 1 chu so';
        if (!/[a-zA-Z]/.test(v)) return 'Mật khẩu phải có ít nhất 1 chữ cái';
        return null;
    },
    phone(v) {
        if (!v || typeof v !== 'string') return 'S� �điện thoại là bắt buộc';
        if (!/^[0-9]{9,11}$/.test(v.replace(/\s/g, ''))) return 'S� �điện thoại không hợp lệ';
        return null;
    },
    bankAccount(v) {
        if (!v || typeof v !== 'string') return 'So tai khoản là bắt buộc';
        return null;
    },
    bankName(v) {
        if (!v || typeof v !== 'string') return 'Tên ngân hàng là bắt buộc';
        return null;
    },
};

// ������ JWT MIDDLEWARE ������������������������������������������������������������������������������
function generateToken(user) {
    return jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ success: false, message: 'Chưa �đăng nhập' });
    const token = authHeader.split(' ')[1];
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        req._ip = req.ip || req.connection?.remoteAddress || 'unknown';
        next();
    } catch {
        return res.status(401).json({ success: false, message: 'Phiên �đăng nhập hết hạn' });
    }
}

function adminMiddleware(req, res, next) {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Không có quyền admin' });
    next();
}

// ������ EXPRESS SETUP ��������������������������������������������������������������������������������
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, message: 'Quá nhiều yêu cầu. Vui lòng thử lại sau 15 phút.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Serve static files
app.use(express.static(path.join(__dirname)));

// Health check / diagnostic endpoint
app.get('/api/health', async (_req, res) => {
    const url = (process.env.SUPABASE_URL || '').trim();
    const key = (process.env.SUPABASE_SERVICE_KEY || '').trim();
    const envCheck = {
        SUPABASE_URL: url ? `set (len:${url.length}) "${url}"` : 'MISSING',
        SUPABASE_SERVICE_KEY: key ? `set (len:${key.length})` : 'MISSING',
        JWT_SECRET: process.env.JWT_SECRET ? 'set' : 'MISSING',
        VERCEL: process.env.VERCEL || 'not on vercel',
    };
    let dbStatus = 'not tested';
    let fetchTest = 'not tested';
    // Test raw fetch first
    try {
        const r = await fetch(url + '/rest/v1/', {
            headers: { 'apikey': key, 'Authorization': 'Bearer ' + key },
        });
        fetchTest = 'OK status:' + r.status;
    } catch (e) {
        fetchTest = 'FAILED: ' + e.message + (e.cause ? ' cause:' + JSON.stringify(e.cause) : '');
    }
    if (supabase) {
        try {
            const { data, error } = await supabase.from('products').select('id').limit(1);
            dbStatus = error ? 'ERROR: ' + error.message : 'OK (' + (data?.length || 0) + ' rows)';
        } catch (e) {
            dbStatus = 'EXCEPTION: ' + e.message + (e.cause ? ' cause:' + JSON.stringify(e.cause) : '');
        }
    } else {
        dbStatus = 'supabase client is NULL';
    }
    res.json({ success: true, env: envCheck, fetchTest, db: dbStatus, node: process.version });
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ AUTH ROUTES ������������������������������������������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

// POST /api/register
app.post('/api/register', authLimiter, async (req, res) => {
    // === ĐĂNG KÝ ĐÃ TẠM DỪNG ===
    return res.status(403).json({
        success: false,
        message: 'Chức năng đăng ký đã tạm dừng. Vui lòng mua hàng trực tiếp không cần tài khoản.',
    });

    // --- Original registration code below (disabled) ---
    const { name, email, password, referred_by: referralCodeInput } = req.body;

    const errors = {};
    const nameErr = Validate.name(name);
    const emailErr = Validate.email(email);
    const passErr = Validate.password(password);
    if (nameErr) errors.name = nameErr;
    if (emailErr) errors.email = emailErr;
    if (passErr) errors.password = passErr;
    if (Object.keys(errors).length) return res.status(400).json({ success: false, errors });

    const emailLower = email.trim().toLowerCase();

    // Check existing user
    const { data: existing } = await supabase
        .from('users').select('id').eq('email', emailLower).single();
    if (existing) return res.status(400).json({ success: false, errors: { email: 'Email � ��c ng k�' } });

    //  REFERRAL: Validate referral_code 
    // Ki�m tra referral code c� thu�c v� đãt user (CTV) h�p l� hay kh�ng
    let referredByUserId = null;
    if (referralCodeInput && typeof referralCodeInput === 'string' && referralCodeInput.trim()) {
        // Ch� cho ph�p alphanumeric � tr�nh injection
        const safeCode = referralCodeInput.trim().replace(/[^a-zA-Z0-9]/g, '');
        if (safeCode) {
            // Supabase query d�ng parameterized query (an to�n kh�i SQL injection)
            const { data: referrer } = await supabase
                .from('users').select('id').eq('referral_code', safeCode).single();
            if (referrer) {
                referredByUserId = referrer.id;
            }
            // N�u kh�ng t�m th�y -> gi� null, kh�ng b�o l�i
        }
    }

    //  T� �ng t�o referral_code duy nh�t cho user đãi 
    function generateReferralCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // B� O/0/I/1 tr�nh nh�m l�n
        let code = '';
        for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        return code;
    }

    let newReferralCode = generateReferralCode();
    // �m b�o kh�ng tr�ng (retry t�i a 5 l�n)
    for (let attempt = 0; attempt < 5; attempt++) {
        const { data: dup } = await supabase
            .from('users').select('id').eq('referral_code', newReferralCode).single();
        if (!dup) break;
        newReferralCode = generateReferralCode();
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = {
        id: uuidv4(),
        name: name.trim(),
        email: emailLower,
        password: hashedPassword,
        role: 'user',
        balance: 0,
        email_verified: false,
        profile_completed: false,
        referral_code: newReferralCode,      // đã gi�i thi�u c�a user đãi
        referred_by: referredByUserId,        // UUID ng��i gi�i thi�u (null n�u kh�ng c�)
    };

    const { error: insertErr } = await supabase.from('users').insert(newUser);
    if (insertErr) {
        console.error('[REGISTER ERROR]', insertErr.message);
        return res.status(500).json({ success: false, message: 'Lỗi t�o t�i kho�n' });
    }

    // Generate and send verification OTP
    const otp = generateOTP();
    otpStore.set(emailLower, { code: otp, expiresAt: Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000, type: 'verify' });

    const emailSent = await sendEmail(emailLower,
        'AI4DEV - X�c th�c email',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#1c1c1e;color:#fff;border-radius:12px;">
            <h2 style="color:#a855f7;">AI4DEV  X�c th�c email</h2>
            <p>đã x�c th�c c�a b�n:</p>
            <div style="font-size:32px;font-weight:bold;color:#a855f7;letter-spacing:8px;text-align:center;padding:20px;background:#2c2c2e;border-radius:8px;margin:16px 0;">${otp}</div>
            <p style="color:#888;">đã c� hi�u l�c trong ${OTP_EXPIRY_MINUTES} phút.</p>
        </div>`
    );
    if (!emailSent) {
        console.log(`\n  =� [OTP] Email: ${emailLower} � đã: ${otp}\n`);
    }

    auditLog('USER_REGISTERED', { userId: newUser.id, email: emailLower, referralCode: newReferralCode, referredBy: referredByUserId, ip: req._ip });
    const token = generateToken(newUser);
    const { password: _, ...safeUser } = newUser;

    res.status(201).json({
        success: true,
        message: 'ng k� th�nh c�ng! Vui l�ng x�c th�c email.',
        token,
        user: safeUser,
        redirect: 'verify-email',
    });
});


// POST /api/login
app.post('/api/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;

    const errors = {};
    const emailErr = Validate.email(email);
    if (emailErr) errors.email = emailErr;
    if (!password) errors.password = 'Mật khẩu là bắt buộc';
    if (Object.keys(errors).length) return res.status(400).json({ success: false, errors });

    const emailLower = email.trim().toLowerCase();

    if (isAccountLocked(emailLower)) {
        return res.status(429).json({ success: false, message: `Tài khoản tạm khóa. Vui lòng thử lại sau ${LOCKOUT_MINUTES} phút.` });
    }

    const { data: user } = await supabase
        .from('users').select('*').eq('email', emailLower).single();

    const dummyHash = '$2b$12$invalidhashfortimingprotection000000000000000000000';
    const hashToCheck = user ? user.password : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !passwordMatch) {
        recordFailedLogin(emailLower);
        const rec = failedLogins.get(emailLower) || {};
        const remaining = Math.max(0, MAX_FAILED_LOGINS - (rec.count || 0));
        return res.status(401).json({
            success: false,
            message: remaining > 0 ? `Sai email hoặc mật khẩu. Còn ${remaining} lần thử.` : `Tài khoản tạm khóa ${LOCKOUT_MINUTES} phút.`,
        });
    }

    clearFailedLogins(emailLower);
    auditLog('USER_LOGIN', { userId: user.id, email: emailLower, ip: req._ip });

    const token = generateToken(user);
    const { password: _, ...safeUser } = user;
    res.json({
        success: true,
        message: 'đăng nhập thành công!',
        token,
        user: safeUser,
        redirect: safeUser.profile_completed ? 'home' : 'complete-profile',
    });
});

// POST /api/profile/complete
app.post('/api/profile/complete', authMiddleware, async (req, res) => {
    const { phone_zalo, bank_account, bank_name } = req.body;

    const errors = {};
    const phoneErr   = Validate.phone(phone_zalo);
    const bankAccErr = Validate.bankAccount(bank_account);
    const bankNmErr  = Validate.bankName(bank_name);
    if (phoneErr)   errors.phone_zalo   = phoneErr;
    if (bankAccErr) errors.bank_account = bankAccErr;
    if (bankNmErr)  errors.bank_name    = bankNmErr;
    if (Object.keys(errors).length) return res.status(400).json({ success: false, errors });

    const { data: updated, error } = await supabase
        .from('users')
        .update({ phone_zalo, bank_account, bank_name, profile_completed: true, updated_at: new Date().toISOString() })
        .eq('id', req.user.id)
        .select()
        .single();
    if (error) return res.status(500).json({ success: false, message: 'Loi cap nhat ho so' });

    const { password: _, ...safeUser } = updated;
    res.json({ success: true, message: 'Cập nhật ho so thành công!', user: safeUser });
});

// GET /api/profile
app.get('/api/profile', authMiddleware, async (req, res) => {
    const { data: user, error } = await supabase
        .from('users').select('*').eq('id', req.user.id).single();
    if (error || !user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    const { password: _, ...safeUser } = user;
    res.json({ success: true, user: safeUser });
});

// POST /api/verify-email
app.post('/api/verify-email', authMiddleware, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Vui lòng nhập mã xác thực' });

    const { data: user } = await supabase
        .from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ success: false, message: 'Người dùng không ton tai' });
    if (user.email_verified) return res.json({ success: true, message: 'Email �đã �được xác thực r�i!' });

    const stored = otpStore.get(user.email);
    if (!stored || stored.type !== 'verify') return res.status(400).json({ success: false, message: 'đã không hợp lệ hoặc �đã hết hạn' });
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(user.email);
        return res.status(400).json({ success: false, message: 'đã �đã hết hạn. Vui lòng yêu cầu đã đã:i.' });
    }
    if (stored.code !== code.trim()) return res.status(400).json({ success: false, message: 'mã xác thực không dung' });

    await supabase.from('users').update({ email_verified: true }).eq('id', user.id);
    otpStore.delete(user.email);
    auditLog('EMAIL_VERIFIED', { userId: user.id, email: user.email, ip: req._ip });

    const { password: _pw, ...safeUser } = { ...user, email_verified: true };
    res.json({ success: true, message: 'Xác thực email thành công!', user: safeUser, redirect: 'complete-profile' });
});

// POST /api/resend-otp
app.post('/api/resend-otp', authLimiter, authMiddleware, async (req, res) => {
    const { data: user } = await supabase
        .from('users').select('*').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ success: false, message: 'Người dùng không ton tai' });
    if (user.email_verified) return res.json({ success: true, message: 'Email �đã �được xác thực!' });

    const otp = generateOTP();
    otpStore.set(user.email, { code: otp, expiresAt: Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000, type: 'verify' });

    const emailSent = await sendEmail(user.email,
        'AI4DEV - mã xác thực đã:i',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#1c1c1e;color:#fff;border-radius:12px;">
            <h2 style="color:#a855f7;">AI4DEV � mã xác thực</h2>
            <div style="font-size:32px;font-weight:bold;color:#a855f7;letter-spacing:8px;text-align:center;padding:20px;background:#2c2c2e;border-radius:8px;margin:16px 0;">${otp}</div>
            <p style="color:#888;">đã có hiệu lực trong ${OTP_EXPIRY_MINUTES} phút.</p>
        </div>`
    );
    if (!emailSent) {
        console.log(`\n  �x� [OTP-RESEND] Email: ${user.email} �  đã: ${otp}\n`);
    }

    auditLog('OTP_RESENT', { userId: user.id, email: user.email, ip: req._ip });
    res.json({ success: true, message: 'đã gửi lại mã xác thực!' });
});

// POST /api/forgot-password
app.post('/api/forgot-password', authLimiter, async (req, res) => {
    const { email } = req.body;
    const emailErr = Validate.email(email);
    if (emailErr) return res.status(400).json({ success: false, message: emailErr });

    const emailLower = email.trim().toLowerCase();
    const successMsg = 'Nếu email ton tai, ban se nhận �được đã �đặt lại mật khẩu.';

    const { data: user } = await supabase
        .from('users').select('id,email').eq('email', emailLower).single();
    if (!user) return res.json({ success: true, message: successMsg });

    const resetCode = generateOTP();
    otpStore.set(emailLower, { code: resetCode, expiresAt: Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000, type: 'reset' });

    const emailSent = await sendEmail(emailLower,
        'AI4DEV - đặt lại mật khẩu',
        `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:30px;background:#1c1c1e;color:#fff;border-radius:12px;">
            <h2 style="color:#a855f7;">AI4DEV � đặt lại mật khẩu</h2>
            <p>đã �đặt lại mật khẩu:</p>
            <div style="font-size:32px;font-weight:bold;color:#a855f7;letter-spacing:8px;text-align:center;padding:20px;background:#2c2c2e;border-radius:8px;margin:16px 0;">${resetCode}</div>
            <p style="color:#888;">đã có hi�!u lực trong ${OTP_EXPIRY_MINUTES} phút.</p>
        </div>`
    );
    if (!emailSent) {
        console.log(`\n  �x [RESET] Email: ${emailLower} �  đã reset: ${resetCode}\n`);
    }

    auditLog('FORGOT_PASSWORD', { email: emailLower, ip: req._ip });
    res.json({ success: true, message: successMsg });
});

// POST /api/reset-password
app.post('/api/reset-password', authLimiter, async (req, res) => {
    const { email, code, newPassword } = req.body;
    const emailErr = Validate.email(email);
    if (emailErr) return res.status(400).json({ success: false, errors: { email: emailErr } });
    const passErr = Validate.password(newPassword);
    if (passErr) return res.status(400).json({ success: false, errors: { newPassword: passErr } });
    if (!code) return res.status(400).json({ success: false, errors: { code: 'Vui lòng nhập mã xác thực' } });

    const emailLower = email.trim().toLowerCase();
    const stored = otpStore.get(emailLower);
    if (!stored || stored.type !== 'reset') return res.status(400).json({ success: false, errors: { code: 'đã không hợp lệ hoặc �đã hết hạn' } });
    if (Date.now() > stored.expiresAt) {
        otpStore.delete(emailLower);
        return res.status(400).json({ success: false, errors: { code: 'đã �đã hết hạn. Vui lòng yêu cầu đã đã:i.' } });
    }
    if (stored.code !== code.trim()) return res.status(400).json({ success: false, errors: { code: 'mã xác thực không dung' } });

    const hashed = await bcrypt.hash(newPassword, 12);
    const { error } = await supabase.from('users').update({ password: hashed }).eq('email', emailLower);
    if (error) return res.status(500).json({ success: false, message: 'Loi cap nhat mật khẩu' });

    otpStore.delete(emailLower);
    clearFailedLogins(emailLower);
    auditLog('PASSWORD_RESET', { email: emailLower, ip: req._ip });
    res.json({ success: true, message: 'đặt lại mật khẩu thành công! Bạn có the �đăng nhập.' });
});

// PUT /api/profile � update user profile info
app.put('/api/profile', authMiddleware, async (req, res) => {
    const { name, phone_zalo, bank_account, bank_name } = req.body;

    const errors = {};
    if (name !== undefined) { const e = Validate.name(name); if (e) errors.name = e; }
    if (phone_zalo !== undefined) { const e = Validate.phone(phone_zalo); if (e) errors.phone_zalo = e; }
    if (bank_account !== undefined) { const e = Validate.bankAccount(bank_account); if (e) errors.bank_account = e; }
    if (bank_name !== undefined) { const e = Validate.bankName(bank_name); if (e) errors.bank_name = e; }
    if (Object.keys(errors).length) return res.status(400).json({ success: false, errors });

    const updates = { updated_at: new Date().toISOString() };
    if (name !== undefined)         updates.name = name.trim();
    if (phone_zalo !== undefined)   updates.phone_zalo = phone_zalo;
    if (bank_account !== undefined) updates.bank_account = bank_account;
    if (bank_name !== undefined)    updates.bank_name = bank_name;

    const { data: updated, error } = await supabase
        .from('users').update(updates).eq('id', req.user.id).select().single();
    if (error) return res.status(500).json({ success: false, message: 'Loi cap nhat ho so' });

    auditLog('PROFILE_UPDATED', maskSensitive({ userId: req.user.id }));
    const { password: _, ...safeUser } = updated;
    res.json({ success: true, message: 'Cập nhật ho so thành công!', user: safeUser });
});

// PUT /api/profile/password � change password
app.put('/api/profile/password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Vui lòng nhập day �đủ mật khẩu' });
    const passErr = Validate.password(newPassword);
    if (passErr) return res.status(400).json({ success: false, message: passErr });

    const { data: user } = await supabase
        .from('users').select('password').eq('id', req.user.id).single();
    if (!user) return res.status(404).json({ success: false, message: 'Người dùng không ton tai' });

    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) return res.status(400).json({ success: false, message: 'Mật khẩu điện tại không dung' });

    const hashed = await bcrypt.hash(newPassword, 12);
    await supabase.from('users').update({ password: hashed, updated_at: new Date().toISOString() }).eq('id', req.user.id);

    auditLog('PASSWORD_CHANGED', { userId: req.user.id, ip: req._ip });
    res.json({ success: true, message: 'Đ�"i mật khẩu thành công!' });
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ PRODUCT ROUTES ������������������������������������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

// GET /api/products, � list all products
app.get('/api/products', async (_req, res) => {
    const { data, error } = await supabase
        .from('products').select('*').order('created_at', { ascending: true });
    if (error) return res.status(500).json({ success: false, message: 'Loi tai sản phẩm' });
    // Map DB fields, to frontend-compatible camelCase
    const products = (data || []).map(p => ({
        id: p.id,
        name: p.name,
        shortName: p.short_name,
        imageUrl: p.image_url,
        category: p.category,
        description: p.description,
        price: p.price,
        originalPrice: p.original_price,
        purchases: p.purchases,
        rating: parseFloat(p.rating),
        reviewCount: p.review_count,
        isHot: p.is_hot,
        isTrending: p.is_trending,
        isNew: p.is_new,
        features: p.features || [],
        accountTypes: p.account_types || [],
        videoUrl: p.video_url,
        docs: p.docs,
        inStock: p.in_stock !== false,
    }));
    res.json({ success: true, products });
});

// GET /api/products/:id � single product
app.get('/api/products/:id', async (req, res) => {
    const { data: p, error } = await supabase
        .from('products').select('*').eq('id', req.params.id).single();
    if (error || !p) return res.status(404).json({ success: false, message: 'Sản phẩm không ton tai' });
    res.json({
        success: true,
        product: {
            id: p.id, name: p.name, shortName: p.short_name, imageUrl: p.image_url, category: p.category,
            description: p.description, price: p.price, originalPrice: p.original_price,
            purchases: p.purchases, rating: parseFloat(p.rating), reviewCount: p.review_count,
            isHot: p.is_hot, isTrending: p.is_trending, isNew: p.is_new,
            features: p.features || [], accountTypes: p.account_types || [],
            videoUrl: p.video_url, docs: p.docs,
        },
    });
});

// GET /api/products/:id/reviews
app.get('/api/products/:id/reviews', async (req, res) => {
    const { data, error } = await supabase
        .from('reviews').select('*').eq('product_id', req.params.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Loi tai �ánh giá' });
    const reviews = (data || []).map(r => ({
        id: r.id, productId: r.product_id, author: r.author, rating: r.rating,
        text: r.text, date: r.created_at,
    }));
    res.json({ success: true, reviews });
});

// POST /api/products/:id/reviews
app.post('/api/products/:id/reviews', authMiddleware, async (req, res) => {
    const { rating, text } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Đánh giá từ 1-5 sao' });
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Vui lòng nhập n�"i dung �ánh giá' });

    const { data: user } = await supabase.from('users').select('name').eq('id', req.user.id).single();
    const review = {
        product_id: req.params.id,
        user_id: req.user.id,
        author: user?.name || 'Anonymous',
        rating: parseInt(rating),
        text: text.trim(),
    };
    const { data: inserted, error } = await supabase.from('reviews').insert(review).select().single();
    if (error) return res.status(500).json({ success: false, message: 'Loi gui �ánh giá' });

    // Update product review_count and rating
    const { data: allReviews } = await supabase
        .from('reviews').select('rating').eq('product_id', req.params.id);
    if (allReviews) {
        const avgRating = (allReviews.reduce((s, r) => s + r.rating, 0) / allReviews.length).toFixed(1);
        await supabase.from('products').update({ review_count: allReviews.length, rating: avgRating }).eq('id', req.params.id);
    }

    res.json({ success: true, message: 'Đánh giá �đã �được gửi!', review: inserted });
});

// GET /api/products/:id/comments
app.get('/api/products/:id/comments', async (req, res) => {
    const { data, error } = await supabase
        .from('comments').select('*').eq('product_id', req.params.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Loi tai bình luận' });
    const comments = (data || []).map(c => ({
        id: c.id, productId: c.product_id, author: c.author, text: c.text, date: c.created_at,
    }));
    res.json({ success: true, comments });
});

// POST /api/products/:id/comments
app.post('/api/products/:id/comments', authMiddleware, async (req, res) => {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ success: false, message: 'Vui lòng nhập bình luận' });

    const { data: user } = await supabase.from('users').select('name').eq('id', req.user.id).single();
    const comment = {
        product_id: req.params.id,
        user_id: req.user.id,
        author: user?.name || 'Anonymous',
        text: text.trim(),
    };
    const { data: inserted, error } = await supabase.from('comments').insert(comment).select().single();
    if (error) return res.status(500).json({ success: false, message: 'Loi gui bình luận' });

    res.json({ success: true, message: 'Bình luận đã được gửi!', comment: inserted });
});

// """""""""""""""""""""""""""""""""""""""""""""""""""""""""""
//  ORDER / PURCHASE ROUTES 
// """""""""""""""""""""""""""""""""""""""""""""""""""""""""""

// POST /api/orders,  Buy a product
app.post('/api/orders', authMiddleware, async (req, res) => {
    try {
        console.log('[ORDER DEBUG] body:', JSON.stringify(req.body));
        const { productId, productName, accountType, accountTypeLabel, duration, price } = req.body;
        if (!productId || !accountType) {
            return res.status(400).json({ success: false, message: 'Thiếu thong tin đơn hàng (productId/accountType)' });
        }

        const numPrice = parseInt(price) || 0;
        if (numPrice <= 0) return res.status(400).json({ success: false, message: 'Gia khong hop le' });

        // Check product in stock
        const { data: productCheck } = await supabase.from('products').select('in_stock').eq('id', productId).single();
        if (productCheck && productCheck.in_stock === false) {
            return res.status(400).json({ success: false, message: 'San pham da het hang' });
        }

        // Get user
        const { data: user } = await supabase
            .from('users').select('*').eq('id', req.user.id).single();
        if (!user) return res.status(404).json({ success: false, message: 'Người dùng không ton tai' });

        const balance = user.balance || 0;
        if (balance < numPrice) {
            return res.status(400).json({
                success: false,
                message: `So du không �đủ. Cần ${numPrice.toLocaleString('vi-VN')}�, điện có ${balance.toLocaleString('vi-VN')}�`,
            });
        }

        // Deduct balance
        const newBalance = balance - numPrice;
        await supabase.from('users').update({ balance: newBalance }).eq('id', user.id);

        // Create order (let Supabase generate the UUID)
        const order = {
            user_id: user.id,
            user_name: user.name,
            user_email: user.email,
            product_id: productId,
            product_name: productName || 'Sản phẩm',
            account_type: accountType,
            account_type_label: accountTypeLabel || accountType,
            duration: parseInt(duration) || 1,
            price: numPrice,
            note: req.body.note || null,
            status: 'pending',
            credentials: req.body.upgradeEmail ? { upgradeEmail: req.body.upgradeEmail } : null,
            coupon_code: req.body.couponCode || null,
        };

        const { data: inserted, error: orderErr } = await supabase.from('orders').insert(order).select().single();
        if (orderErr) {
            // Refund balance on error
            await supabase.from('users').update({ balance }).eq('id', user.id);
            console.error('[ORDER ERROR]', orderErr.message);
            return res.status(500).json({ success: false, message: 'Loi tao �đơn hàng: ' + orderErr.message });
        }

        // Increment product purchases: (non-fatal)
        try {
            await supabase.rpc('increment_purchases', { product_id_input: productId });
        } catch (e) {
            console.warn('[RPC] increment_purchases: failed:', e.message);
        }

        auditLog('ORDER_CREATED', { orderId: inserted.id, userId: user.id, product: order.product_name, price: numPrice, ip: req._ip });

        // Increment coupon uses (logged-in user already paid with balance)
        if (order.coupon_code) {
            incrementCouponUses(order.coupon_code).catch(e => console.warn('[COUPON] increment failed:', e.message));
        }

        // Send Telegram notification (fire-and-forget)
        const upgradeEmailInfo = order.credentials && order.credentials.upgradeEmail ? `\n📧 Email nang cap: <b>${order.credentials.upgradeEmail}</b>` : '';
        sendTelegramNotification(
            `🛒 <b>DON HANG MOI!</b>\n\n` +
            `👤 Khach: <b>${user.name}</b> (${user.email})\n` +
            `📦 San pham: <b>${order.product_name}</b>\n` +
            `💎 Goi: ${order.account_type_label || order.account_type}\n` +
            `⏱ Thoi han: ${order.duration} thang\n` +
            `💰 Gia: <b>${numPrice.toLocaleString('vi-VN')}đ</b>` +
            upgradeEmailInfo + `\n` +
            `📝 Ghi chu: ${order.note || 'Khong co'}\n` +
            `🆔 Ma don: <code>${inserted.id}</code>\n` +
            `📅 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
        ).catch(err => console.error('[TELEGRAM] Notification error:', err.message));

        const { password: _, ...safeUser } = { ...user, balance: newBalance };
        res.json({
            success: true,
            message: 'đặt hàng thành công!',
            order: {
                id: inserted.id, userId: inserted.user_id, userName: inserted.user_name, userEmail: inserted.user_email,
                productId: inserted.product_id, productName: inserted.product_name,
                accountType: inserted.account_type, accountTypeLabel: inserted.account_type_label,
                duration: inserted.duration, price: inserted.price, note: inserted.note,
                status: inserted.status, credentials: inserted.credentials, createdAt: inserted.created_at,
            },
            user: safeUser,
        });
    } catch (err) {
        console.error('[ORDER CRASH]', err);
        res.status(500).json({ success: false, message: 'Loi server khi tạo đơn hàng' });
    }
});

// POST /api/orders/guest-checkout — Guest checkout (no auth required)
app.post('/api/orders/guest-checkout', async (req, res) => {
    try {
        const { customerName, customerPhone, productId, productName, accountType, accountTypeLabel, duration, price, note, affiliateCode, upgradeEmail } = req.body;

        // Validate required fields
        if (!customerName || !customerName.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập tên' });
        }
        if (!customerPhone || !customerPhone.trim()) {
            return res.status(400).json({ success: false, message: 'Vui lòng nhập số Zalo/SĐT' });
        }
        if (!productId || !accountType) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin sản phẩm' });
        }

        const numPrice = parseInt(price) || 0;
        if (numPrice <= 0) return res.status(400).json({ success: false, message: 'Giá không hợp lệ' });

        // Check product in stock
        const { data: productCheck } = await supabase.from('products').select('in_stock').eq('id', productId).single();
        if (productCheck && productCheck.in_stock === false) {
            return res.status(400).json({ success: false, message: 'Sản phẩm đã hết hàng' });
        }

        // --- Resolve affiliate_id ---
        let affiliateId = null;

        // 1. Fingerprinting: Tìm đơn cũ cùng SĐT có affiliate
        const phone = customerPhone.trim();
        try {
            const { data: oldOrders } = await supabase
                .from('orders')
                .select('affiliate_id')
                .eq('customer_phone', phone)
                .not('affiliate_id', 'is', null)
                .order('created_at', { ascending: false })
                .limit(1);
            if (oldOrders && oldOrders.length > 0 && oldOrders[0].affiliate_id) {
                affiliateId = oldOrders[0].affiliate_id;
                console.log(`[GUEST] Fingerprint match: phone=${phone} -> affiliate=${affiliateId}`);
            }
        } catch (e) {
            console.log('[GUEST] Fingerprint check failed:', e.message);
        }

        // 2. Nếu chưa có affiliate từ fingerprint, dùng referral code từ cookie
        if (!affiliateId && affiliateCode && typeof affiliateCode === 'string' && affiliateCode.trim()) {
            const safeCode = affiliateCode.trim().replace(/[^a-zA-Z0-9]/g, '');
            if (safeCode) {
                try {
                    const { data: referrer } = await supabase
                        .from('users')
                        .select('id, is_affiliate')
                        .eq('referral_code', safeCode)
                        .single();
                    if (referrer && referrer.is_affiliate) {
                        affiliateId = referrer.id;
                        console.log(`[GUEST] Referral code match: ${safeCode} -> affiliate=${affiliateId}`);
                    }
                } catch (e) {
                    console.log('[GUEST] Referral code lookup failed:', e.message);
                }
            }
        }

        // Generate unique order_code for SePay matching (DH + 8 chars)
        let orderCode = '';
        for (let attempt = 0; attempt < 5; attempt++) {
            orderCode = 'DH' + Math.random().toString(36).substring(2, 10).toUpperCase();
            const { data: dup } = await supabase.from('orders').select('id').eq('order_code', orderCode).single();
            if (!dup) break;
        }

        // Create guest order
        const order = {
            user_id: null,
            customer_name: customerName.trim(),
            customer_phone: phone,
            product_id: productId,
            product_name: productName || 'Sản phẩm',
            account_type: accountType,
            account_type_label: accountTypeLabel || accountType,
            duration: parseInt(duration) || 1,
            price: numPrice,
            note: note || null,
            status: 'pending',
            payment_status: 'unpaid',
            order_code: orderCode,
            affiliate_id: affiliateId,
            coupon_code: req.body.couponCode || null,
            credentials: upgradeEmail ? { upgradeEmail: upgradeEmail.trim() } : null,
        };

        const { data: inserted, error: orderErr } = await supabase.from('orders').insert(order).select().single();
        if (orderErr) {
            console.error('[GUEST ORDER ERROR]', orderErr.message);
            return res.status(500).json({ success: false, message: 'Lỗi tạo đơn hàng: ' + orderErr.message });
        }

        // Increment product purchases (non-fatal)
        try {
            await supabase.rpc('increment_purchases', { product_id_input: productId });
        } catch (e) {
            console.warn('[RPC] increment_purchases failed:', e.message);
        }

        auditLog('GUEST_ORDER_CREATED', {
            orderId: inserted.id, orderCode, customerName: customerName.trim(),
            customerPhone: phone, product: order.product_name,
            price: numPrice, affiliateId, ip: req._ip,
        });

        // Send Telegram notification
        const guestUpgradeEmailInfo = upgradeEmail ? `\n📧 Email nâng cấp: <b>${upgradeEmail.trim()}</b>` : '';
        sendTelegramNotification(
            `🛒 <b>ĐƠN HÀNG MỚI (Khách vãng lai)</b>\n\n` +
            `👤 Tên: <b>${customerName.trim()}</b>\n` +
            `📱 Zalo: <b>${phone}</b>\n` +
            `📦 SP: <b>${order.product_name}</b>\n` +
            `💎 Gói: ${order.account_type_label || order.account_type}\n` +
            `⏱ Thời hạn: ${order.duration} tháng\n` +
            `💰 Giá: <b>${numPrice.toLocaleString('vi-VN')}đ</b>\n` +
            `💳 Thanh toán: <b>Chờ CK</b>\n` +
            `🔑 Mã đơn: <code>${orderCode}</code>\n` +
            guestUpgradeEmailInfo +
            `📝 Ghi chú: ${order.note || 'Không có'}\n` +
            `📅 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
        ).catch(err => console.error('[TELEGRAM] Notification error:', err.message));

        // Return order info + bank info for QR payment
        res.json({
            success: true,
            message: 'Đặt hàng thành công! Vui lòng thanh toán.',
            order: {
                id: inserted.id,
                orderCode,
                customerName: inserted.customer_name,
                customerPhone: inserted.customer_phone,
                productName: inserted.product_name,
                accountType: inserted.account_type,
                accountTypeLabel: inserted.account_type_label,
                duration: inserted.duration,
                price: inserted.price,
                status: inserted.status,
                paymentStatus: inserted.payment_status,
                createdAt: inserted.created_at,
            },
            payment: {
                bankId: 'MB',
                bankAccount: '0368786277',
                bankName: 'TRAN PHUC LUC',
                amount: numPrice,
                transferContent: orderCode,
                qrUrl: `https://qr.sepay.vn/img?bank=MB&acc=0368786277&template=compact&amount=${numPrice}&des=${encodeURIComponent(orderCode)}`,
            },
        });
    } catch (err) {
        console.error('[GUEST ORDER CRASH]', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi tạo đơn hàng' });
    }
});

// GET /api/orders/guest-check-payment/:orderCode — Check payment status for guest order
app.get('/api/orders/guest-check-payment/:orderCode', async (req, res) => {
    try {
        const { data: order, error } = await supabase
            .from('orders')
            .select('id, order_code, payment_status, status, price')
            .eq('order_code', req.params.orderCode)
            .single();
        if (error || !order) return res.status(404).json({ success: false, message: 'Không tìm thấy đơn hàng' });
        res.json({ success: true, paymentStatus: order.payment_status, orderStatus: order.status });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Lỗi kiểm tra thanh toán' });
    }
});

// GET /api/orders - Get user's orders
app.get('/api/orders', authMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('orders').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Lỗi tải đơn hàng' });
    const orders = (data || []).map(o => ({
        id: o.id, userId: o.user_id, userName: o.user_name, userEmail: o.user_email,
        productId: o.product_id, productName: o.product_name,
        accountType: o.account_type, accountTypeLabel: o.account_type_label,
        duration: o.duration, price: o.price, note: o.note,
        status: o.status, credentials: o.credentials, reportIssue: o.report_issue,
        createdAt: o.created_at,
    }));
    res.json({ success: true, orders });
});

// POST /api/orders/:id/report � report issue
app.post('/api/orders/:id/report', authMiddleware, async (req, res) => {
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ success: false, message: 'Vui lòng mô tả l�i' });

    const { data: order } = await supabase
        .from('orders').select('*').eq('id', req.params.id).eq('user_id', req.user.id).single();
    if (!order) return res.status(404).json({ success: false, message: 'Không tìm thấy �đơn hàng' });

    const reportIssue = { message: message.trim(), reportedAt: new Date().toISOString(), resolved: false };
    await supabase.from('orders').update({ report_issue: reportIssue, status: 'reported' }).eq('id', req.params.id);

    auditLog('ORDER_REPORTED', { orderId: req.params.id, userId: req.user.id, ip: req._ip });
    res.json({ success: true, message: 'Báo cáo l�i �đã �được gửi. Chúng tôi s, xử lý trong 24h.' });
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ ADMIN ROUTES ����������������������������������������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

// GET /api/admin/users
app.get('/api/admin/users', authMiddleware, adminMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('users').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Loi tai danh sách users' });
    const users = (data || []).map(({ password: _, ...u }) => u);
    auditLog('ADMIN_LIST_USERS', { adminId: req.user.id, count: users.length });
    res.json({ success: true, users });
});

// PUT /api/admin/users/:id � update user (balance, role, etc.)
app.put('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { balance, role, name, email_verified, commission_rate } = req.body;
    const updates = {};
    if (balance !== undefined) updates.balance = parseInt(balance);
    if (role !== undefined) updates.role = role;
    if (name !== undefined) updates.name = name;
    if (email_verified !== undefined) updates.email_verified = email_verified;
    if (commission_rate !== undefined) updates.commission_rate = parseInt(commission_rate);
    updates.updated_at = new Date().toISOString();

    const { data: updated, error } = await supabase
        .from('users').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ success: false, message: 'Loi cap nhat user' });

    auditLog('ADMIN_UPDATE_USER', { adminId: req.user.id, targetUserId: req.params.id, updates: Object.keys(updates) });
    const { password: _, ...safeUser } = updated;
    res.json({ success: true, message: 'Cập nhật thành công!', user: safeUser });
});

// DELETE /api/admin/users/:id
app.delete('/api/admin/users/:id', authMiddleware, adminMiddleware, async (req, res) => {
    if (req.params.id === req.user.id) return res.status(400).json({ success: false, message: 'Không the xóa chính mình' });
    const { error } = await supabase.from('users').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ success: false, message: 'Loi xoa user' });
    auditLog('ADMIN_DELETE_USER', { adminId: req.user.id, targetUserId: req.params.id });
    res.json({ success: true, message: 'đã xóa user' });
});

// GET /api/admin/stats -� dashboard statistics
app.get('/api/admin/stats', authMiddleware, adminMiddleware, async (req, res) => {
    const { data: users } = await supabase.from('users').select('id, balance, created_at');
    const { data: orders } = await supabase.from('orders').select('id, price, status, created_at');
    const { data: products } = await supabase.from('products').select('id');
    let deposits = [];
    try { const { data: d } = await supabase.from('deposits').select('amount, status').eq('status', 'completed'); deposits = d || []; } catch(e){}

    const totalUsers = (users || []).length;
    const totalOrders = (orders || []).length;
    const totalProducts = (products || []).length;
    const orderRevenue = (orders || []).filter(o => o.status !== 'cancelled').reduce((s, o) => s + (o.price || 0), 0);
    const depositRevenue = deposits.reduce((s, d) => s + (d.amount || 0), 0);
    const totalRevenue = orderRevenue + depositRevenue;

    res.json({ success: true, stats: { totalUsers, totalOrders,  totalProducts, totalRevenue, orderRevenue, depositRevenue } });
});

// GET /api/admin/revenue-chart
app.get('/api/admin/revenue-chart', authMiddleware, adminMiddleware, async (req, res) => {
    const period = req.query.period || 'week';
    const now = new Date();
    let daysBack = period === 'day' ? 1 : period === 'month' ? 30 : 7;
    const startDate = new Date(now); startDate.setDate(startDate.getDate() - daysBack + 1); startDate.setHours(0,0,0,0);

    const { data: orders } = await supabase.from('orders').select('price, status, created_at').gte('created_at', startDate.toISOString()).neq('status', 'cancelled');
    let deposits = [];
    try { const { data: d } = await supabase.from('deposits').select('amount, status, created_at').gte('created_at', startDate.toISOString()).eq('status', 'completed'); deposits = d || []; } catch(e){}

    const dailyRevenue = {};
    for (let i = 0; i < daysBack; i++) { const d = new Date(startDate); d.setDate(d.getDate() + i); dailyRevenue[d.toISOString().split('T')[0]] = 0; }
    (orders || []).forEach(o => { const k = new Date(o.created_at).toISOString().split('T')[0]; if (dailyRevenue[k] !== undefined) dailyRevenue[k] += (o.price || 0); });
    deposits.forEach(d => { const k = new Date(d.created_at).toISOString().split('T')[0]; if (dailyRevenue[k] !== undefined) dailyRevenue[k] += (d.amount || 0); });

    res.json({ success: true, period, dailyRevenue });
});

// GET /api/admin/security
app.get('/api/admin/security', authMiddleware, adminMiddleware, (_req, res) => {
    const recentAuditLogs = fs.existsSync(AUDIT_PATH)
        ? fs.readFileSync(AUDIT_PATH, 'utf8').trim().split('\n').slice(-50).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean)
        : [];
    const auditLines = recentAuditLogs.length;
    const lockedAccounts = [...failedLogins.entries()]
        .filter(([, v]) => v.lockedUntil && Date.now() < v.lockedUntil)
        .map(([email, v]) => ({ email, lockedUntil: new Date(v.lockedUntil).toISOString() }));

    res.json({ success: true, recentAuditLogs, auditLines, lockedAccounts });
});

// GET /api/admin/orders - Admin get all orders
app.get('/api/admin/orders', authMiddleware, adminMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('orders').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Lỗi tải đơn hàng' });
    const orders = (data || []).map(o => ({
        id: o.id, userId: o.user_id, userName: o.user_name || o.customer_name, userEmail: o.user_email,
        customerName: o.customer_name, customerPhone: o.customer_phone,
        productId: o.product_id, productName: o.product_name,
        accountType: o.account_type, accountTypeLabel: o.account_type_label,
        duration: o.duration, price: o.price, note: o.note,
        status: o.status, credentials: o.credentials, reportIssue: o.report_issue,
        affiliateId: o.affiliate_id, paymentStatus: o.payment_status, orderCode: o.order_code,
        createdAt: o.created_at,
    }));
    res.json({ success: true, orders });
});

// PUT /api/admin/orders/:id/status: — Admin update order status
app.put('/api/admin/orders/:id/status', authMiddleware, adminMiddleware, async (req, res) => {

    const { status } = req.body;
    const validStatuses = ['pending', 'processing', 'completed', 'cancelled', 'reported'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ' });
    }

    const { data: order, error } = await supabase
        .from('orders').update({ status }).eq('id', req.params.id).select().single();
    if (error || !order) return res.status(404).json({ success: false, message: 'Không tìm thấy �đơn hàng' });

    auditLog('ORDER_STATUS_CHANGED', { orderId: order.id, status, ip: req._ip });
    res.json({ success: true, message: `đơn hàng �đã cập nhật: ${status}`, order });
});

// PUT /api/admin/orders/:id/credentials � Admin send account credentials
app.put('/api/admin/orders/:id/credentials', authMiddleware, adminMiddleware, async (req, res) => {
    const { accountEmail, accountPassword, accountCode2FA } = req.body;
    if (!accountEmail || !accountPassword) {
        return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu' });
    }

    const credentials = {
        email: accountEmail,
        password: accountPassword,
        code2fa: accountCode2FA || '',
        sentAt: new Date().toISOString(),
    };

    const { data: order, error } = await supabase
        .from('orders').update({ credentials, status: "completed" }).eq('id', req.params.id).select().single();
    if (error || !order) return res.status(404).json({ success: false, message: 'Không tìm thấy �đơn hàng' });

    // T�nh hoa h�ng cho CTV (n�u c�)
    await processCommission(order);

    auditLog('CREDENTIALS_SENT', { orderId: req.params.id, ip: req._ip });

    // Increment coupon uses khi don hoan thanh
    if (order.coupon_code) {
        incrementCouponUses(order.coupon_code).catch(e => console.warn('[COUPON] increment failed:', e.message));
    }

    res.json({ success: true, message: 'đã gửi thong tin tài khoản cho khách hàng!', order });
});

// PUT /api/admin/orders/:id/confirm-upgrade � Admin confirm owned upgrade done
app.put('/api/admin/orders/:id/confirm-upgrade', authMiddleware, adminMiddleware, async (req, res) => {
    const { data: order, error } = await supabase
        .from('orders').update({ status: 'completed' }).eq('id', req.params.id).select().single();
    if (error || !order) return res.status(404).json({ success: false, message: 'Không tìm thấy �đơn hàng' });

    // T�nh hoa h�ng cho CTV (n�u c�)
    await processCommission(order);

    auditLog('UPGRADE_CONFIRMED', { orderId: req.params.id, ip: req._ip });

    // Increment coupon uses khi don hoan thanh
    if (order.coupon_code) {
        incrementCouponUses(order.coupon_code).catch(e => console.warn('[COUPON] increment failed:', e.message));
    }

    res.json({ success: true, message: 'đã xác nhận nâng cấp tài khoản!', order });
});

// PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP
//  AFFILIATE / CTV SYSTEM 
// PPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPPP

// --- Tang so luot su dung coupon khi thanh toan thanh cong ---
async function incrementCouponUses(couponCode) {
    if (!couponCode) return;
    try {
        const { data: coupon } = await supabase
            .from('coupons')
            .select('id, uses')
            .eq('code', couponCode.toUpperCase())
            .single();
        if (coupon) {
            await supabase
                .from('coupons')
                .update({ uses: (coupon.uses || 0) + 1 })
                .eq('id', coupon.id);
            console.log(`[COUPON] Incremented uses for ${couponCode}: ${(coupon.uses || 0) + 1}`);
        }
    } catch (e) {
        console.warn('[COUPON] incrementCouponUses error:', e.message);
    }
}

// --- Ham tinh hoa hong khi don hang hoan thanh ---
// Duoc goi khi admin gui credentials hoac confirm upgrade
async function processCommission(order) {

    try {
        if (!order || !order.price) return;

        // Kiểm tra đã tính hoa hồng cho đơn này chưa (tránh trùng)
        const { data: existingComm } = await supabase
            .from('commission_history').select('id').eq('order_id', order.id).single();
        if (existingComm) return; // Đã tính rồi, bỏ qua

        let affiliateUserId = null;
        let buyerId = null;

        // Path 1: Guest order — affiliate_id lưu trực tiếp trên đơn hàng
        if (order.affiliate_id) {
            affiliateUserId = order.affiliate_id;
            buyerId = order.user_id || null; // guest order có thể null
        }
        // Path 2: Registered user — tra qua buyer.referred_by
        else if (order.user_id) {
            const { data: buyer } = await supabase
                .from('users').select('id, referred_by').eq('id', order.user_id).single();
            if (!buyer || !buyer.referred_by) return;
            affiliateUserId = buyer.referred_by;
            buyerId = buyer.id;
        } else {
            return; // Không có affiliate
        }

        // Kiểm tra CTV có hợp lệ không (is_affiliate = true)
        const { data: affiliate } = await supabase
            .from('users').select('id, wallet_balance, is_affiliate, commission_rate')
            .eq('id', affiliateUserId).single();
        if (!affiliate || !affiliate.is_affiliate) return;

        // Tính hoa hồng: lấy tỷ lệ riêng của CTV (mặc định 10%)
        const commissionRate = affiliate.commission_rate || 10;
        const commissionAmount = Math.floor(order.price * commissionRate / 100);
        if (commissionAmount <= 0) return;

        // Cộng tiền vào ví CTV
        const newBalance = (affiliate.wallet_balance || 0) + commissionAmount;
        await supabase.from('users')
            .update({ wallet_balance: newBalance })
            .eq('id', affiliate.id);

        // Lưu lịch sử hoa hồng
        await supabase.from('commission_history').insert({
            affiliate_id: affiliate.id,
            order_id: order.id,
            buyer_id: buyerId,
            order_amount: order.price,
            commission_rate: commissionRate,
            commission_amount: commissionAmount,
        });

        // Cập nhật cột commission trên order
        await supabase.from('orders')
            .update({ referred_by: affiliate.id, commission_rate: commissionRate, commission_amount: commissionAmount })
            .eq('id', order.id);

        auditLog('COMMISSION_PAID', {
            affiliateId: affiliate.id, orderId: order.id,
            buyerId, amount: commissionAmount,
        });
        console.log(`  [COMMISSION] Order ${order.id}: ${commissionAmount.toLocaleString()} -> CTV ${affiliate.id}`);
    } catch (err) {
        console.error('[COMMISSION ERROR]', err.message);
    }
}

// POST /api/affiliate/register  ng k tr thnh CTV
app.post('/api/affiliate/register', authMiddleware, async (req, res) => {
    const userId = req.user.id;

    // Kim tra user hin ti
    const { data: user } = await supabase
        .from('users').select('id, is_affiliate, email_verified, referral_code')
        .eq('id', userId).single();
    if (!user) return res.status(404).json({ success: false, message: 'Khng tm thy ngi dng' });
    if (user.is_affiliate) return res.json({ success: true, message: 'Bn  l Cng tc vin!' });
    if (!user.email_verified) {
        return res.status(400).json({ success: false, message: 'Vui lng xc thc email trc khi ng k CTV' });
    }

    // Cp nht is_affiliate = true
    const { error } = await supabase.from('users')
        .update({ is_affiliate: true, updated_at: new Date().toISOString() })
        .eq('id', userId);
    if (error) return res.status(500).json({ success: false, message: 'Lỗi ng k CTV' });

    auditLog('AFFILIATE_REGISTERED', { userId, ip: req._ip });
    res.json({
        success: true,
        message: 'ng k Cng tc vin thnh cng!',
        referralCode: user.referral_code,
    });
});

// GET /api/affiliate/dashboard  Dashboard CTV
app.get('/api/affiliate/dashboard', authMiddleware, async (req, res) => {
    const userId = req.user.id;

    const { data: user } = await supabase
        .from('users').select('id, name, is_affiliate, referral_code, wallet_balance, commission_rate')
        .eq('id', userId).single();
    if (!user) return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
    if (!user.is_affiliate) return res.status(403).json({ success: false, message: 'Bạn chưa là Cộng tác viên' });

    // Đếm số người đã giới thiệu
    const { count: totalReferrals, } = await supabase
        .from('users').select('id', { count: 'exact', head: true })
        .eq('referred_by', userId);

    // Tổng hoa hồng đã nhận
    const { data: commissions, } = await supabase
        .from('commission_history').select('commission_amount')
        .eq('affiliate_id', userId);
    const totalCommission = (commissions || []).reduce((sum, c) => sum + c.commission_amount, 0);

    res.json({
        success: true,
        dashboard: {
            referralCode: user.referral_code,
            referralLink: `${req.protocol}://${req.get('host')}/?ref=${user.referral_code}`,
            walletBalance: user.wallet_balance || 0,
            totalReferrals: totalReferrals || 0,
            totalCommission,
            commissionRate: user.commission_rate || 10, // % - lấy từ DB
        },
    });
});

// GET /api/affiliate/commissions - Lch s, hoa hng
app.get('/api/affiliate/commissions', authMiddleware, async (req, res) => {
    const userId = req.user.id;

    const { data: user } = await supabase
        .from('users').select('is_affiliate').eq('id', userId).single();
    if (!user || !user.is_affiliate) return res.status(403).json({ success: false, message: 'B�n ch�a l� CTV' });

    const { data, error } = await supabase
        .from('commission_history')
        .select('*, orders(product_name, price, status), users!commission_history_buyer_id_fkey(name, email)')
        .eq('affiliate_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ success: false, message: 'Lỗi t�i l�ch s, hoa h�ng' });

    const commissions = (data || []).map(c => ({
        id: c.id,
        orderAmount: c.order_amount,
        commissionRate: c.commission_rate,
        commissionAmount: c.commission_amount,
        productName: c.orders?.product_name || '',
        buyerName: c.users?.name || '',
        createdAt: c.created_at,
    }));

    res.json({ success: true, commissions });
});

// ������ ADMIN PRODUCT CRUD ����������������������������������������������������������������������

// POST /api/admin/products, � create product
app.post('/api/admin/products', authMiddleware, adminMiddleware, async (req, res) => {
    const { name, shortName, imageUrl, category, description, price, originalPrice, features, accountTypes, videoUrl, docs, isHot, isTrending, isNew, inStock } = req.body;
    if (!name || !price) return res.status(400).json({ success: false, message: 'Tên và giá là bắt buộc' });

    const product = {
        name, short_name: shortName || '', image_url: imageUrl || null, category: category || '',
        description: description || '', price: parseInt(price), original_price: parseInt(originalPrice) || 0,
        purchases: 0, rating: 0, review_count: 0,
        is_hot: isHot || false, is_trending: isTrending || false, is_new: isNew || false,
        features: features || [], account_types: accountTypes || [],
        video_url: videoUrl || '', docs: docs || '',
        in_stock: inStock !== false,
    };

    const { data: inserted, error } = await supabase.from('products').insert(product).select().single();
    if (error) return res.status(500).json({ success: false, message: 'Loi tao sản phẩm' });

    auditLog('PRODUCT_CREATED', { productId: inserted.id, name, adminId: req.user.id });
    res.json({ success: true, message: 'Tạo sản phẩm thành công!', product: inserted });
});

// PUT /api/admin/products/:id � update product
app.put('/api/admin/products/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { name, shortName, imageUrl, category, description, price, originalPrice, features, accountTypes, videoUrl, docs, isHot, isTrending, isNew, inStock } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (shortName !== undefined) updates.short_name = shortName;
    if (imageUrl !== undefined) updates.image_url = imageUrl;
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = parseInt(price);
    if (originalPrice !== undefined) updates.original_price = parseInt(originalPrice);
    if (features !== undefined) updates.features = features;
    if (accountTypes !== undefined) updates.account_types = accountTypes;
    if (videoUrl !== undefined) updates.video_url = videoUrl;
    if (docs !== undefined) updates.docs = docs;
    if (isHot !== undefined) updates.is_hot = isHot;
    if (isTrending !== undefined) updates.is_trending = isTrending;
    if (isNew !== undefined) updates.is_new = isNew;
    if (inStock !== undefined) updates.in_stock = inStock;

    const { data: updated, error } = await supabase
        .from('products').update(updates).eq('id', req.params.id).select().single();
    if (error) {
        console.error('Product update error:', error);
        return res.status(500).json({ success: false, message: 'Loi cap nhat sản phẩm: ' + error.message });
    }

    auditLog('PRODUCT_UPDATED', { productId: req.params.id, adminId: req.user.id });
    res.json({ success: true, message: 'Cập nhật sản phẩm thành công!', product: updated });
});

// DELETE /api/admin/products/:id � delete product
app.delete('/api/admin/products/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { error } = await supabase.from('products').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ success: false, message: 'Loi xoa sản phẩm' });
    auditLog('PRODUCT_DELETED', { productId: req.params.id, adminId: req.user.id });
    res.json({ success: true, message: 'đã xóa sản phẩm' });
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ LẤY TH�NG TIN NẠP TIỬN ������������������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

// GET /api/deposit-info � Get bank transfer info
app.get('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        const { data: user } = await supabase.from('users').select('id, balance, email').eq('id', req.user.id).single();
        if (!user) return res.status(404).json({ success: false });
        res.json({ success: true, user });
    } catch (err) { res.status(500).json({ success: false }); }
});

app.get('/api/deposit-info', authMiddleware, async (req, res) => {
    try {
        // Use short code to keep bank transfer content clean
        const shortCode = req.user.id.replace(/-/g, '').substring(0, 8).toUpperCase();
        await supabase.from('users').update({ deposit_code: shortCode.toLowerCase() }).eq('id', req.user.id);
        
        res.json({
            success: true,
            bankId: 'MB',
            bankAccount: '0368786277',
            bankName: 'TRAN PHUC LUC',
            transferContent: `NAP ${shortCode}`
        });
    } catch (error) {
        console.error('Error fetching deposit info:', error);
        res.status(500).json({ success: false, message: 'Loi tai thong tin.' });
    }
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ SEPAY WEBHOOK � AUTO TOP-UP ��������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

// POST /api/webhook/sepay � Called by SePay when bank transfer arrives
app.post('/api/webhook/sepay', async (req, res) => {
    try {
        const { id, transferType, transferAmount, content, referenceCode, description } = req.body;
        console.log('[SEPAY WEBHOOK]', JSON.stringify(req.body));

        // Only process incoming transfers
        if (transferType !== 'in') {
            return res.json({ success: true, message: 'Ignored outgoing transfer' });
        }

        if (!transferAmount) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Deduplicate by transaction id (skip if deposits table doesn't exist)
        if (id) {
            try {
                const { data: existing } = await supabase
                    .from('deposits')
                    .select('id')
                    .eq('sepay_transaction_id', String(id))
                    .single();
                if (existing) {
                    return res.json({ success: true, message: 'Already processed' });
                }
            } catch (dedupErr) {
                console.log('[SEPAY] Dedup check skipped:', dedupErr.message);
            }
        }

        // Extract content for matching
        const txContent = (content || description || '').toUpperCase();

        // ── GUEST ORDER PAYMENT: Match DH{code} ──
        const dhMatch = txContent.match(/DH\s*([A-Z0-9]{6,10})/i);
        if (dhMatch) {
            const orderCode = 'DH' + dhMatch[1].toUpperCase().replace(/^DH/i, '');
            console.log('[SEPAY] Looking for guest order_code:', orderCode);
            try {
                const { data: guestOrder } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('order_code', orderCode)
                    .eq('payment_status', 'unpaid')
                    .single();

                if (guestOrder) {
                    const amount = parseInt(transferAmount) || 0;
                    if (amount >= guestOrder.price) {
                        // Mark as paid
                        const { data: updatedOrder } = await supabase.from('orders')
                            .update({ payment_status: 'paid' })
                            .eq('id', guestOrder.id)
                            .select()
                            .single();

                        // Increment coupon uses khi guest order được thanh toán
                        if (guestOrder.coupon_code) {
                            incrementCouponUses(guestOrder.coupon_code).catch(e => console.warn('[COUPON] increment failed:', e.message));
                        }

                        // Save deposit record
                        try {
                            await supabase.from('deposits').insert({
                                sepay_transaction_id: String(id || Date.now()),
                                user_id: null,
                                amount,
                                content: content || description || '',
                                reference_code: referenceCode || '',
                                status: 'completed',
                            });
                        } catch (e) { console.log('[SEPAY] Deposit insert skipped:', e.message); }

                        // Telegram notification
                        sendTelegramNotification(
                            `💳 <b>THANH TOÁN ĐƠN HÀNG</b>\n\n` +
                            `🔑 Mã đơn: <code>${orderCode}</code>\n` +
                            `👤 Khách: <b>${guestOrder.customer_name || 'N/A'}</b>\n` +
                            `📱 Zalo: <b>${guestOrder.customer_phone || 'N/A'}</b>\n` +
                            `📦 SP: <b>${guestOrder.product_name}</b>\n` +
                            `💰 Số tiền: <b>${amount.toLocaleString('vi-VN')}đ</b>\n` +
                            `✅ Trạng thái: <b>ĐÃ THANH TOÁN</b>\n` +
                            `📅 ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}`
                        ).catch(err => console.error('[TELEGRAM]', err.message));

                        console.log(`[SEPAY] Guest order ${orderCode} PAID: ${amount}`);
                        return res.json({ success: true, matched: true, type: 'guest_order', orderCode, amount });
                    } else {
                        console.log(`[SEPAY] Amount mismatch for ${orderCode}: got ${amount}, need ${guestOrder.price}`);
                    }
                }
            } catch (e) {
                console.log('[SEPAY] Guest order lookup failed:', e.message);
            }
        }

        // ── DEPOSIT MATCHING: Match NAP{code} ──
        const shortMatch = txContent.match(/NAP\s*(\S+)/i);
        
        let userId = null;
        if (shortMatch) {
            const code = shortMatch[1].toLowerCase();
            console.log('[SEPAY] Looking for deposit_code:', code);
            
            // Method 1: Try deposit_code column
            try {
                const { data: userByCode } = await supabase
                    .from('users')
                    .select('id')
                    .eq('deposit_code', code)
                    .single();
                if (userByCode) userId = userByCode.id;
            } catch (e) {
                console.log('[SEPAY] deposit_code lookup failed:', e.message);
            }

            // Method 2: If not found, match by UUID prefix
            if (!userId) {
                try {
                    const { data: allUsers } = await supabase
                        .from('users')
                        .select('id');
                    if (allUsers) {
                        const matched = allUsers.find(u => 
                            u.id.replace(/-/g, '').substring(0, 8).toLowerCase() === code
                        );
                        if (matched) userId = matched.id;
                    }
                } catch (e) {
                    console.log('[SEPAY] UUID match failed:', e.message);
                }
            }
        }

        const amount = parseInt(transferAmount) || 0;
        if (amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }

        // Try to save deposit record (skip if table doesn't exist)
        try {
            await supabase.from('deposits').insert({
                sepay_transaction_id: String(id || Date.now()),
                user_id: userId,
                amount,
                content: content || description || '',
                reference_code: referenceCode || '',
                status: userId ? 'completed' : 'unmatched',
            });
        } catch (insertErr) {
            console.log('[SEPAY] Deposit insert skipped:', insertErr.message);
        }

        // If we found the user, add balance
        if (userId) {
            const { data: user } = await supabase
                .from('users')
                .select('balance')
                .eq('id', userId)
                .single();

            if (user) {
                const newBalance = (user.balance || 0) + amount;
                await supabase.from('users').update({ balance: newBalance }).eq('id', userId);
                console.log(`[SEPAY] Nap ${amount} cho user ${userId}. Balance: ${newBalance}`);
                return res.json({ success: true, matched: true, userId, amount, newBalance });
            }
        } else {
            console.log(`[SEPAY] Khong tim thay user. Content: ${txContent}`);
        }

        res.json({ success: true, matched: false, searchedContent: txContent });
    } catch (err) {
        console.error('[SEPAY ERROR]', err.message, err.stack);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/deposits -� Get user's deposit history
app.get('/api/deposits', authMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) return res.status(500).json({ success: false, message: 'Loi tai lich su nap tien' });

    res.json({
        success: true,
        deposits: (data || []).map(d => ({
            id: d.id,
            amount: d.amount,
            content: d.content,
            referenceCode: d.reference_code,
            status: d.status,
            createdAt: d.created_at,
        })),
    });
});


// GET /api/admin/deposits -� Admin view all deposits
app.get('/api/admin/deposits', authMiddleware, adminMiddleware, async (req, res) => {
    const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
    if (error) return res.status(500).json({ success: false, message: 'Loi tai deposits' });

    res.json({
        success: true,
        deposits: (data || []).map(d => ({
            id: d.id,
            userId: d.user_id,
            amount: d.amount,
            content: d.content,
            referenceCode: d.reference_code,
            status: d.status,
            createdAt: d.created_at,
        })),
    });
});


// GET /api/banners -� list active banners
app.get('/api/banners', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('banners')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true });
        if (error) throw error;
        
          const banners = (data || []).map(b => ({
            id: b.id,
            title: b.title,
            imageUrl: b.image_url,
            link: b.link,
            isActive: b.is_active,
            sortOrder: b.sort_order
        }));
        res.json({ success: true, banners });
    } catch (err) {
        console.error('[GET BANNERS ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Loi tai banners' });
    }
});

// GET /api/admin/banners -� list all banners, (admin)
app.get('/api/admin/banners', authMiddleware, adminMiddleware, async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('banners')
            .select('*')
            .order('sort_order', { ascending: true });
        if (error) throw error;
        
          const banners = (data || []).map(b => ({
            id: b.id,
            title: b.title,
            imageUrl: b.image_url,
            link: b.link,
            isActive: b.is_active,
            sortOrder: b.sort_order,
            createdAt: b.created_at
        }));
        res.json({ success: true, banners });
    } catch (err) {
        console.error('[ADMIN GET BANNERS ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Loi tai banners' });
    }
});

// POST /api/admin/banners, � create banner
app.post('/api/admin/banners', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, imageUrl, link, isActive, sortOrder } = req.body;
        if (!imageUrl) return res.status(400).json({ success: false, message: 'Ảnh là bắt buộc' });

        const banner = {
            title: title || '',
            image_url: imageUrl,
            link: link || '',
            is_active: isActive !== false,
            sort_order: parseInt(sortOrder) || 0
        };

        const { data, error } = await supabase.from('banners').insert(banner).select().single();
        if (error) throw error;
        
        auditLog('BANNER_CREATED', { bannerId: data.id, admin: req.user.id });
        res.json({ success: true, message: 'Thêm banner thành công' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Loi them banner: ' + err.message });
    }
});

// PUT /api/admin/banners/:id � update banner
app.put('/api/admin/banners/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { title, imageUrl, link, isActive, sortOrder } = req.body;
        const updates = {};
        
        if (title !== undefined) updates.title = title;
        if (imageUrl !== undefined) updates.image_url = imageUrl;
        if (link !== undefined) updates.link = link;
        if (isActive !== undefined) updates.is_active = !!isActive;
        if (sortOrder !== undefined) updates.sort_order = parseInt(sortOrder) || 0;

        const { error } = await supabase.from('banners').update(updates).eq('id', req.params.id);
        if (error) throw error;

        auditLog('BANNER_UPDATED', { bannerId: req.params.id, admin: req.user.id });
        res.json({ success: true, message: 'Cập nhật thành công' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Loi cap nhat banner: ' + err.message });
    }
});

// DELETE /api/admin/banners/:id � delete banner
app.delete('/api/admin/banners/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { error } = await supabase.from('banners').delete().eq('id', req.params.id);
        if (error) throw error;

        auditLog('BANNER_DELETED', { bannerId: req.params.id, admin: req.user.id });
        res.json({ success: true, message: 'Xóa banner thành công' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Loi xoa banner' });
    }
});

// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�
// ������ CATCH-ALL & ERROR HANDLER ��������������������������������������������������������
// �"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"��"�

//  FLASH SALES API 

// GET /api/flash-sales:  public: active + not expired
app.get('/api/flash-sales', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('flash_sales')
            .select('*, products(id, name, short_name, category, price, original_price, purchases, rating, review_count, is_hot, is_trending, is_new, features, account_types, image_url)')
            .eq('is_active', true)
            .gte('end_date', new Date().toISOString())
            .order('sort_order', { ascending: true });
        if (error) throw error;

          const items = (data || []).map(fs => {
            const p = fs.products;
            const salePrice = Math.round(p.price * (1 - fs.discount_percent / 100));
            return {
                id: fs.id,
                title: fs.title,
                discountPercent: fs.discount_percent,
                endDate: fs.end_date,
                product: {
                    id: p.id,
                    name: p.name,
                    shortName: p.short_name,
                    category: p.category,
                    price: p.price,
                    originalPrice: p.original_price,
                    salePrice,
                    purchases: p.purchases,
                    rating: p.rating,
                    reviewCount: p.review_count,
                    isHot: p.is_hot,
                    isTrending: p.is_trending,
                    isNew: p.is_new,
                    features: p.features,
                    accountTypes: p.account_types,
                    imageUrl: p.image_url
                }
            };
        });
        res.json({ success: true, flashSales: items });
    } catch (err) {
        console.error('[FLASH SALES ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Error loading flash sales'});
    }
});

// GET /api/admin/flash-sales:  admin list all
app.get('/api/admin/flash-sales', authMiddleware, adminMiddleware, async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('flash_sales')
            .select('*, products(name, price)')
            .order('created_at', { ascending: false });
        if (error) throw error;

          const items = (data || []).map(fs => ({
            id: fs.id,
            title: fs.title,
            productId: fs.product_id,
            productName: fs.products?.name || '',
            productPrice: fs.products?.price || 0,
            discountPercent: fs.discount_percent,
            endDate: fs.end_date,
            isActive: fs.is_active,
            sortOrder: fs.sort_order,
            createdAt: fs.created_at
        }));
        res.json({ success: true, flashSales: items });
    } catch (err) {
        console.error('[ADMIN FLASH SALES ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Error loading flash sales'});
    }
});

// POST /api/admin/flash-sales:  create
app.post('/api/admin/flash-sales', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { productId, discountPercent, endDate, title } = req.body;
        if (!productId || !discountPercent || !endDate) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const { data, error } = await supabase.from('flash_sales').insert({
            title: title || 'FLASH SALE',
            product_id: productId,
            discount_percent: parseInt(discountPercent),
            end_date: endDate,
            is_active: true,
            sort_order: 0
        }).select().single();
        if (error) throw error;

        auditLog('FLASH_SALE_CREATED', { flashSaleId: data.id, productId, admin: req.user.id });
        res.json({ success: true, message: 'Flash sale created' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error: ' + err.message });
    }
});

// DELETE /api/admin/flash-sales/:id
app.delete('/api/admin/flash-sales/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { error } = await supabase.from('flash_sales').delete().eq('id', req.params.id);
        if (error) throw error;

        auditLog('FLASH_SALE_DELETED', { flashSaleId: req.params.id, admin: req.user.id });
        res.json({ success: true, message: 'Flash sale deleted' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Error deleting flash sale' });
    }
});

// ====== COUPONS (Supabase) ======

// Validate coupon
app.post('/api/coupons/validate', async (req, res) => {
    const { code, productId, basePrice: clientBasePrice } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'Vui long nhap ma' });

    const { data: coupon, error } = await supabase
        .from('coupons').select('*')
        .eq('code', code.toUpperCase())
        .eq('active', true)
        .single();

    if (error || !coupon) return res.json({ success: false, message: 'Ma giam gia khong ton tai' });
    if (coupon.expiry && new Date(coupon.expiry) < new Date()) return res.json({ success: false, message: 'Ma da het han' });
    if (coupon.max_uses && coupon.uses >= coupon.max_uses) return res.json({ success: false, message: 'Ma da het luot su dung' });
    if (coupon.product_ids && coupon.product_ids.length > 0 && !coupon.product_ids.includes(productId)) {
        return res.json({ success: false, message: 'Ma khong ap dung cho san pham nay' });
    }

    // Kiểm tra giá trị đơn hàng tối thiểu
    const orderPrice = parseInt(clientBasePrice) || 0;
    if (coupon.min_order_value && coupon.min_order_value > 0 && orderPrice < coupon.min_order_value) {
        return res.json({
            success: false,
            message: `Don hang phai tu ${coupon.min_order_value.toLocaleString('vi-VN')}d de su dung ma nay`
        });
    }

    let discount = 0;
    if (coupon.type === 'percent') {
        const { data: prod } = await supabase.from('products').select('price, account_types').eq('id', productId).single();
        const basePrice = orderPrice || prod?.account_types?.[0]?.prices?.['1'] || prod?.price || 0;
        discount = Math.round(basePrice * coupon.value / 100);
        return res.json({ success: true, discount, discountPercent: coupon.value, code: coupon.code, minOrderValue: coupon.min_order_value || 0 });
    } else {
        discount = coupon.value;
        return res.json({ success: true, discount, code: coupon.code, minOrderValue: coupon.min_order_value || 0 });
    }
});

// Admin: List coupons
app.get('/api/admin/coupons', authMiddleware, adminMiddleware, async (_req, res) => {
    const { data, error } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, message: 'Loi tai ma giam gia' });
    res.json({ success: true, coupons: data || [] });
});

// Admin: Create coupon
app.post('/api/admin/coupons', authMiddleware, adminMiddleware, async (req, res) => {
    const { code, type, value, maxUses, expiry, productIds, minOrderValue } = req.body;
    if (!code || !type || !value) return res.status(400).json({ success: false, message: 'Thieu thong tin' });

    const { data, error } = await supabase.from('coupons').insert({
        code: code.toUpperCase(),
        type,
        value: parseInt(value),
        min_order_value: minOrderValue ? parseInt(minOrderValue) : 0,
        max_uses: maxUses ? parseInt(maxUses) : null,
        uses: 0,
        expiry: expiry || null,
        product_ids: productIds || [],
        active: true
    }).select().single();

    if (error) {
        if (error.code === '23505') return res.status(400).json({ success: false, message: 'Ma da ton tai' });
        return res.status(500).json({ success: false, message: 'Loi tao ma: ' + error.message });
    }

    auditLog('COUPON_CREATED', { code, adminId: req.user.id });
    res.json({ success: true, message: 'Tao ma thanh cong!', coupon: data });
});

// Admin: Delete coupon
app.delete('/api/admin/coupons/:id', authMiddleware, adminMiddleware, async (req, res) => {
    const { error } = await supabase.from('coupons').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ success: false, message: 'Loi xoa ma' });
    auditLog('COUPON_DELETED', { couponId: req.params.id, adminId: req.user.id });
    res.json({ success: true, message: 'Xoa ma thanh cong!' });
});

// ====== CONTACT FORM → TELEGRAM ======
app.post('/api/contact', async (req, res) => {
    const { name, zalo, subject, message } = req.body;
    if (!name || !zalo || !subject || !message) {
        return res.status(400).json({ success: false, message: 'Vui long dien day du thong tin' });
    }

    const subjectMap = {
        'buy': 'Mua tai khoan',
        'support': 'Ho tro ky thuat',
        'refund': 'Hoan tien',
        'partner': 'Hop tac',
        'other': 'Khac'
    };

    const text = `📩 <b>TIN NHAN LIEN HE MOI</b>\n\n👤 <b>Ho ten:</b> ${name}\n📱 <b>Zalo:</b> ${zalo}\n📋 <b>Chu de:</b> ${subjectMap[subject] || subject}\n💬 <b>Noi dung:</b>\n${message}\n\n🕐 ${new Date().toLocaleString('vi-VN')}`;

    try {
        await sendTelegramNotification(text);
    } catch (err) {
        console.error('[CONTACT] Telegram send error:', err.message);
    }

    auditLog('CONTACT_FORM', { name, zalo, subject });
    res.json({ success: true, message: 'Gui tin nhan thanh cong!' });
});

// ═══════════════════════════════════════════════════════════
// 🚀 PREORDER ROUTES (Antigravity Ultra)
// ═══════════════════════════════════════════════════════════

// GET /api/preorders — public list of all preorders
app.get('/api/preorders', async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('preorders')
            .select('*')
            .order('group_number', { ascending: true })
            .order('created_at', { ascending: true });
        if (error) return res.status(500).json({ success: false, message: 'Loi tai danh sach dat truoc' });

        // Group entries by group_number
        const groups = {};
        (data || []).forEach(entry => {
            if (!groups[entry.group_number]) groups[entry.group_number] = [];
            groups[entry.group_number].push({
                id: entry.id,
                groupNumber: entry.group_number,
                fullName: entry.full_name,
                email: entry.email,
                phone: entry.phone,
                note: entry.note,
                createdAt: entry.created_at,
            });
        });

        // Find current open group (< 5 entries)
        let currentGroup = 1;
        const groupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
        if (groupNums.length > 0) {
            const lastGroup = groupNums[groupNums.length - 1];
            if (groups[lastGroup].length >= 5) {
                currentGroup = lastGroup + 1;
            } else {
                currentGroup = lastGroup;
            }
        }

        res.json({
            success: true,
            groups,
            currentGroup,
            currentGroupCount: groups[currentGroup] ? groups[currentGroup].length : 0,
            totalEntries: data ? data.length : 0,
        });
    } catch (err) {
        console.error('[PREORDERS GET ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Loi server' });
    }
});

// POST /api/preorders — submit a new preorder
app.post('/api/preorders', async (req, res) => {
    try {
        const { fullName, email, phone, note } = req.body;

        // Validate
        if (!fullName || !fullName.trim()) return res.status(400).json({ success: false, message: 'Vui lòng nhập họ tên' });
        if (!email || !email.trim()) return res.status(400).json({ success: false, message: 'Vui lòng nhập email' });
        if (!phone || !phone.trim()) return res.status(400).json({ success: false, message: 'Vui lòng nhập số điện thoại/Zalo' });

        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRe.test(email.trim())) return res.status(400).json({ success: false, message: 'Email không hợp lệ' });

        const emailLower = email.trim().toLowerCase();

        // Check duplicate email across ALL groups
        const { data: existing } = await supabase
            .from('preorders').select('id').eq('email', emailLower);
        if (existing && existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Email này đã đăng ký đặt trước rồi!' });
        }

        // Determine current group number
        const { data: allEntries } = await supabase
            .from('preorders').select('group_number').order('group_number', { ascending: true });

        let currentGroup = 1;
        if (allEntries && allEntries.length > 0) {
            const groupCounts = {};
            allEntries.forEach(e => {
                groupCounts[e.group_number] = (groupCounts[e.group_number] || 0) + 1;
            });
            const groupNums = Object.keys(groupCounts).map(Number).sort((a, b) => a - b);
            const lastGroup = groupNums[groupNums.length - 1];
            if (groupCounts[lastGroup] >= 5) {
                currentGroup = lastGroup + 1; // Auto-create new group
            } else {
                currentGroup = lastGroup;
            }
        }

        // Insert
        const newEntry = {
            group_number: currentGroup,
            full_name: fullName.trim(),
            email: emailLower,
            phone: phone.trim(),
            note: note ? note.trim() : null,
        };

        const { data: inserted, error } = await supabase
            .from('preorders').insert(newEntry).select().single();
        if (error) {
            console.error('[PREORDER INSERT ERROR]', error.message);
            return res.status(500).json({ success: false, message: 'Lỗi lưu đăng ký' });
        }

        // Get updated count for this group
        const { data: groupEntries } = await supabase
            .from('preorders').select('id').eq('group_number', currentGroup);
        const groupCount = groupEntries ? groupEntries.length : 1;

        // Telegram notification
        const text = `<b>DANG KY DAT TRUOC MOI</b>\n\n<b>San pham:</b> Antigravity Ultra\n<b>Ho ten:</b> ${fullName.trim()}\n<b>Email:</b> ${emailLower}\n<b>SDT/Zalo:</b> ${phone.trim()}\n<b>Ghi chu:</b> ${note ? note.trim() : 'Khong co'}\n\n<b>Nhom #${currentGroup}</b> — ${groupCount}/5 slot\n${new Date().toLocaleString('vi-VN')}`;

        try {
            await sendTelegramNotification(text);
        } catch (err) {
            console.error('[PREORDER] Telegram error:', err.message);
        }

        auditLog('PREORDER_SUBMITTED', { fullName: fullName.trim(), email: emailLower, phone: phone.trim(), groupNumber: currentGroup });

        res.json({
            success: true,
            message: `Đăng ký thành công! Bạn ở Nhóm #${currentGroup} (${groupCount}/5)`,
            entry: inserted,
            groupNumber: currentGroup,
            groupCount,
        });
    } catch (err) {
        console.error('[PREORDER POST ERROR]', err.message);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, _req, res, _next) => {
    auditLog('SERVER_ERROR', { message: err.message });
    res.status(500).json({ success: false, message: 'Loi may cđủ nội bộ' });
});

// ������ START SERVER (local dev) / EXPORT (Vercel) ��������������������
module.exports = app;

if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`\n  �xa� AI4DEV Server  �   http://localhost:${PORT}`);
        console.log(`  �x️  Database       �   Supabase`);
        console.log(`  �x�  Email          �   ${emailTransporter ? 'Configured' : 'Not configured (console mode)'}\n`);
    });
}
