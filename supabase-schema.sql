-- ============================================
-- AI4DEV — Supabase Database Schema
-- ============================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── USERS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    phone_zalo TEXT,
    bank_account TEXT,
    bank_name TEXT,
    balance INTEGER NOT NULL DEFAULT 0,
    email_verified BOOLEAN NOT NULL DEFAULT false,
    profile_completed BOOLEAN NOT NULL DEFAULT false,
    referral_code TEXT UNIQUE,                          -- Mã giới thiệu duy nhất của user
    referred_by UUID REFERENCES users(id),              -- User ID của người đã giới thiệu
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);

-- ─── PRODUCTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    short_name TEXT,
    category TEXT,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    original_price INTEGER DEFAULT 0,
    purchases INTEGER NOT NULL DEFAULT 0,
    rating NUMERIC(2,1) DEFAULT 0,
    review_count INTEGER NOT NULL DEFAULT 0,
    is_hot BOOLEAN NOT NULL DEFAULT false,
    is_trending BOOLEAN NOT NULL DEFAULT false,
    is_new BOOLEAN NOT NULL DEFAULT false,
    features JSONB DEFAULT '[]'::jsonb,
    account_types JSONB DEFAULT '[]'::jsonb,
    video_url TEXT,
    docs TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── ORDERS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT,
    user_email TEXT,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT,
    account_type TEXT,
    account_type_label TEXT,
    duration INTEGER,
    price INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    credentials JSONB,
    report_issue JSONB,
    referred_by UUID REFERENCES users(id),              -- Người giới thiệu (để tính hoa hồng)
    commission_rate INTEGER DEFAULT 10,                 -- % hoa hồng (mặc định 10%)
    commission_amount INTEGER DEFAULT 0,                -- Số tiền hoa hồng đã tính
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- ─── REVIEWS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    text TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_product_id ON reviews(product_id);

-- ─── COMMENTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_product_id ON comments(product_id);

-- ─── DEPOSITS TABLE (SePay auto top-up) ────────
CREATE TABLE deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sepay_transaction_id BIGINT UNIQUE NOT NULL,
    user_id UUID REFERENCES users(id),
    amount INTEGER NOT NULL,
    content TEXT,
    reference_code TEXT,
    status TEXT DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);

-- Add deposit_code column to users for short code matching
ALTER TABLE users ADD COLUMN IF NOT EXISTS deposit_code TEXT;

-- ─── REFERRAL TRACKING (Migration) ─────────────
-- Chạy migration này nếu bảng users/orders đã tồn tại
ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_users_referred_by ON users(referred_by);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS referred_by UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_rate INTEGER DEFAULT 10;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS commission_amount INTEGER DEFAULT 0;

-- ─── RPC FUNCTIONS ─────────────────────────────
CREATE OR REPLACE FUNCTION increment_purchases(product_id_input UUID)
RETURNS void AS $$
BEGIN
    UPDATE products SET purchases = purchases + 1 WHERE id = product_id_input;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SEED DATA — Products
-- ============================================

INSERT INTO products (name, short_name, category, description, price, original_price, purchases, rating, review_count, is_hot, is_trending, is_new, features, account_types, video_url, docs) VALUES

('ChatGPT Plus', 'GPT+', 'AI Chat',
 'Tài khoản ChatGPT Plus chính hãng, truy cập GPT-4o, GPT-4, DALL-E 3, Advanced Data Analysis. Trải nghiệm AI tốt nhất từ OpenAI với tốc độ nhanh hơn và ưu tiên truy cập khi cao điểm.',
 350000, 500000, 1847, 4.8, 342, true, true, false,
 '["Truy cập GPT-4o & GPT-4", "Tạo ảnh DALL-E 3", "Phân tích dữ liệu nâng cao", "Ưu tiên truy cập"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":350000,"3":900000,"6":1600000,"12":2800000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":500000,"3":1350000,"6":2500000,"12":4500000}}]',
 'https://www.youtube.com/embed/dQw4w9WgXcQ',
 '<h2>Hướng dẫn sử dụng ChatGPT Plus</h2><h3>Bước 1: Đăng nhập</h3><p>Truy cập <code>chat.openai.com</code> và đăng nhập bằng tài khoản đã được cung cấp.</p><h3>Bước 2: Chọn model</h3><p>Sau khi đăng nhập, bạn có thể chọn giữa các model: GPT-4o, GPT-4, GPT-3.5.</p><h3>Bước 3: Sử dụng các tính năng nâng cao</h3><p>Bạn có thể sử dụng Advanced Data Analysis, DALL-E 3, và Browse with Bing.</p><h3>Lưu ý quan trọng</h3><p>Không chia sẻ tài khoản với người khác. Không thay đổi mật khẩu.</p>'),

('Claude Pro', 'Claude', 'AI Chat',
 'Tài khoản Claude Pro từ Anthropic. Truy cập Claude 3.5 Sonnet, Opus với giới hạn cao hơn. AI thông minh nhất cho coding và phân tích văn bản dài.',
 400000, 550000, 1205, 4.9, 218, true, false, false,
 '["Claude 3.5 Sonnet & Opus", "Cửa sổ ngữ cảnh mở rộng", "Ưu tiên truy cập", "Giới hạn sử dụng cao hơn"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":400000,"3":1050000,"6":1900000,"12":3400000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":550000,"3":1450000,"6":2700000,"12":4800000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Claude Pro</h2><h3>Bước 1: Đăng nhập</h3><p>Truy cập <code>claude.ai</code> và đăng nhập bằng tài khoản đã cung cấp.</p><h3>Bước 2: Chọn model</h3><p>Chọn Claude 3.5 Sonnet cho công việc hàng ngày hoặc Opus cho tác vụ phức tạp.</p>'),

('GitHub Copilot Pro', 'Copilot', 'AI Coding',
 'Tài khoản GitHub Copilot Pro cho developer. Gợi ý code thông minh, chat với AI ngay trong IDE. Hỗ trợ VS Code, JetBrains, Neovim.',
 250000, 380000, 2156, 4.7, 456, true, true, false,
 '["Gợi ý code trong IDE", "Chat với Copilot", "Hỗ trợ đa ngôn ngữ", "VS Code & JetBrains"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":250000,"3":650000,"6":1200000,"12":2100000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":380000,"3":1000000,"6":1850000,"12":3300000}}]',
 '',
 '<h2>Hướng dẫn sử dụng GitHub Copilot</h2><h3>Bước 1: Cài đặt extension</h3><p>Cài đặt GitHub Copilot extension trong VS Code hoặc JetBrains IDE.</p><h3>Bước 2: Đăng nhập</h3><p>Đăng nhập vào GitHub bằng tài khoản đã cung cấp trong IDE.</p>'),

('Midjourney Pro', 'MJ', 'AI Image',
 'Tài khoản Midjourney Pro Plan. Tạo hình ảnh AI chất lượng cao, 30h Fast GPU time/tháng, Stealth mode, unlimited Relax generations.',
 600000, 800000, 892, 4.6, 167, false, true, false,
 '["30 giờ Fast GPU/tháng", "Chế độ ẩn danh", "Relax không giới hạn", "Giấy phép thương mại"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":600000,"3":1550000,"6":2800000,"12":5000000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":800000,"3":2100000,"6":3800000,"12":6800000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Midjourney</h2><h3>Bước 1: Truy cập Discord</h3><p>Đăng nhập Discord và tham gia server Midjourney.</p><h3>Bước 2: Sử dụng lệnh /imagine</h3><p>Gõ <code>/imagine</code> trong kênh chat và nhập mô tả hình ảnh bạn muốn tạo.</p>'),

('Cursor Pro', 'Cursor', 'AI Coding',
 'Tài khoản Cursor Pro - AI code editor tốt nhất hiện nay. Tích hợp GPT-4, Claude cho coding. Auto-complete, refactor, debug thông minh.',
 450000, 600000, 1534, 4.8, 289, true, true, true,
 '["Tích hợp GPT-4 & Claude", "Auto-complete thông minh", "AI refactoring", "Chat theo codebase"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":450000,"3":1200000,"6":2100000,"12":3800000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":600000,"3":1600000,"6":2900000,"12":5200000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Cursor Pro</h2><h3>Bước 1: Tải Cursor</h3><p>Tải Cursor từ <code>cursor.sh</code> và cài đặt.</p><h3>Bước 2: Đăng nhập</h3><p>Mở Cursor, đăng nhập bằng tài khoản đã cung cấp.</p>'),

('Notion AI', 'Notion', 'AI Productivity',
 'Tài khoản Notion Plus với AI. Viết, tóm tắt, dịch, tạo nội dung tự động. Hoàn hảo cho quản lý dự án và ghi chú.',
 200000, 300000, 678, 4.5, 134, false, false, false,
 '["Trợ lý viết AI", "Tóm tắt tự động", "Dịch thuật", "Hỏi đáp trên tài liệu"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":200000,"3":520000,"6":950000,"12":1700000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":300000,"3":800000,"6":1450000,"12":2600000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Notion AI</h2><h3>Bước 1: Đăng nhập Notion</h3><p>Truy cập <code>notion.so</code> và đăng nhập.</p><h3>Bước 2: Sử dụng AI</h3><p>Trong bất kỳ trang nào, nhấn Space để gọi AI.</p>'),

('Perplexity Pro', 'Perp', 'AI Search',
 'Tài khoản Perplexity Pro - AI search engine thế hệ mới. Tìm kiếm thông minh với nguồn trích dẫn rõ ràng. 300+ Pro searches/ngày.',
 300000, 450000, 543, 4.7, 98, false, false, true,
 '["300+ tìm kiếm Pro/ngày", "Hỗ trợ GPT-4", "Upload file", "Truy cập API"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":300000,"3":780000,"6":1400000,"12":2500000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":450000,"3":1200000,"6":2150000,"12":3900000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Perplexity Pro</h2><h3>Bước 1: Đăng nhập</h3><p>Truy cập <code>perplexity.ai</code> và đăng nhập.</p><h3>Bước 2: Sử dụng Pro Search</h3><p>Bật toggle "Pro" trước khi tìm kiếm.</p>'),

('Gemini Advanced', 'Gemini', 'AI Chat',
 'Tài khoản Google Gemini Advanced với Gemini Ultra. Tích hợp Google Workspace, 2TB storage, tính năng AI tiên tiến nhất từ Google.',
 350000, 500000, 967, 4.6, 178, false, true, false,
 '["Model Gemini Ultra", "2TB Google One", "Tích hợp Workspace", "Ưu tiên truy cập"]',
 '[{"type":"shared","label":"Tài khoản cấp","prices":{"1":350000,"3":900000,"6":1650000,"12":2900000}},{"type":"owned","label":"Chính chủ (nâng cấp)","prices":{"1":500000,"3":1350000,"6":2450000,"12":4400000}}]',
 '',
 '<h2>Hướng dẫn sử dụng Gemini Advanced</h2><h3>Bước 1: Đăng nhập Google</h3><p>Đăng nhập tài khoản Google đã cung cấp tại <code>gemini.google.com</code>.</p><h3>Bước 2: Chọn Gemini Ultra</h3><p>Chọn model Ultra để sử dụng phiên bản mạnh nhất.</p>');

--  FLASH SALES ───────────
CREATE TABLE IF NOT EXISTS flash_sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title TEXT DEFAULT 'FLASH SALE',
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    discount_percent INTEGER NOT NULL DEFAULT 10,
    end_date TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flash_sales_product_id ON flash_sales(product_id);
CREATE INDEX IF NOT EXISTS idx_flash_sales_end_date ON flash_sales(end_date);

-- ─── AFFILIATE COMMISSION RATE PER USER ─────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_rate INTEGER DEFAULT 10;

-- ─── GUEST CHECKOUT (Migration) ─────────────────────
-- Cho phép user_id NULL (khách vãng lai không có tài khoản)
ALTER TABLE orders ALTER COLUMN user_id DROP NOT NULL;

-- Thông tin khách vãng lai
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;  -- Zalo / SĐT
ALTER TABLE orders ADD COLUMN IF NOT EXISTS affiliate_id UUID REFERENCES users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_code TEXT UNIQUE; -- Mã đơn cho SePay matching
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'; -- unpaid / paid

-- Index cho guest checkout & fingerprinting
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_affiliate_id ON orders(affiliate_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_code ON orders(order_code);

-- ─── COUPONS (Mã giảm giá) ─────────────────────
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    type TEXT NOT NULL DEFAULT 'percent',  -- 'percent' hoặc 'fixed'
    value INTEGER NOT NULL DEFAULT 0,
    min_order_value INTEGER DEFAULT 0,     -- Giá trị đơn hàng tối thiểu để áp dụng mã
    max_uses INTEGER,
    uses INTEGER DEFAULT 0,
    expiry TIMESTAMPTZ,
    product_ids UUID[] DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Migration: thêm cột min_order_value nếu bảng đã tồn tại
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS min_order_value INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- ─── PREORDERS (Antigravity Ultra) ──────────────
CREATE TABLE IF NOT EXISTS preorders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_number INTEGER NOT NULL DEFAULT 1,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_preorders_group ON preorders(group_number);
CREATE INDEX IF NOT EXISTS idx_preorders_email ON preorders(email);
