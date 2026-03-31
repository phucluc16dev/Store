// ===== AI4DEV - Main Application =====

// --- State ---
let currentPage = 'home';
let currentUser = Storage.get('currentUser');
let authToken   = localStorage.getItem('authToken') || null;
let selectedRating = 0;
let _productsCache = [];
let _flashSalesCache = [];
let _flashSaleTimer = null;

// Helper: get lowest available price from product accountTypes
function getLowestPrice(product) {
    if (!product.accountTypes || !product.accountTypes.length) return product.price;
    for (const m of [1, 3, 6, 12]) {
        const p = product.accountTypes[0]?.prices?.[m];
        if (p && p > 0) return p;
    }
    return product.price;
}
// ─── THEME TOGGLE ───────────────────────────────
function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    updateThemeIcon(next);
}

function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (!icon) return;
    if (theme === 'light') {
        // Moon icon for "switch to dark"
        icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    } else {
        // Sun icon for "switch to light"
        icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
    }
}

// Init theme on load
initTheme();

// ─── REFERRAL TRACKING ─────────────────────────
// Bắt tham số ?ref= từ URL và lưu vào Cookie 30 ngày
function captureReferralCode() {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    if (refCode && refCode.trim()) {
        // Lưu referral_code vào Cookie với thời gian sống 30 ngày
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);
        document.cookie = `referral_code=${encodeURIComponent(refCode.trim())};expires=${expires.toUTCString()};path=/;SameSite=Lax`;
        
        // Xóa ?ref= khỏi URL để giao diện sạch hơn
        params.delete('ref');
        const cleanUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
        history.replaceState(null, '', cleanUrl);
    }
}

// Đọc referral_code từ Cookie
function getReferralCode() {
    const match = document.cookie.match(/(?:^|;\s*)referral_code=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
}

// Load products from API into cache
async function loadProducts() {
    try {
        const data = await Api.get('/products');
        if (data.success) _productsCache = data.products || [];
    } catch (e) {
        console.error('Failed to load products:', e);
    }
    return _productsCache;
}

// --- Header Dropdown ---
function toggleHeaderDrop(id) {
    const drop = document.getElementById(id);
    const wrap = drop?.closest('.header-dropdown-wrap');
    const isOpen = drop?.classList.contains('open');
    closeHeaderDrops();
    if (!isOpen) {
        drop?.classList.add('open');
        wrap?.classList.add('open');
    }
}
function closeHeaderDrops() {
    document.querySelectorAll('.header-dropdown.open').forEach(d => d.classList.remove('open'));
    document.querySelectorAll('.header-dropdown-wrap.open').forEach(w => w.classList.remove('open'));
}
document.addEventListener('click', e => {
    if (!e.target.closest('.header-dropdown-wrap')) closeHeaderDrops();
});

// --- API Helper ---
const Api = {
    async call(endpoint, method = 'GET', body = null) {
        // If running as file:// (not via server), the API will not work
        if (location.protocol === 'file:') {
            throw new Error('Vui lòng mở trang qua http://localhost:3000 thay vì mở file trực tiếp!');
        }
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
        const opts = { method, headers };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch('/api' + endpoint, opts);
        if (!res.ok && res.status === 0) {
            throw new Error('Không thể kết nối server. Đảm bảo server đang chạy trên port 3000.');
        }
        // Handle expired/invalid token globally
        if (res.status === 401) {
            const data = await res.json();
            // Auto-logout and redirect to login
            authToken = null;
            currentUser = null;
            localStorage.removeItem('authToken');
            Storage.remove('currentUser');
            updateAuthUI();
            showToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'error');
            navigate('login');
            throw new Error('SESSION_EXPIRED');
        }
        return res.json();
    },
    post(endpoint, body) { return this.call(endpoint, 'POST', body); },
    put(endpoint, body)  { return this.call(endpoint, 'PUT', body); },
    get(endpoint)        { return this.call(endpoint, 'GET'); },
    delete(endpoint)     { return this.call(endpoint, 'DELETE'); },
};

// --- Form Validation Helpers ---
function clearFormErrors(ids) {
    ids.forEach(id => {
        const el = document.getElementById(id + 'Error');
        if (el) el.textContent = '';
        const input = document.getElementById(id);
        if (input) input.classList.remove('input-error');
    });
}

function showFieldErrors(errors) {
    Object.entries(errors).forEach(([field, msg]) => {
        const errEl = document.getElementById(field + 'Error');
        if (errEl) errEl.textContent = msg;
        const input = document.getElementById(field);
        if (input) input.classList.add('input-error');
    });
}

// --- Routing ---
const routes = {
    '/trang-chu': 'home',
    '/san-pham': 'products',
    '/khach-hang': 'customers',
    '/blog': 'blog',
    '/lien-he': 'contact',
    '/dang-nhap': 'login',
    '/dang-ky': 'register',
    '/hoan-thien-ho-so': 'complete-profile',
    '/admin': 'admin',
    '/ho-so': 'profile',
    '/xac-thuc-email': 'verify-email',
    '/quen-mat-khau': 'forgot-password',
    '/dat-lai-mat-khau': 'reset-password',
    '/don-hang': 'orders',
    '/nap-tien': 'deposit',
    '/cong-tac-vien': 'affiliate',
    '/bao-hanh': 'warranty',
    '/dat-truoc': 'preorder'
};

const routeReverse = Object.fromEntries(Object.entries(routes).map(([k, v]) => [v, k]));

function getPageFromUrl() {
    const path = window.location.pathname;
    let page = 'home';
    let params = {};

    if (path.startsWith('/san-pham/') && path.length > '/san-pham/'.length) {
        const slug = path.replace('/san-pham/', '');
        const found = _productsCache.find(p => slugify(p.name) === slug);
        return { page: 'product-detail', params: { id: found ? found.id : slug } };
    }
    if (path.startsWith('/blog/') && path.length > '/blog/'.length) {
        return { page: 'blog-detail', params: { id: path.replace('/blog/', '') } };
    }

    const match = Object.keys(routes).find(r => r === path);
    if (match) page = routes[match];

    const searchParams = new URLSearchParams(window.location.search);
    if (page === 'admin' && searchParams.has('tab')) params.tab = searchParams.get('tab');
    if (page === 'reset-password' && searchParams.has('email')) params.email = searchParams.get('email');
    if (page === 'product-detail' && searchParams.has('id')) params.id = searchParams.get('id');

    return { page, params };
}

function getUrlFromPage(page, params) {
    if (page === 'product-detail') {
        if (params?.slug) return '/san-pham/' + params.slug;
        const prod = _productsCache.find(p => p.id === params?.id);
        return '/san-pham/' + (prod ? slugify(prod.name) : (params?.id || ''));
    }
    if (page === 'blog-detail') return '/blog/' + (params?.id || '');
    
    let url = routeReverse[page] || '/trang-chu';
    
    if (page === 'admin' && params?.tab) url += '?tab=' + params.tab;
    if (page === 'reset-password' && params?.email) url += '?email=' + encodeURIComponent(params.email);
    
    return url;
}

// --- Init ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadProducts();
    updateAuthUI();
    
    // Bắt referral code từ URL (nếu có ?ref=xxx)
    captureReferralCode();
    
    const initialRoute = getPageFromUrl();
    navigate(initialRoute.page, initialRoute.params, false);

    window.addEventListener('popstate', (e) => {
        if (e.state) {
            navigate(e.state.page, e.state.params || {}, false);
        } else {
            const currentRoute = getPageFromUrl();
            navigate(currentRoute.page, currentRoute.params, false);
        }
    });

    // BlurText: animate when scrolled into view
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate');
            }
        });
    }, { threshold: 0.5 });
    document.querySelectorAll('.blur-text').forEach(el => observer.observe(el));

    // Load initial data
    loadBanners();
    loadFlashSales();
});

// --- Navigation ---
function navigate(page, params = {}, pushState = true) {
    currentPage = page;
    const main = document.getElementById('mainContent');

    if (pushState) {
        const newUrl = getUrlFromPage(page, params);
        if (window.location.pathname + window.location.search !== newUrl) {
            history.pushState({ page, params }, '', newUrl);
        }
    }

    // Update nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.toggle('active', link.dataset.page === page);
    });

    // Close mobile menu
    document.getElementById('nav').classList.remove('open');

    // Stop DarkVeil when leaving home
    stopDarkVeil();

    // Render page
    switch (page) {
        case 'home':
            main.innerHTML = renderHomePage();
            setTimeout(() => startDarkVeil(), 50);
            break;
        case 'products':
            main.innerHTML = renderProductsPage(params);
            setTimeout(() => {
                renderBanners();
                renderFlashSaleSection();
                // Stagger fade-in animation for product cards
                document.querySelectorAll('#productsGrid .product-card').forEach((card, i) => {
                    card.style.opacity = '0';
                    card.style.animationDelay = `${i * 0.06}s`;
                    card.classList.add('animate-in');
                });
            }, 50);
            break;
        case 'product-detail':
            main.innerHTML = renderProductDetailPage(params.id);
            break;
        case 'login':
            main.innerHTML = renderLoginPage();
            break;
        case 'register':
            // Đăng ký đã bị tắt — chuyển về trang đăng nhập
            showToast('Chức năng đăng ký đã tạm dừng. Vui lòng mua hàng trực tiếp không cần tài khoản.', 'info');
            navigate('login');
            return;
        case 'complete-profile':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderCompleteProfilePage();
            break;
        case 'admin':
            if (!isAdmin()) {
                showToast('Bạn không có quyền truy cập trang Admin', 'error');
                navigate('home');
                return;
            }
            main.innerHTML = renderAdminPage(params.tab || 'dashboard');
            setTimeout(() => drawRevenueChart(), 50);
            if ((params.tab || 'dashboard') === 'orders') setTimeout(() => loadAdminOrders(), 50);
            break;
        case 'customers':
            main.innerHTML = renderCustomersPage();
            break;
        case 'blog':
            main.innerHTML = renderBlogPage();
            break;
        case 'blog-detail':
            main.innerHTML = renderBlogDetailPage(params.id);
            break;
        case 'contact':
            main.innerHTML = renderContactPage();
            break;
        case 'warranty':
            main.innerHTML = renderWarrantyPage();
            break;
        case 'profile':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderProfilePage();
            break;
        case 'verify-email':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderVerifyEmailPage();
            break;
        case 'forgot-password':
            main.innerHTML = renderForgotPasswordPage();
            break;
        case 'reset-password':
            main.innerHTML = renderResetPasswordPage(params.email);
            break;
        case 'orders':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderOrdersPage();
            loadUserOrders();
            break;
        case 'deposit':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderDepositPage();
            loadDepositInfo();
            break;
        case 'affiliate':
            if (!isLoggedIn()) { navigate('login'); return; }
            main.innerHTML = renderAffiliatePage();
            loadAffiliateDashboard();
            break;
        case 'preorder':
            main.innerHTML = renderPreorderPage();
            loadPreorders();
            break;
        default:
            main.innerHTML = renderHomePage();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Re-observe BlurText elements after page render
    document.querySelectorAll('.blur-text:not(.animate)').forEach(el => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate');
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.3 });
        observer.observe(el);
    });
}

// --- Orders Page ---
function renderOrdersPage() {
    return `
        <div class="container">
            <section class="section">
                <div class="section-header">
                    <h2 class="section-title">Đơn hàng của tôi</h2>
                    <p class="section-subtitle">Theo dõi trạng thái và lịch sử mua hàng</p>
                </div>
                <div id="ordersContainer">
                    <div style="text-align:center;padding:40px;color:var(--text-tertiary);">Đang tải đơn hàng...</div>
                </div>
            </section>
        </div>
    `;
}

function loadUserOrders() {
    Api.get('/orders')
        .then(data => {
            if (data.success) renderOrdersList(data.orders);
            else showToast('Không thể tải đơn hàng', 'error');
        })
        .catch(() => showToast('Lỗi kết nối', 'error'));
}

function renderOrdersList(orders) {
    const container = document.getElementById('ordersContainer');
    if (!container) return;

    if (!orders || orders.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-title">Chưa có đơn hàng nào</div>
                <p style="color:var(--text-secondary);margin-bottom:16px;">Hãy mua sản phẩm đầu tiên của bạn!</p>
                <a href="/san-pham" class="btn btn-primary" onclick="event.preventDefault(); navigate('products')">Xem sản phẩm</a>
            </div>`;
        return;
    }

    // SVG icons (Lucide style - shadcn/ui)
    const icons = {
        clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
        loader: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
        checkCircle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
        xCircle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        alertTriangle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
        coins: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/></svg>',
        calendar: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
        copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
        user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
        shield: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
        hash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
        fileText: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    };

    const statusMap = {
        'pending': { label: 'Chờ xử lý', color: 'var(--orange)', icon: icons.clock },
        'processing': { label: 'Đang xử lý', color: 'var(--blue)', icon: icons.loader },
        'completed': { label: 'Hoàn thành', color: 'var(--green)', icon: icons.checkCircle },
        'cancelled': { label: 'Đã hủy', color: 'var(--red)', icon: icons.xCircle },
        'reported': { label: 'Đã báo lỗi', color: 'var(--red)', icon: icons.alertTriangle },
    };

    // Store orders globally for PDF export
    window._ordersData = orders;

    container.innerHTML = orders.map(o => {
        const st = statusMap[o.status] || statusMap.pending;
        const date = new Date(o.createdAt);
        const dateStr = date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
        const timeStr = date.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
        const shortId = o.id.slice(-8).toUpperCase();
        const hasCreds = o.credentials && o.credentials.email;
        const isOwned = o.accountType === 'owned';

        // Credentials / Status section
        let credentialsHTML = '';
        if (isOwned) {
            // Owned (chính chủ): simple upgrade status - no credentials needed
            if (o.status === 'completed') {
                credentialsHTML = `
                    <div class="credentials-section credentials-revealed">
                        <div class="credentials-header">
                            <span class="credentials-title">${icons.checkCircle} Đã nâng cấp thành công!</span>
                        </div>
                        <div style="padding:12px 16px; font-size:13px; color:var(--text-secondary); line-height:1.6;">
                            <p style="margin:0;">Tài khoản <b style="color:var(--accent);">${o.upgradeEmail || ''}</b> đã được nâng cấp.</p>
                            <p style="margin:4px 0 0;">Bạn có thể đăng nhập và sử dụng ngay.</p>
                        </div>
                    </div>`;
            } else if (o.status === 'cancelled') {
                credentialsHTML = '';
            } else {
                credentialsHTML = `
                    <div class="credentials-section credentials-waiting">
                        <div class="credentials-header">
                            <span class="credentials-title">${icons.clock} Đang chờ admin nâng cấp tài khoản...</span>
                        </div>
                        <div style="padding:12px 16px; font-size:13px; color:var(--text-secondary); line-height:1.6;">
                            <p style="margin:0;">Email nâng cấp: <b style="color:var(--white);">${o.upgradeEmail || ''}</b></p>
                            <p style="margin:4px 0 0;">Admin sẽ xử lý trong vòng 1-24 giờ. Bạn sẽ nhận thông báo khi hoàn tất.</p>
                        </div>
                    </div>`;
            }
        } else if (hasCreds) {
            credentialsHTML = `
                <div class="credentials-section credentials-revealed">
                    <div class="credentials-header">
                        <span class="credentials-title">${icons.checkCircle} Thông tin tài khoản</span>
                    </div>
                    <div class="credential-fields">
                        <div class="credential-field">
                            <label class="credential-label">${icons.user} Tài khoản</label>
                            <div class="credential-value-row">
                                <span class="credential-value" id="cred_email_${o.id}">${o.credentials.email}</span>
                                <button class="credential-copy-btn" onclick="copyCredential('cred_email_${o.id}')" title="Sao chép">${icons.copy}</button>
                            </div>
                        </div>
                        <div class="credential-field">
                            <label class="credential-label">${icons.lock} Mật khẩu</label>
                            <div class="credential-value-row">
                                <span class="credential-value" id="cred_pass_${o.id}">${o.credentials.password}</span>
                                <button class="credential-copy-btn" onclick="copyCredential('cred_pass_${o.id}')" title="Sao chép">${icons.copy}</button>
                            </div>
                        </div>
                        <div class="credential-field">
                            <label class="credential-label">${icons.shield} Mã 2FA</label>
                            <div class="credential-value-row">
                                <span class="credential-value" id="cred_2fa_${o.id}">${o.credentials.code2fa || 'Không có'}</span>
                                <button class="credential-copy-btn" onclick="copyCredential('cred_2fa_${o.id}')" title="Sao chép">${icons.copy}</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        } else {
            credentialsHTML = `
                <div class="credentials-section credentials-waiting">
                    <div class="credentials-header">
                        <span class="credentials-title">${icons.clock} Đang chờ admin gửi thông tin tài khoản...</span>
                    </div>
                    <div class="credential-fields">
                        <div class="credential-field blurred">
                            <label class="credential-label">${icons.user} Tài khoản</label>
                            <div class="credential-value-row">
                                <span class="credential-value credential-skeleton">account@example.com</span>
                            </div>
                        </div>
                        <div class="credential-field blurred">
                            <label class="credential-label">${icons.lock} Mật khẩu</label>
                            <div class="credential-value-row">
                                <span class="credential-value credential-skeleton">••••••••••••</span>
                            </div>
                        </div>
                        <div class="credential-field blurred">
                            <label class="credential-label">${icons.shield} Mã 2FA</label>
                            <div class="credential-value-row">
                                <span class="credential-value credential-skeleton">000000</span>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
        <div class="card" style="margin-bottom:12px;">
            <div class="card-content" style="padding:16px 20px;">
                <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
                    <div>
                        <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">${o.productName}</h3>
                        <p style="font-size:12px;color:var(--text-tertiary);">${o.accountTypeLabel} &bull; ${o.duration} tháng</p>
                    </div>
                    <div style="text-align:right;">
                        <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${st.color}20;color:${st.color};">${st.icon} ${st.label}</span>
                    </div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                    <div style="font-size:13px;color:var(--text-secondary);display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                        <span style="display:inline-flex;align-items:center;gap:4px;font-family:monospace;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--bg-tertiary);color:var(--text-tertiary);">${icons.hash} ${shortId}</span>
                        <span style="display:inline-flex;align-items:center;gap:4px;">${icons.coins} ${formatPrice(o.price)}</span>
                        <span style="display:inline-flex;align-items:center;gap:4px;">${icons.calendar} ${dateStr} ${timeStr}</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;">
                        <button class="btn btn-ghost" style="padding:4px 12px;font-size:12px;color:var(--accent);display:inline-flex;align-items:center;gap:4px;" onclick="downloadInvoicePDF('${o.id}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            Xuat PDF
                        </button>
                        ${o.status !== 'cancelled' && o.status !== 'reported' ? `<button class="btn btn-ghost" style="padding:4px 12px;font-size:12px;color:var(--red);display:inline-flex;align-items:center;gap:4px;" onclick="showReportForm('${o.id}')">${icons.alertTriangle} Bao loi</button>` : ''}
                        ${o.reportIssue ? `<span style="font-size:12px;color:var(--text-tertiary);display:inline-flex;align-items:center;gap:4px;" title="${o.reportIssue.message}">${icons.fileText} ${o.reportIssue.resolved ? 'Da giai quyet' : 'Dang xu ly'}</span>` : ''}
                    </div>
                </div>
                ${credentialsHTML}
                <div id="reportForm_${o.id}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
                    <textarea class="form-textarea" id="reportMsg_${o.id}" placeholder="Mô tả lỗi bạn gặp phải..." style="min-height:60px;margin-bottom:8px;"></textarea>
                    <div style="display:flex;gap:8px;">
                        <button class="btn btn-primary btn-sm" onclick="reportOrderIssue('${o.id}')">Gửi báo cáo</button>
                        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('reportForm_${o.id}').style.display='none'">Hủy</button>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function showReportForm(orderId) {
    const form = document.getElementById('reportForm_' + orderId);
    if (form) form.style.display = 'block';
}

function reportOrderIssue(orderId) {
    const msg = document.getElementById('reportMsg_' + orderId);
    if (!msg || !msg.value.trim()) { showToast('Vui lòng nhập mô tả lỗi', 'error'); return; }

    Api.post('/orders/' + orderId + '/report', { message: msg.value.trim() })
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                loadUserOrders();
            } else {
                showToast(data.message, 'error');
            }
        })
        .catch(() => showToast('Loi ket noi', 'error'));
}

// --- PDF Invoice Export ---
function downloadInvoicePDF(orderId) {
    const orders = window._ordersData || [];
    const o = orders.find(x => x.id === orderId);
    if (!o) { showToast('Khong tim thay don hang', 'error'); return; }

    if (typeof window.jspdf === 'undefined') {
        showToast('Dang tai thu vien PDF...', 'info');
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js';
        script.onload = () => downloadInvoicePDF(orderId);
        document.head.appendChild(script);
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentW = pageW - margin * 2;
    let y = 20;

    // Helper: remove Vietnamese diacritics for PDF compatibility (Helvetica doesn't support Unicode)
    function removeDiacritics(str) {
        if (!str) return '';
        return str
            .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
            .replace(/[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, 'A')
            .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
            .replace(/[ÈÉẸẺẼÊỀẾỆỂỄ]/g, 'E')
            .replace(/[ìíịỉĩ]/g, 'i')
            .replace(/[ÌÍỊỈĨ]/g, 'I')
            .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
            .replace(/[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, 'O')
            .replace(/[ùúụủũưừứựửữ]/g, 'u')
            .replace(/[ÙÚỤỦŨƯỪỨỰỬỮ]/g, 'U')
            .replace(/[ỳýỵỷỹ]/g, 'y')
            .replace(/[ỲÝỴỶỸ]/g, 'Y')
            .replace(/[đ]/g, 'd')
            .replace(/[Đ]/g, 'D');
    }

    function safeText(text) {
        return removeDiacritics(text || '');
    }

    // ===== HEADER SECTION =====
    // Purple accent bar
    doc.setFillColor(168, 85, 247); // #a855f7
    doc.rect(0, 0, pageW, 4, 'F');

    // Company name
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(168, 85, 247);
    doc.text('AI4DEV', margin, y + 10);

    // Invoice title
    doc.setFontSize(16);
    doc.setTextColor(60, 60, 60);
    doc.text('HOA DON', pageW - margin, y + 10, { align: 'right' });

    y += 18;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('Tai khoan AI Premium chinh hang cho Developer', margin, y);
    doc.text('Zalo: 0367545048 | Telegram: @shopai4dev', margin, y + 5);

    y += 14;
    // Separator line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);

    // ===== ORDER INFO =====
    y += 10;
    const shortId = o.id.slice(-8).toUpperCase();
    const date = new Date(o.createdAt);
    const dateStr = date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

    const statusLabels = {
        'pending': 'Cho xu ly',
        'processing': 'Dang xu ly',
        'completed': 'Hoan thanh',
        'cancelled': 'Da huy',
        'reported': 'Da bao loi'
    };

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60, 60, 60);
    doc.text('THONG TIN DON HANG', margin, y);

    y += 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);

    const infoLeft = [
        ['Ma don hang:', '#' + shortId],
        ['Ngay dat:', dateStr + ' ' + timeStr],
        ['Trang thai:', statusLabels[o.status] || o.status],
    ];

    infoLeft.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(120, 120, 120);
        doc.text(safeText(label), margin, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(60, 60, 60);
        doc.text(safeText(value), margin + 40, y);
        y += 6;
    });

    // ===== PRODUCT TABLE =====
    y += 8;
    doc.setFillColor(245, 245, 250);
    doc.rect(margin, y, contentW, 10, 'F');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(80, 80, 80);
    doc.text('SAN PHAM', margin + 4, y + 7);
    doc.text('LOAI TK', margin + 75, y + 7);
    doc.text('THOI HAN', margin + 110, y + 7);
    doc.text('THANH TIEN', pageW - margin - 4, y + 7, { align: 'right' });

    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(40, 40, 40);
    doc.setFontSize(10);
    doc.text(safeText(o.productName), margin + 4, y);
    doc.setFontSize(9);
    doc.text(safeText(o.accountTypeLabel || o.accountType), margin + 75, y);
    doc.text((o.duration || 1) + ' thang', margin + 110, y);
    doc.setFont('helvetica', 'bold');
    doc.text(formatPrice(o.price), pageW - margin - 4, y, { align: 'right' });

    y += 4;
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageW - margin, y);

    // ===== PRICING SUMMARY =====
    y += 10;
    const summaryX = pageW - margin - 80;

    // Subtotal
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('Tam tinh:', summaryX, y);
    doc.setTextColor(40, 40, 40);
    doc.text(formatPrice(o.price), pageW - margin - 4, y, { align: 'right' });

    // Coupon discount
    if (o.couponCode) {
        y += 7;
        doc.setTextColor(34, 197, 94); // green
        doc.text('Giam gia (' + safeText(o.couponCode) + '):', summaryX, y);
        doc.text('Da ap dung', pageW - margin - 4, y, { align: 'right' });
    }

    // Total
    y += 10;
    doc.setDrawColor(168, 85, 247);
    doc.setLineWidth(0.8);
    doc.line(summaryX, y, pageW - margin, y);
    y += 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(168, 85, 247);
    doc.text('TONG CONG:', summaryX, y);
    doc.text(formatPrice(o.price), pageW - margin - 4, y, { align: 'right' });

    // ===== PAYMENT STATUS BOX =====
    y += 16;
    if (o.status === 'completed') {
        doc.setFillColor(240, 253, 244); // green bg
        doc.roundedRect(margin, y, contentW, 14, 3, 3, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(34, 197, 94);
        doc.text('DA THANH TOAN', pageW / 2, y + 9, { align: 'center' });
    } else if (o.status === 'cancelled') {
        doc.setFillColor(254, 242, 242); // red bg
        doc.roundedRect(margin, y, contentW, 14, 3, 3, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(239, 68, 68);
        doc.text('DA HUY', pageW / 2, y + 9, { align: 'center' });
    } else {
        doc.setFillColor(254, 249, 235); // yellow bg
        doc.roundedRect(margin, y, contentW, 14, 3, 3, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(234, 179, 8);
        doc.text('DANG XU LY', pageW / 2, y + 9, { align: 'center' });
    }

    // ===== NOTE =====
    if (o.note) {
        y += 22;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100, 100, 100);
        doc.text('GHI CHU:', margin, y);
        doc.setFont('helvetica', 'normal');
        doc.text(safeText(o.note), margin + 22, y);
    }

    // ===== FOOTER =====
    const footerY = doc.internal.pageSize.getHeight() - 25;
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(margin, footerY, pageW - margin, footerY);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('AI4DEV - Tai khoan AI Premium chinh hang', pageW / 2, footerY + 6, { align: 'center' });
    doc.text('Hotline: 0367545048 | Website: ai4dev.vn | Telegram: @shopai4dev', pageW / 2, footerY + 11, { align: 'center' });
    doc.text('Hoa don nay duoc tao tu dong boi he thong AI4DEV', pageW / 2, footerY + 16, { align: 'center' });

    // Bottom accent bar
    doc.setFillColor(168, 85, 247);
    doc.rect(0, doc.internal.pageSize.getHeight() - 4, pageW, 4, 'F');

    // Download
    const fileName = 'AI4DEV_HoaDon_' + shortId + '.pdf';
    doc.save(fileName);
    showToast('Da tai hoa don PDF!', 'success');
}

// ═══════════════════════════════════════════════════════════
// ─── DEPOSIT / NẠP TIỀN PAGE ─────────────────────────────
// ═══════════════════════════════════════════════════════════

function renderDepositPage() {
    return `
        <div class="container" style="max-width:800px; margin:0 auto; padding-top:32px;">
            <h2 class="section-title" style="font-size:28px; margin-bottom:8px;">Nạp tiền tài khoản</h2>
            <p style="color:var(--text-secondary); margin-bottom:32px;">Chuyển khoản ngân hàng để nạp tiền vào tài khoản. Số dư được cộng tự động trong vòng 1-2 phút.</p>

            <div class="card" style="padding:28px; margin-bottom:24px;">
                <h3 style="font-size:16px; font-weight:600; color:var(--white); margin-bottom:20px;">Quét mã QR để chuyển khoản</h3>
                <div style="display:flex; gap:32px; flex-wrap:wrap; align-items:flex-start;">
                    <div id="depositQR" style="background:white; border-radius:12px; padding:12px; display:flex; align-items:center; justify-content:center; min-width:220px; min-height:220px;">
                        <div style="color:#666; font-size:13px;">Đang tải mã QR...</div>
                    </div>
                    <div style="flex:1; min-width:250px;">
                        <div style="background:var(--card-hover); border-radius:12px; padding:20px; margin-bottom:16px;">
                            <div style="display:grid; gap:14px;">
                                <div>
                                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-tertiary); letter-spacing:0.5px; margin-bottom:4px;">Ngân hàng</div>
                                    <div id="depositBankName" style="font-size:15px; font-weight:600; color:var(--white);">Đang tải...</div>
                                </div>
                                <div>
                                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-tertiary); letter-spacing:0.5px; margin-bottom:4px;">Số tài khoản</div>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <span id="depositBankAccount" style="font-size:18px; font-weight:700; color:var(--accent); font-family:monospace; letter-spacing:1px;">...</span>
                                        <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('depositBankAccount')" style="padding:4px 8px; font-size:11px;">Sao chép</button>
                                    </div>
                                </div>
                                <div>
                                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-tertiary); letter-spacing:0.5px; margin-bottom:4px;">Chủ tài khoản</div>
                                    <div id="depositOwnerName" style="font-size:15px; font-weight:500; color:var(--white);">...</div>
                                </div>
                                <div>
                                    <div style="font-size:11px; text-transform:uppercase; color:var(--text-tertiary); letter-spacing:0.5px; margin-bottom:4px;">Nội dung chuyển khoản</div>
                                    <div style="display:flex; align-items:center; gap:8px;">
                                        <span id="depositContent" style="font-size:16px; font-weight:700; color:var(--green); font-family:monospace;">...</span>
                                        <button class="btn btn-ghost btn-sm" onclick="copyToClipboard('depositContent')" style="padding:4px 8px; font-size:11px;">Sao chép</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div style="background:rgba(234,179,8,0.08); border:1px solid rgba(234,179,8,0.2); border-radius:10px; padding:14px;">
                            <div style="font-size:13px; color:#eab308; font-weight:600; margin-bottom:6px;">Lưu ý quan trọng</div>
                            <ul style="font-size:12px; color:var(--text-secondary); line-height:1.8; margin:0; padding-left:16px;">
                                <li>Nội dung chuyển khoản <b>phải đúng</b> để hệ thống nhận diện</li>
                                <li>Số tiền nạp tối thiểu: <b>10,000đ</b></li>
                                <li>Số dư được cộng <b>tự động</b> sau 1-2 phút</li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card" style="padding:24px;">
                <h3 style="font-size:16px; font-weight:600; color:var(--white); margin-bottom:16px;">Lịch sử nạp tiền</h3>
                <div id="depositHistoryContainer">
                    <div style="text-align:center; color:var(--text-tertiary); padding:20px;">Đang tải...</div>
                </div>
            </div>
        </div>
    `;
}

function loadDepositInfo() {
    // Load bank info + QR
    Api.get('/deposit-info')
        .then(data => {
            if (!data.success) return;
            const { bankId, bankAccount, bankName, transferContent } = data;

            document.getElementById('depositBankName').textContent = bankId || 'Chưa cấu hình';
            document.getElementById('depositBankAccount').textContent = bankAccount || 'Chưa cấu hình';
            document.getElementById('depositOwnerName').textContent = bankName || 'Chưa cấu hình';
            document.getElementById('depositContent').textContent = transferContent || '';

            // Generate QR via SePay
            if (bankId && bankAccount) {
                const qrUrl = `https://qr.sepay.vn/img?bank=${bankId}&acc=${bankAccount}&template=compact&des=${encodeURIComponent(transferContent)}`;
                document.getElementById('depositQR').innerHTML = `<img src="${qrUrl}" style="width:200px;height:200px;border-radius:8px;" alt="QR Code">`;
            } else {
                document.getElementById('depositQR').innerHTML = '<div style="color:#666; font-size:13px; padding:20px; text-align:center;">Chưa cấu hình thông tin ngân hàng</div>';
            }
        })
        .catch(() => showToast('Loi tai thong tin nap tien', 'error'));

    // Auto-check balance every 5 seconds to detect deposits
    let lastKnownBalance = null;
    function checkBalanceForDeposit() {
        Api.get('/user/profile')
            .then(data => {
                if (!data.success) return;
                const currentBalance = data.user.balance || 0;
                if (lastKnownBalance !== null && currentBalance > lastKnownBalance) {
                    const added = currentBalance - lastKnownBalance;
                    showDepositSuccessPopup(added, currentBalance);
                    // Update header balance
                    const balEl = document.getElementById('userBalance');
                    if (balEl) balEl.textContent = formatPrice(currentBalance);
                    // Reload deposit history
                    loadDepositHistory();
                }
                lastKnownBalance = currentBalance;
            })
            .catch(() => {});
    }
    checkBalanceForDeposit();
    window._depositPolling = setInterval(checkBalanceForDeposit, 5000);

    // Load deposit history
    Api.get('/deposits')
        .then(data => {
            const container = document.getElementById('depositHistoryContainer');
            if (!container) return;

            if (!data.success || !data.deposits || data.deposits.length === 0) {
                container.innerHTML = '<div class="empty-state" style="padding:30px;"><div class="empty-state-title">Chưa có giao dịch nạp tiền nào</div></div>';
                return;
            }

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Thời gian</th>
                            <th>Số tiền</th>
                            <th>Nội dung</th>
                            <th>Trạng thái</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.deposits.map(d => `
                            <tr>
                                <td style="font-size:13px;">${formatDate(d.createdAt)}</td>
                                <td style="font-weight:600; color:var(--green);">+${formatPrice(d.amount)}</td>
                                <td style="font-size:12px; color:var(--text-secondary); max-width:200px; overflow:hidden; text-overflow:ellipsis;">${d.content || ''}</td>
                                <td><span style="display:inline-block;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;${d.status === 'completed' ? 'background:#0a6e2e;color:#fff;' : 'background:#333;color:#aaa;'}">${d.status === 'completed' ? 'THANH CONG' : 'Cho xu ly'}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        })
        .catch(() => {});
}

// Popup nap tien thanh cong voi hieu ung tick xanh
function showDepositSuccessPopup(amount, newBalance) {
    const old = document.getElementById('depositSuccessOverlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'depositSuccessOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:99999;animation:fadeInOverlay 0.3s ease;';
    overlay.innerHTML = `
        <style>
            @keyframes fadeInOverlay { from{opacity:0} to{opacity:1} }
            @keyframes scaleIn { from{transform:scale(0.5);opacity:0} to{transform:scale(1);opacity:1} }
            @keyframes checkStroke { to{stroke-dashoffset:0} }
            @keyframes circleStroke { to{stroke-dashoffset:0} }
        </style>
        <div style="background:#111;border:2px solid #0a6e2e;border-radius:20px;padding:40px 50px;text-align:center;animation:scaleIn 0.4s cubic-bezier(0.175,0.885,0.32,1.275);max-width:400px;width:90%;">
            <svg width="80" height="80" viewBox="0 0 80 80" style="margin-bottom:20px;">
                <circle cx="40" cy="40" r="36" fill="none" stroke="#0a6e2e" stroke-width="4" stroke-dasharray="226" stroke-dashoffset="226" style="animation:circleStroke 0.6s ease 0.2s forwards;" />
                <path d="M24 42 L35 53 L56 28" fill="none" stroke="#22c55e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="50" stroke-dashoffset="50" style="animation:checkStroke 0.4s ease 0.7s forwards;" />
            </svg>
            <h2 style="color:#22c55e;font-size:22px;margin:0 0 8px;font-weight:700;">NẠP TIỀN THÀNH CÔNG!</h2>
            <div style="color:#fff;font-size:28px;font-weight:800;margin:12px 0;">+${formatPrice(amount)}</div>
            <div style="color:#aaa;font-size:14px;margin-top:8px;">So du moi: <span style="color:#22c55e;font-weight:600;">${formatPrice(newBalance)}</span></div>
            <button onclick="document.getElementById('depositSuccessOverlay').remove()" style="margin-top:24px;background:#0a6e2e;color:#fff;border:none;padding:12px 40px;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;">OK</button>
        </div>
    `;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    setTimeout(() => { if (document.getElementById('depositSuccessOverlay')) overlay.remove(); }, 6000);
}

function loadDepositHistory() {
    Api.get('/deposits').then(data => {
        const container = document.getElementById('depositHistoryContainer');
        if (!container) return;
        if (!data.success || !data.deposits || data.deposits.length === 0) {
            container.innerHTML = '<div class="empty-state" style="padding:30px;"><div class="empty-state-title">Chua co giao dich nap tien nao</div></div>';
            return;
        }
        container.innerHTML = `<table class="data-table"><thead><tr><th>Thoi gian</th><th>So tien</th><th>Noi dung</th><th>Trang thai</th></tr></thead><tbody>${data.deposits.map(d => `<tr><td style="font-size:13px;">${formatDate(d.createdAt)}</td><td style="font-weight:600;color:var(--green);">+${formatPrice(d.amount)}</td><td style="font-size:12px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;">${d.content || ''}</td><td><span style="display:inline-block;padding:4px 14px;border-radius:6px;font-size:11px;font-weight:700;${d.status === 'completed' ? 'background:#0a6e2e;color:#fff;' : 'background:#333;color:#aaa;'}">${d.status === 'completed' ? 'Thành công' : 'Cho xu ly'}</span></td></tr>`).join('')}</tbody></table>`;
    }).catch(() => {});
}

function copyToClipboard(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    navigator.clipboard.writeText(el.textContent).then(() => {
        showToast('Đã sao chép!', 'success');
    }).catch(() => {
        showToast('Không thể sao chép', 'error');
    });
}

function toggleMobileMenu() {
    document.getElementById('nav').classList.toggle('open');
}

// --- Copy credential to clipboard ---
function copyCredential(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.textContent;
    navigator.clipboard.writeText(text).then(() => {
        showToast('Da sao chep!', 'success');
        const btn = el.parentElement.querySelector('.credential-copy-btn');
        if (btn) {
            btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
            setTimeout(() => {
                btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
            }, 1500);
        }
    }).catch(() => showToast('Khong the sao chep', 'error'));
}

// --- Admin: Send credentials to order ---
async function sendOrderCredentials(orderId) {
    const email = document.getElementById('adminCredEmail_' + orderId).value;
    const pass = document.getElementById('adminCredPass_' + orderId).value;
    const code2fa = document.getElementById('adminCred2FA_' + orderId).value;

    if (!email || !pass) {
        showToast('Vui lòng nhập email và mật khẩu', 'error');
        return;
    }

    const btn = document.getElementById('adminCredBtn_' + orderId);
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi...'; }

    try {
        const data = await Api.put('/admin/orders/' + orderId + '/credentials', {
            accountEmail: email,
            accountPassword: pass,
            accountCode2FA: code2fa
        });
        if (data.success) {
            showToast('Đã gửi thông tin tài khoản!', 'success');
            loadAdminOrders();
        } else {
            showToast(data.message || 'Lỗi khi gửi thông tin', 'error');
        }
    } catch {
        showToast('Lỗi kết nối server', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Gửi tài khoản'; }
    }
}

async function confirmOwnedUpgrade(orderId) {
    const btn = document.getElementById('adminConfirmBtn_' + orderId);
    if (btn) { btn.disabled = true; btn.textContent = 'Đang xử lý...'; }

    try {
        const data = await Api.put('/admin/orders/' + orderId + '/confirm-upgrade');
        if (data.success) {
            showToast('Đã xác nhận nâng cấp thành công!', 'success');
            loadAdminOrders();
        } else {
            showToast(data.message || 'Lỗi khi xác nhận', 'error');
        }
    } catch {
        showToast('Lỗi kết nối server', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Xác nhận đã nâng cấp xong'; }
    }
}

// --- Auth ---
function updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const userMenu = document.getElementById('userMenu');
    const userName = document.getElementById('userName');
    const adminLink = document.getElementById('adminLink');

    if (currentUser) {
        loginBtn.style.display = 'none';
        registerBtn.style.display = 'none';
        userMenu.style.display = 'flex';
        userName.textContent = currentUser.name;
        const balanceEl = document.getElementById('userBalance');
        if (balanceEl) balanceEl.textContent = formatPrice(currentUser.balance || 0);
        adminLink.style.display = currentUser.role === 'admin' ? 'block' : 'none';
    } else {
        loginBtn.style.display = 'inline-flex';
        registerBtn.style.display = 'none'; // Đăng ký đã tạm dừng
        userMenu.style.display = 'none';
        adminLink.style.display = 'none';
    }
}

function login(e) {
    e.preventDefault();
    clearFormErrors(['loginEmail', 'loginPassword']);

    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    // Client-side pre-check
    const errors = {};
    if (!email) errors.loginEmail = 'Email không được để trống';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.loginEmail = 'Email không đúng định dạng';
    if (!password) errors.loginPassword = 'Mật khẩu không được để trống';
    if (Object.keys(errors).length) { showFieldErrors(errors); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    Api.post('/login', { email, password })
        .then(data => {
            if (data.success) {
                authToken = data.token;
                localStorage.setItem('authToken', authToken);
                currentUser = data.user;
                Storage.set('currentUser', data.user);
                updateAuthUI();
                showToast(data.message, 'success');
                navigate(data.redirect || 'home');
            } else {
                showFieldErrors(data.errors || { loginEmail: data.message });
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Đăng nhập'; });
}

// --- Register ---
function register(e) {
    e.preventDefault();
    clearFormErrors(['regName', 'regEmail', 'regPassword']);

    const name     = document.getElementById('regName').value.trim();
    const email    = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value;

    // Client-side validation
    const errors = {};
    if (!name || name.length < 2)        errors.regName     = 'Họ tên phải có ít nhất 2 ký tự';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.regEmail = 'Email không đúng định dạng';
    if (!password || password.length < 6) errors.regPassword = 'Mật khẩu tối thiểu 6 ký tự';
    else if (!/[A-Z]/.test(password))    errors.regPassword = 'Mật khẩu phải có ít nhất 1 chữ hoa';
    else if (!/[0-9]/.test(password))    errors.regPassword = 'Mật khẩu phải có ít nhất 1 chữ số';
    if (Object.keys(errors).length) { showFieldErrors(errors); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    Api.post('/register', { name, email, password, referred_by: document.getElementById('regReferredBy')?.value || '' })
        .then(data => {
            if (data.success) {
                authToken = data.token;
                localStorage.setItem('authToken', authToken);
                currentUser = data.user;
                Storage.set('currentUser', data.user);
                updateAuthUI();
                showToast(data.message, 'success');
                navigate(data.redirect || 'home');
            } else {
                const mappedErrors = {};
                Object.entries(data.errors || {}).forEach(([k, v]) => {
                    mappedErrors['reg' + k.charAt(0).toUpperCase() + k.slice(1)] = v;
                });
                showFieldErrors(mappedErrors);
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Đăng ký'; });
}

// --- Complete Profile ---
function completeProfile(e) {
    e.preventDefault();
    clearFormErrors(['cpZalo', 'cpBankAccount', 'cpBankName']);

    const phone_zalo   = document.getElementById('cpZalo').value.trim();
    const bank_account = document.getElementById('cpBankAccount').value.trim();
    const bank_name    = document.getElementById('cpBankName').value.trim();

    const errors = {};
    if (!/^0[0-9]{9,10}$/.test(phone_zalo)) errors.cpZalo = 'Số Zalo không hợp lệ (VD: 0987654321)';
    if (!/^[0-9]{6,20}$/.test(bank_account)) errors.cpBankAccount = 'Số tài khoản phải là 6–20 chữ số';
    if (!bank_name) errors.cpBankName = 'Tên ngân hàng không được để trống';
    if (Object.keys(errors).length) { showFieldErrors(errors); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';

    Api.post('/profile/complete', { phone_zalo, bank_account, bank_name })
        .then(data => {
            if (data.success) {
                currentUser = { ...currentUser, ...data.user };
                Storage.set('currentUser', currentUser);
                showToast('Hoàn thiện hồ sơ thành công!', 'success');
                navigate('home');
            } else {
                const mapped = {};
                Object.entries(data.errors || {}).forEach(([k, v]) => {
                    const map = { phone_zalo: 'cpZalo', bank_account: 'cpBankAccount', bank_name: 'cpBankName' };
                    mapped[map[k] || k] = v;
                });
                showFieldErrors(mapped);
            }
        })
        .catch(() => showToast('Lỗi kết nối', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Lưu thông tin'; });
}

function logout() {
    currentUser = null;
    authToken   = null;
    localStorage.removeItem('authToken');
    Storage.remove('currentUser');
    updateAuthUI();
    showToast('Đã đăng xuất', 'info');
    navigate('home');
}

function isAdmin() {
    return currentUser && currentUser.role === 'admin';
}

function isLoggedIn() {
    return !!currentUser;
}

// --- Toast ---
function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
}

// --- Star Rating Helper ---
function renderStars(rating, max = 5) {
    let stars = '';
    for (let i = 1; i <= max; i++) {
        stars += i <= rating ? '[*]' : '[ ]';
    }
    return stars;
}

function renderStarRatingInput(selected = 0) {
    let html = '<div class="star-rating">';
    for (let i = 1; i <= 5; i++) {
        html += `<button type="button" class="star-rating-btn ${i <= selected ? 'filled' : ''}" onclick="setRating(${i})">${i <= selected ? '[*]' : '[ ]'}</button>`;
    }
    html += '</div>';
    return html;
}

function setRating(rating) {
    selectedRating = rating;
    document.querySelectorAll('.star-rating-btn').forEach((btn, i) => {
        btn.classList.toggle('filled', i < rating);
        btn.textContent = i < rating ? '[*]' : '[ ]';
    });
}

// ===== PAGE RENDERERS =====

// --- Home Page ---
// ─── PLAN PRODUCT MAPPING ──────────────────────
// Dinh nghia san pham thuoc tung plan (keyword matching tren ten san pham)
const PLAN_CONFIG = [
    {
        id: 'student',
        title: 'Dành cho Sinh viên',
        subtitle: 'Tăng tốc học tập và nghiên cứu',
        description: 'Tối ưu hóa việc học tập với các công cụ AI hỗ trợ giải bài tập, viết code, nghiên cứu khoa học và sáng tạo nội dung. Học thông minh hơn, không phải vất vả hơn.',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>',
        colorClass: 'plan-student',
        keywords: ['chatgpt', 'claude', 'gemini', 'grammarly', 'notion', 'perplexity', 'gpt'],
        highlights: ['Hỗ trợ giải bài tập & viết luận', 'Nghiên cứu tài liệu nhanh chóng', 'Viết code và debug hiệu quả', 'Giá ưu đãi dành cho sinh viên'],
    },
    {
        id: 'professional',
        title: 'Dành cho Người đi làm',
        subtitle: 'Năng suất làm việc vượt trội',
        description: 'Nâng cao hiệu suất công việc với các trợ lý AI hàng đầu. Tự động hóa quy trình, viết code chuyên nghiệp và giải quyết vấn đề phức tạp trong nháy mắt.',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>',
        colorClass: 'plan-professional',
        keywords: ['copilot', 'cursor', 'chatgpt', 'claude', 'midjourney', 'v0', 'lovable', 'replit', 'windsurf', 'bolt'],
        highlights: ['Viết code với AI Copilot', 'Thiết kế UI/UX chuyên nghiệp', 'Tự động hóa workflow', 'Hỗ trợ đa ngôn ngữ và framework'],
    },
    {
        id: 'business',
        title: 'Dành cho Doanh nghiệp',
        subtitle: 'Giải pháp AI quy mô lớn',
        description: 'Giải pháp AI toàn diện cho đội ngũ, bảo mật tối đa và quản lý tập trung. Thúc đẩy đổi mới sáng tạo và nâng cao năng lực cạnh tranh của tổ chức.',
        icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M9 8h1"/><path d="M9 12h1"/><path d="M9 16h1"/><path d="M14 8h1"/><path d="M14 12h1"/><path d="M14 16h1"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/></svg>',
        colorClass: 'plan-business',
        keywords: ['team', 'business', 'enterprise', 'copilot', 'chatgpt', 'claude', 'api'],
        highlights: ['Quản lý tài khoản tập trung', 'Bảo mật cấp doanh nghiệp', 'Hỗ trợ kỹ thuật ưu tiên', 'Tùy chỉnh theo nhu cầu'],
    },
];

function getProductsForPlan(plan) {
    if (!_productsCache.length) return [];
    return _productsCache.filter(p => {
        const name = (p.name || '').toLowerCase();
        const category = (p.category || '').toLowerCase();
        return plan.keywords.some(kw => name.includes(kw) || category.includes(kw));
    }).slice(0, 6);
}

function renderPlanProductMini(product) {
    const outOfStock = product.inStock === false;
    return `
        <div class="plan-product-item${outOfStock ? ' out-of-stock' : ''}" onclick="event.stopPropagation(); navigate('product-detail', {id: '${product.id}', slug: '${slugify(product.name)}'})">
            <div class="plan-product-image">${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}">` : `<span>${product.shortName || product.name.substring(0,2)}</span>`}</div>
            <div class="plan-product-info">
                <div class="plan-product-name">${product.name}</div>
                <div class="plan-product-price">${outOfStock ? 'Hết hàng' : `Từ ${formatPrice(getLowestPrice(product))}`}</div>
            </div>
            ${product.isHot ? '<div class="plan-product-badge">HOT</div>' : ''}
        </div>
    `;
}

function renderHomePage() {
    return `
        <div class="dark-veil-container">
            <canvas id="darkVeilCanvas" class="dark-veil-canvas"></canvas>
            <div class="dark-veil-scanlines"></div>
            <div class="container" style="position:relative; z-index:2;">
                <section class="hero-split">
                    <div class="hero-left">
                        <h1 class="hero-title" style="text-align:left;"><span class="blur-text"><span style="--i:0">A</span><span style="--i:1">I</span><span style="--i:2">4</span><span style="--i:3">D</span><span style="--i:4">E</span><span style="--i:5">V</span></span></h1>
                        <p class="hero-tagline">Tài khoản AI Premium cho Developer</p>
                        <p class="hero-description" style="text-align:left; margin:0 0 24px;">Cung cấp tài khoản AI chính hãng với giá tốt nhất Việt Nam. ChatGPT Plus, Claude Pro, GitHub Copilot, Cursor Pro, Midjourney và nhiều hơn nữa.</p>
                        <p class="hero-description" style="text-align:left; margin:0 0 32px; font-size:14px;">Uy tín — Nhanh chóng — Hỗ trợ 24/7. Hàng nghìn developer đã tin tưởng sử dụng dịch vụ của chúng tôi.</p>
                        <div class="hero-actions" style="justify-content:flex-start;">
                            <button class="btn btn-primary btn-lg" onclick="navigate('products')">Xem sản phẩm</button>
                            ${!currentUser ? '<button class="btn btn-outline btn-lg" onclick="navigate(\'register\')">Tạo tài khoản</button>' : ''}
                        </div>
                    </div>
                    <div class="hero-right">
                        <img src="assets/logo_brand.png" alt="AI4DEV Logo" class="hero-logo-img">
                    </div>
                </section>
                
                <div class="section-header" style="margin-top: 60px; text-align: left;">
                    <h2 class="section-title">Giải pháp theo nhu cầu</h2>
                    <p class="section-subtitle">Chọn gói phù hợp với vị trí và mục tiêu của bạn</p>
                </div>

                <div class="plans-container">
                    ${renderPlanSections()}
                </div>
            </div>
        </div>
    `;
}

// --- DarkVeil Background ---
let _darkVeilAnim = null;

function startDarkVeil() {
    if (_darkVeilAnim) cancelAnimationFrame(_darkVeilAnim);
    const canvas = document.getElementById('darkVeilCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function resize() {
        const parent = canvas.parentElement;
        canvas.width = parent.offsetWidth;
        canvas.height = parent.offsetHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const startTime = performance.now();

    function draw(now) {
        const t = (now - startTime) * 0.001;
        const W = canvas.width;
        const H = canvas.height;

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);

        // Flowing gradient blobs
        const blobs = [
            { cx: W * 0.25 + Math.sin(t * 0.4) * W * 0.15, cy: H * 0.4 + Math.cos(t * 0.3) * H * 0.2, r: Math.min(W, H) * 0.6, color: [60, 0, 120] },
            { cx: W * 0.75 + Math.cos(t * 0.35) * W * 0.12, cy: H * 0.5 + Math.sin(t * 0.45) * H * 0.15, r: Math.min(W, H) * 0.5, color: [100, 20, 180] },
            { cx: W * 0.5 + Math.sin(t * 0.5 + 1) * W * 0.2, cy: H * 0.3 + Math.cos(t * 0.25 + 2) * H * 0.25, r: Math.min(W, H) * 0.45, color: [20, 10, 80] },
            { cx: W * 0.15 + Math.cos(t * 0.3 + 3) * W * 0.1, cy: H * 0.7 + Math.sin(t * 0.4 + 1) * H * 0.1, r: Math.min(W, H) * 0.4, color: [80, 0, 160] },
            { cx: W * 0.6 + Math.sin(t * 0.55 + 2) * W * 0.15, cy: H * 0.8 + Math.cos(t * 0.35 + 3) * H * 0.1, r: Math.min(W, H) * 0.35, color: [40, 5, 100] },
        ];

        blobs.forEach(b => {
            const grad = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r);
            grad.addColorStop(0, `rgba(${b.color[0]},${b.color[1]},${b.color[2]},0.8)`);
            grad.addColorStop(0.4, `rgba(${b.color[0]},${b.color[1]},${b.color[2]},0.4)`);
            grad.addColorStop(0.7, `rgba(${Math.floor(b.color[0]*0.5)},${Math.floor(b.color[1]*0.5)},${Math.floor(b.color[2]*0.5)},0.15)`);
            grad.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, W, H);
        });

        // Noise overlay
        const imgData = ctx.getImageData(0, 0, W, H);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 16) {
            const noise = (Math.random() - 0.5) * 12;
            data[i] = Math.max(0, Math.min(255, data[i] + noise));
            data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
            data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
        }
        ctx.putImageData(imgData, 0, 0);

        // Subtle horizontal scanlines
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        for (let y = 0; y < H; y += 3) {
            ctx.fillRect(0, y, W, 1);
        }

        _darkVeilAnim = requestAnimationFrame(draw);
    }

    _darkVeilAnim = requestAnimationFrame(draw);
}

function stopDarkVeil() {
    if (_darkVeilAnim) {
        cancelAnimationFrame(_darkVeilAnim);
        _darkVeilAnim = null;
    }
}

function renderProductCard(product) {
    const avgRating = product.rating || 0;
    const outOfStock = product.inStock === false;
    const fullStars = Math.floor(avgRating);
    const hasHalf = avgRating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);
    const starSvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    const starEmptySvg = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';

    return `
        <div class="card product-card${outOfStock ? ' out-of-stock' : ''}" onclick="navigate('product-detail', {id: '${product.id}', slug: '${slugify(product.name)}'})">
            <div class="card-shimmer"></div>
            <div class="product-card-overlay">
                <span class="overlay-cta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    Xem chi tiết
                </span>
            </div>
            <div class="card-image">${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;">` : product.shortName}</div>
            <div class="product-badges-overlay">
                ${outOfStock ? '<span class="badge badge-sold-out">HẾT HÀNG</span>' : ''}
                ${product.isHot ? '<span class="badge badge-hot">HOT</span>' : ''}
                ${product.isTrending ? '<span class="badge badge-trending">TRENDING</span>' : ''}
                ${product.isNew ? '<span class="badge badge-new">MỚI</span>' : ''}
            </div>
            <div class="card-body">
                <div class="card-body-top">
                    <div class="card-title">${product.name}</div>
                    <div class="card-category-tag">${product.category}</div>
                    <div class="product-rating-row">
                        <span class="product-stars">${starSvg.repeat(fullStars)}${starEmptySvg.repeat(emptyStars + (hasHalf ? 1 : 0))}</span>
                        <span class="product-rating-text">${avgRating.toFixed(1)}</span>
                        <span class="product-purchases">${product.purchases} đã mua</span>
                    </div>
                </div>
                <div class="card-body-bottom">
                    <div class="product-price-block">
                        <span class="product-price">${outOfStock ? 'Hết hàng' : `Tu ${formatPrice(getLowestPrice(product))}`}</span>
                        ${!outOfStock && product.originalPrice > product.price ? `<span class="product-price-original">${formatPrice(product.originalPrice)}</span>` : ''}
                    </div>
                    <div class="product-warranty-tag"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>${outOfStock ? 'Liên hệ đặt trước' : 'BH Trọn gói'}</div>
                </div>
            </div>
        </div>
    `;
}

function getTotalPurchases() {
    return _productsCache.reduce((sum, p) => sum + p.purchases, 0);
}

function formatNumber(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
}

// --- Reusable Plan Sections HTML ---
function renderPlanSections() {
    return PLAN_CONFIG.map(plan => {
        const products = getProductsForPlan(plan);
        const productsHTML = products.length
            ? products.map(p => renderPlanProductMini(p)).join('')
            : '<div class="plan-no-products">Đang cập nhật sản phẩm...</div>';

        return `
            <div class="plan-section ${plan.colorClass}">
                <div class="plan-header">
                    <div class="plan-header-top">
                        <div class="plan-icon">${plan.icon}</div>
                        <div class="plan-header-text">
                            <h3 class="plan-title">${plan.title}</h3>
                            <p class="plan-subtitle">${plan.subtitle}</p>
                        </div>
                    </div>
                    <p class="plan-description">${plan.description}</p>
                    <div class="plan-highlights">
                        ${plan.highlights.map(h => `
                            <div class="plan-highlight-item">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                <span>${h}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="plan-products-grid">
                    ${productsHTML}
                </div>
                <div class="plan-footer">
                    <button class="btn btn-plan-cta ${plan.colorClass}" onclick="event.stopPropagation(); navigate('products')">
                        Xem tất cả sản phẩm
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// --- Products Page ---
function renderProductsPage(initialParams = {}) {
    const products = _productsCache;
    const categories = [...new Set(products.map(p => p.category))];

    // Handle initial category filtering from navigate
    setTimeout(() => {
        if (initialParams.category) {
            filterByCategory(initialParams.category);
        }
    }, 100);

    return `
        <div class="container products-page">
            <!-- Banner Slider -->
            <div id="bannerSliderContainer" class="banner-slider-container" style="display:none;">
                <div class="banner-wrapper" id="bannerWrapper"></div>
                <button class="banner-btn prev" id="bannerPrevBtn">&#10094;</button>
                <button class="banner-btn next" id="bannerNextBtn">&#10095;</button>
                <div class="banner-dots" id="bannerDots"></div>
            </div>

            <!-- Flash Sale Section -->
            <div id="flashSaleContainer" style="display:none;"></div>

            <!-- Page Header -->
            <div class="products-page-header">
                <div class="products-page-header-left">
                    <h1 class="products-page-title">Sản phẩm</h1>
                    <p class="products-page-desc">Tài khoản AI Premium chính hãng giá tốt nhất Việt Nam</p>
                </div>
                <div class="products-page-stats">
                    <div class="products-page-stat">
                        <span class="products-page-stat-value">${products.length}</span>
                        <span class="products-page-stat-label">Sản phẩm</span>
                    </div>
                    <div class="products-page-stat">
                        <span class="products-page-stat-value">${formatNumber(getTotalPurchases())}</span>
                        <span class="products-page-stat-label">Đã bán</span>
                    </div>
                </div>
            </div>

            <section class="section" style="padding-top: 16px;">
                <div class="section-header">
                    <h2 class="section-title">Tất cả sản phẩm</h2>
                    <p class="section-subtitle">Chọn tài khoản AI phù hợp với nhu cầu của bạn</p>
                </div>

                <div class="filters">
                    <input type="text" class="search-input" placeholder="Tìm kiếm sản phẩm..." id="searchInput" oninput="filterProducts()">
                    <button class="filter-btn active" data-category="all" onclick="filterByCategory('all', this)">Tất cả</button>
                    ${categories.map(c => `<button class="filter-btn" data-category="${c}" onclick="filterByCategory('${c}', this)">${c}</button>`).join('')}
                </div>

                <div class="grid-4" id="productsGrid">
                    ${products.map(p => renderProductCard(p)).join('')}
                </div>
            </section>
        </div>
    `;
}

function filterProducts() {
    const search = document.getElementById('searchInput').value.toLowerCase();
    const activeFilter = document.querySelector('.filter-btn.active');
    const category = activeFilter ? activeFilter.dataset.category : 'all';

    let products = [..._productsCache];

    if (category !== 'all') {
        products = products.filter(p => p.category === category);
    }

    if (search) {
        products = products.filter(p =>
            p.name.toLowerCase().includes(search) ||
            p.description.toLowerCase().includes(search) ||
            p.category.toLowerCase().includes(search)
        );
    }

    document.getElementById('productsGrid').innerHTML = products.length
        ? products.map(p => renderProductCard(p)).join('')
        : '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-state-title">Không tìm thấy sản phẩm</div><div class="empty-state-text">Thử tìm kiếm với từ khóa khác</div></div>';
}

function filterByCategory(category, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    else {
        const targetBtn = document.querySelector(`.filter-btn[data-category="${category}"]`);
        if (targetBtn) targetBtn.classList.add('active');
        else {
            // If category doesn't exist in filter buttons (e.g., student isn't a category yet), we might need to handle it.
            // But for now, let's assume the user will add these categories in the DB as requested.
            document.querySelector('.filter-btn[data-category="all"]').classList.add('active');
        }
    }
    filterProducts();
}

// --- Product Detail Page ---
function renderProductDetailPage(productId) {
    const products = _productsCache;
    const product = products.find(p => p.id === productId);

    if (!product) {
        return '<div class="container"><div class="empty-state mt-4"><div class="empty-state-title">Sản phẩm không tồn tại</div></div></div>';
    }

    // Check if this product is in a flash sale
    const flashSale = _flashSalesCache.find(fs => fs.product && fs.product.id === productId);
    const flashSalePrice = flashSale ? flashSale.product.salePrice : null;
    const flashDiscount = flashSale ? flashSale.discountPercent : null;
    const reviews = [];
    const comments = [];
    const avgRating = product.rating;
    const outOfStock = product.inStock === false;

    // Load reviews/comments from API after page renders
    setTimeout(async () => {
        try {
            const [revData, cmtData] = await Promise.all([
                Api.get(`/products/${productId}/reviews`),
                Api.get(`/products/${productId}/comments`),
            ]);
            if (revData.success) {
                const revContainer = document.getElementById('reviewsList');
                if (revContainer) revContainer.innerHTML = (revData.reviews || []).map(r => `
                    <div class="review-card">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                            <strong>${r.author}</strong>
                            <span class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5-r.rating)}</span>
                        </div>
                        <p style="color:var(--text-secondary);font-size:14px;">${r.text}</p>
                        <small style="color:var(--text-muted);">${formatDate(r.date)}</small>
                    </div>
                `).join('') || '<p style="color:var(--text-secondary);">Chưa có đánh giá</p>';
            }
            if (cmtData.success) {
                const cmtContainer = document.getElementById('commentsList');
                if (cmtContainer) cmtContainer.innerHTML = (cmtData.comments || []).map(c => `
                    <div class="comment-card">
                        <strong>${c.author}</strong>
                        <p style="color:var(--text-secondary);font-size:14px;margin-top:4px;">${c.text}</p>
                        <small style="color:var(--text-muted);">${formatDate(c.date)}</small>
                    </div>
                `).join('') || '<p style="color:var(--text-secondary);">Chưa có bình luận</p>';
            }
        } catch (e) { console.error('Failed to load reviews/comments', e); }
    }, 100);

    selectedRating = 0;

    // Calculate initial price
    const getInitialPrice = () => {
        if (!product.accountTypes) return formatPrice(product.price);
        let basePrice = 0;
        for (const m of [1, 3, 6, 12]) {
            const p = product.accountTypes[0]?.prices?.[m];
            if (p && p > 0) { basePrice = p; break; }
        }
        if (!basePrice) return formatPrice(product.price);
        if (flashSale) {
            return formatPrice(Math.round(basePrice * (1 - flashDiscount / 100)));
        }
        return formatPrice(basePrice);
    };

    const getFirstMonth = () => {
        if (!product.accountTypes) return '1';
        for (const m of [1, 3, 6, 12]) {
            if (product.accountTypes.some(at => at.prices?.[m] > 0)) return m;
        }
        return '1';
    };

    return `
        <div class="container product-detail">
            <div style="display:grid;grid-template-columns:1fr 380px;gap:32px;align-items:start;">

                <!-- LEFT: Product Info -->
                <div>
                    <div class="product-detail-image" style="margin-bottom:16px;">${product.imageUrl ? `<img src="${product.imageUrl}" alt="${product.name}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">` : product.shortName}</div>

                    <h1 style="font-size:22px;font-weight:800;color:var(--white);margin-bottom:8px;">${product.name}</h1>
                    <div class="product-detail-category" style="margin-bottom:16px;">
                        <span class="badge badge-secondary">${product.category}</span>
                        ${product.isHot ? '<span class="badge badge-hot" style="margin-left:0.375rem;">HOT</span>' : ''}
                        ${product.isTrending ? '<span class="badge badge-trending" style="margin-left:0.375rem;">TRENDING</span>' : ''}
                        ${product.isNew ? '<span class="badge badge-new" style="margin-left:0.375rem;">MỚI</span>' : ''}
                        ${outOfStock ? '<span class="badge badge-sold-out" style="margin-left:0.375rem;">HẾT HÀNG</span>' : ''}
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                        <span style="font-size:13px;color:var(--text-secondary);">${avgRating} / 5 (${reviews.length} đánh giá)</span>
                        <span style="font-size:13px;color:var(--text-secondary);">${product.purchases} lượt mua</span>
                    </div>

                    <p class="product-detail-description" style="margin-bottom:20px;">${product.description}</p>

                    <!-- Commitments -->
                    <div class="commitment-list" style="margin-bottom:24px;">
                        <div class="commitment-item">
                            <span class="commitment-icon"></span>
                            <span>Phản hồi trong <strong>15 phút</strong> hoặc hoàn tiền 100%</span>
                        </div>
                        <div class="commitment-item">
                            <span class="commitment-icon"></span>
                            <span><strong>Bảo hành trọn gói</strong> trong suốt thời gian sử dụng</span>
                        </div>
                        <div class="commitment-item">
                            <span class="commitment-icon"></span>
                            <span>TK cấp: nhận trong <strong>1 giờ</strong>, quá hạn hoàn tiền 100%</span>
                        </div>
                    </div>

                    <!-- Price -->
                    <div style="margin-bottom:24px;">
                        <div style="font-size:32px;font-weight:800;color:var(--white);">
                            ${flashSalePrice ? `
                                <span style="background:#dc2626;color:#fff;font-size:12px;font-weight:700;padding:2px 8px;border-radius:4px;margin-right:8px;vertical-align:middle;">FLASH SALE -${flashDiscount}%</span>
                                ${formatPrice(flashSalePrice)}
                                <span style="font-size:16px;color:var(--text-tertiary);text-decoration:line-through;margin-left:8px;font-weight:400;">${formatPrice(getLowestPrice(product))}</span>
                            ` : `Từ ${formatPrice(getLowestPrice(product))}`}
                        </div>
                    </div>

                    ${product.features.length ? `
                    <div style="margin-bottom:32px;">
                        <p style="font-weight:700;font-size:15px;color:var(--white);margin-bottom:10px;">Tính năng nổi bật:</p>
                        <ul style="padding-left:1.25rem;font-size:0.875rem;color:var(--text-secondary);">
                            ${product.features.map(f => `<li style="margin-bottom:0.25rem;color:var(--text-secondary);">${f}</li>`).join('')}
                        </ul>
                    </div>` : ''}

                    <div class="separator"></div>

                    <!-- Tabs -->
                    <div class="tabs">
                        <button class="tab active" onclick="switchTab('reviews', this)">Đánh giá (${reviews.length})</button>
                        <button class="tab" onclick="switchTab('comments', this)">Bình luận (${comments.length})</button>
                        <button class="tab" onclick="switchTab('bugs', this)">Báo cáo lỗi</button>
                        <button class="tab" onclick="switchTab('video', this)">Video</button>
                        <button class="tab" onclick="switchTab('docs', this)">Tài liệu</button>
                    </div>

                    <!-- Tab: Reviews -->
                    <div class="tab-content active" id="tab-reviews">
                        ${isLoggedIn() ? `
                        <div style="max-width:500px; margin-bottom:2rem;">
                            <h3 style="font-size:1rem; font-weight:600; margin-bottom:1rem;">Viết đánh giá</h3>
                            <form onsubmit="submitReview(event, '${product.id}')">
                                <div class="form-group">
                                    <label class="form-label">Đánh giá của bạn</label>
                                    ${renderStarRatingInput(0)}
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Nội dung đánh giá</label>
                                    <textarea class="form-textarea" id="reviewText" placeholder="Chia sẻ trải nghiệm của bạn..." required></textarea>
                                </div>
                                <button type="submit" class="btn btn-primary">Gửi đánh giá</button>
                            </form>
                        </div>
                        <div class="separator"></div>
                        ` : ''}
                        <h3 style="font-size:1rem; font-weight:600; margin-bottom:1rem;">Tất cả đánh giá (${reviews.length})</h3>
                        <div id="reviewsList">
                            ${reviews.length ? reviews.map(r => `
                                <div class="review-item">
                                    <div class="review-header">
                                        <span class="review-author">${r.author}</span>
                                        <span class="review-date">${formatDate(r.date)}</span>
                                    </div>
                                    <div class="review-rating">${r.rating} / 5</div>
                                    <div class="review-text">${r.text}</div>
                                </div>
                            `).join('') : '<div class="empty-state"><div class="empty-state-text">Chưa có đánh giá nào</div></div>'}
                        </div>
                    </div>

                    <!-- Tab: Comments -->
                    <div class="tab-content" id="tab-comments">
                        ${isLoggedIn() ? `
                        <div style="max-width:500px; margin-bottom:1.5rem;">
                            <form onsubmit="submitComment(event, '${product.id}')" style="display:flex; gap:0.5rem; align-items:flex-start;">
                                <textarea class="form-textarea" id="commentText" placeholder="Viết bình luận..." style="min-height:60px;" required></textarea>
                                <button type="submit" class="btn btn-primary" style="flex-shrink:0;">Gửi</button>
                            </form>
                        </div>
                        ` : ''}
                        <div id="commentsList">
                            ${comments.length ? comments.map(c => `
                                <div class="comment-item">
                                    <span class="comment-author">${c.author}</span>
                                    <span class="comment-date">${formatDate(c.date)}</span>
                                    <div class="comment-text">${c.text}</div>
                                </div>
                            `).join('') : '<div class="empty-state"><div class="empty-state-text">Chưa có bình luận nào</div></div>'}
                        </div>
                    </div>

                    <!-- Tab: Bug Reports -->
                    <div class="tab-content" id="tab-bugs">
                        ${isLoggedIn() ? `
                        <div style="max-width:500px;">
                            <h3 style="font-size:1rem; font-weight:600; margin-bottom:1rem;">Báo cáo lỗi sản phẩm</h3>
                            <form onsubmit="submitBugReport(event, '${product.id}')">
                                <div class="form-group">
                                    <label class="form-label">Loại lỗi</label>
                                    <select class="form-select" id="bugType" required>
                                        <option value="">Chọn loại lỗi...</option>
                                        <option value="login">Không đăng nhập được</option>
                                        <option value="feature">Tính năng không hoạt động</option>
                                        <option value="performance">Chậm/Lag</option>
                                        <option value="billing">Vấn đề thanh toán</option>
                                        <option value="other">Khác</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Mô tả chi tiết</label>
                                    <textarea class="form-textarea" id="bugDescription" placeholder="Mô tả lỗi bạn gặp phải..." required></textarea>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Email liên hệ</label>
                                    <input type="email" class="form-input" id="bugEmail" value="${currentUser ? currentUser.email : ''}" required>
                                </div>
                                <button type="submit" class="btn btn-destructive">Gửi báo cáo lỗi</button>
                            </form>
                        </div>
                        ` : `
                        <div class="empty-state">
                            <div class="empty-state-title">Đăng nhập để báo cáo lỗi</div>
                            <div class="empty-state-text">Bạn cần đăng nhập để gửi báo cáo lỗi sản phẩm</div>
                        </div>
                        `}
                    </div>

                    <!-- Tab: Video -->
                    <div class="tab-content" id="tab-video">
                        <h3 style="font-size:1rem; font-weight:600; margin-bottom:1rem;">Video hướng dẫn đăng nhập & sử dụng</h3>
                        ${product.videoUrl ? `
                        <div class="video-container">
                            <iframe src="${product.videoUrl}" allowfullscreen></iframe>
                        </div>
                        ` : `
                        <div class="video-container">
                            <div class="video-placeholder">
                                <div class="empty-state-title">Video đang được cập nhật</div>
                                <div class="empty-state-text">Video hướng dẫn cho sản phẩm này sẽ sớm được thêm vào</div>
                            </div>
                        </div>
                        `}
                    </div>

                    <!-- Tab: Docs -->
                    <div class="tab-content" id="tab-docs">
                        <div class="docs-content" style="max-width:700px;">
                            ${product.docs || '<div class="empty-state"><div class="empty-state-text">Tài liệu đang được cập nhật</div></div>'}
                        </div>
                    </div>
                </div>

                <!-- RIGHT: Purchase Panel (sticky) -->
                <div style="position:sticky;top:80px;">
                    <div style="background:#1c1c1e;border:1px solid rgba(168,85,247,0.18);border-radius:16px;padding:24px;box-shadow:0 0 30px rgba(168,85,247,0.05),0 4px 20px rgba(0,0,0,0.3);">
                        ${isLoggedIn() ? `
                        <h3 style="font-size:15px;font-weight:600;color:rgba(255,255,255,0.5);margin-bottom:4px;">Đặt mua ${product.name}</h3>
                        <div style="font-size:26px;font-weight:800;color:#a855f7;margin-bottom:16px;letter-spacing:-0.5px;" id="purchasePanelPrice">
                            ${flashSalePrice ? `
                                <span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:middle;">-${flashDiscount}%</span>
                            ` : 'Từ '}${getInitialPrice()}
                        </div>

                        ${product.accountTypes ? `
                        <!-- Account Type Selector -->
                        <div class="form-group">
                            <label class="form-label" style="font-size:13px;">Loại tài khoản</label>
                            <div class="account-type-selector">
                                ${product.accountTypes.map((at, idx) => `
                                <label class="account-type-option ${idx === 0 ? 'active' : ''}">
                                    <input type="radio" name="accountType" value="${at.type}" ${idx === 0 ? 'checked' : ''} onchange="updateProductPrice('${product.id}')">
                                    <div class="account-type-content">
                                        <div class="account-type-label">${at.label}</div>
                                        <div class="account-type-desc">${at.type === 'owned' ? 'Nhập email → Admin nâng cấp cho bạn' : 'Nhận TK trong 1 giờ'}</div>
                                    </div>
                                </label>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Duration Selector -->
                        <div class="form-group">
                            <label class="form-label" style="font-size:13px;">Thời hạn</label>
                            <div class="month-tabs">
                                ${(() => {
                                    let first = true;
                                    return [1, 3, 6, 12].map(m => {
                                        const hasPrice = product.accountTypes?.some(at => at.prices?.[m] && at.prices[m] > 0);
                                        if (!hasPrice) return '';
                                        const isActive = first;
                                        if (first) first = false;
                                        return '<button type="button" class="month-tab ' + (isActive ? 'active' : '') + '" onclick="selectMonth(' + m + ', \'' + product.id + '\', this)">' + m + ' tháng</button>';
                                    }).join('');
                                })()}
                            </div>
                        </div>
                        ` : ''}

                        <form onsubmit="purchaseProduct(event, '${product.id}')">
                            <div class="form-group" id="emailGroup" style="display:${product.accountTypes && product.accountTypes[0]?.type !== 'owned' ? 'none' : 'block'};">
                                <label class="form-label" style="font-size:13px;">Email cần nâng cấp</label>
                                <input type="email" class="form-input" id="purchaseEmail" placeholder="email@example.com">
                                <p class="form-hint" id="emailHint">Nhập email của tài khoản bạn muốn nâng cấp</p>
                            </div>

                            <!-- Coupon Code -->\r
                            <div class="form-group" style="margin-bottom:12px;">\r
                                <label class="form-label" style="font-size:12px;">Mã giảm giá</label>\r
                                <div style="display:flex;gap:6px;">\r
                                    <input type="text" class="form-input" id="couponCode" placeholder="NHẬP MÃ GIẢM GIÁ..." style="flex:1;text-transform:uppercase;padding:8px 12px;font-size:13px;">\r
                                    <button type="button" class="btn btn-ghost" style="flex-shrink:0;padding:7px 14px;font-size:12px;" onclick="applyCoupon('${product.id}')">Áp dụng</button>\r
                                </div>\r
                                <div id="couponResult" style="margin-top:4px;font-size:11px;"></div>\r
                            </div>\r
\r
                            <div class="form-group" style="margin-bottom:12px;">\r
                                <label class="form-label" style="font-size:12px;">Ghi chú (tùy chọn)</label>\r
                                <textarea class="form-textarea" id="purchaseNote" placeholder="Ghi chú thêm..." rows="1" style="min-height:36px;padding:8px 12px;font-size:13px;"></textarea>\r
                            </div>

                            <!-- Order Summary -->
                            <div class="purchase-summary" style="margin-bottom:16px;">
                                <div class="summary-row">
                                    <span>Sản phẩm:</span>
                                    <span>${product.name}</span>
                                </div>
                                <div class="summary-row">
                                    <span>Loại TK:</span>
                                    <span id="summaryType">${product.accountTypes ? product.accountTypes[0].label : 'Cấp'}</span>
                                </div>
                                <div class="summary-row">
                                    <span>Thời hạn:</span>
                                    <span id="summaryMonths">${getFirstMonth()} tháng</span>
                                </div>
                                <div class="summary-row" id="couponSummaryRow" style="display:none;color:#22c55e;">
                                    <span>Giảm giá:</span>
                                    <span id="couponDiscount">-0đ</span>
                                </div>
                                <div class="summary-row summary-total">
                                    <span>Thanh toán:</span>
                                    <span id="summaryPrice" style="font-size:20px;font-weight:800;color:var(--accent);">${getInitialPrice()}</span>
                                </div>
                            </div>
                            <input type="hidden" id="selectedAccountType" value="shared">
                            <input type="hidden" id="selectedMonths" value="${getFirstMonth()}">
                            <input type="hidden" id="appliedCouponDiscount" value="0">
                            ${outOfStock ? `
                            <button type="button" class="btn btn-lg btn-full" disabled style="background:#555;color:#999;cursor:not-allowed;">Sản phẩm đã hết hàng</button>
                            ` : `
                            <button type="submit" class="btn btn-primary btn-lg btn-full" style="background:white;color:black;font-size:16px;font-weight:700;">Xác nhận mua hàng</button>
                            `}
                        </form>
                        ` : `
                        <h3 style="font-size:15px;font-weight:600;color:rgba(255,255,255,0.5);margin-bottom:4px;">Đặt mua ${product.name}</h3>
                        <div style="font-size:26px;font-weight:800;color:#a855f7;margin-bottom:16px;letter-spacing:-0.5px;" id="purchasePanelPrice">
                            ${flashSalePrice ? `
                                <span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:middle;">-${flashDiscount}%</span>
                            ` : 'Từ '}${getInitialPrice()}
                        </div>

                        ${product.accountTypes ? `
                        <!-- Account Type Selector -->
                        <div class="form-group">
                            <label class="form-label" style="font-size:13px;">Loại tài khoản</label>
                            <div class="account-type-selector">
                                ${product.accountTypes.map((at, idx) => `
                                <label class="account-type-option ${idx === 0 ? 'active' : ''}">
                                    <input type="radio" name="accountType" value="${at.type}" ${idx === 0 ? 'checked' : ''} onchange="updateProductPrice('${product.id}')">
                                    <div class="account-type-content">
                                        <div class="account-type-label">${at.label}</div>
                                        <div class="account-type-desc">${at.type === 'owned' ? 'Nhập email → Admin nâng cấp cho bạn' : 'Nhận TK trong 1 giờ'}</div>
                                    </div>
                                </label>
                                `).join('')}
                            </div>
                        </div>

                        <!-- Duration Selector -->
                        <div class="form-group">
                            <label class="form-label" style="font-size:13px;">Thời hạn</label>
                            <div class="month-tabs">
                                ${(() => {
                                    let first = true;
                                    return [1, 3, 6, 12].map(m => {
                                        const hasPrice = product.accountTypes?.some(at => at.prices?.[m] && at.prices[m] > 0);
                                        if (!hasPrice) return '';
                                        const isActive = first;
                                        if (first) first = false;
                                        return '<button type="button" class="month-tab ' + (isActive ? 'active' : '') + '" onclick="selectMonth(' + m + ', \'' + product.id + '\', this)">' + m + ' tháng</button>';
                                    }).join('');
                                })()}
                            </div>
                        </div>
                        ` : ''}

                        <form onsubmit="guestCheckout(event, '${product.id}')">
                            <!-- Guest Info -->
                            <div style="background:rgba(168,85,247,0.06);border:1px solid rgba(168,85,247,0.12);border-radius:10px;padding:14px;margin-bottom:12px;">
                                <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.6);margin-bottom:10px;display:flex;align-items:center;gap:6px;">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                    Thông tin liên hệ
                                </div>
                                <div class="form-group" style="margin-bottom:8px;">
                                    <input type="text" class="form-input" id="guestName" placeholder="Họ tên *" required style="padding:8px 12px;font-size:13px;">
                                </div>
                                <div class="form-group" style="margin-bottom:0;">
                                    <input type="text" class="form-input" id="guestPhone" placeholder="Số Zalo / SĐT *" required style="padding:8px 12px;font-size:13px;">
                                </div>
                            </div>

                            <div class="form-group" id="emailGroup" style="display:${product.accountTypes && product.accountTypes[0]?.type !== 'owned' ? 'none' : 'block'};">
                                <label class="form-label" style="font-size:13px;">Email cần nâng cấp</label>
                                <input type="email" class="form-input" id="purchaseEmail" placeholder="email@example.com">
                                <p class="form-hint" id="emailHint">Nhập email của tài khoản bạn muốn nâng cấp</p>
                            </div>

                            <!-- Coupon Code -->
                            <div class="form-group">
                                <label class="form-label" style="font-size:13px;">Mã giảm giá</label>
                                <div style="display:flex;gap:8px;">
                                    <input type="text" class="form-input" id="couponCode" placeholder="Nhập mã giảm giá..." style="flex:1;text-transform:uppercase;">
                                    <button type="button" class="btn btn-ghost" style="flex-shrink:0;padding:8px 16px;font-size:13px;" onclick="applyCoupon('${product.id}')">Áp dụng</button>
                                </div>
                                <div id="couponResult" style="margin-top:6px;font-size:12px;"></div>
                            </div>

                            <div class="form-group">
                                <label class="form-label" style="font-size:13px;">Ghi chú (tùy chọn)</label>
                                <textarea class="form-textarea" id="purchaseNote" placeholder="Ghi chú thêm cho đơn hàng..." rows="2" style="min-height:50px;"></textarea>
                            </div>

                            <!-- Order Summary -->
                            <div class="purchase-summary" style="margin-bottom:16px;">
                                <div class="summary-row">
                                    <span>Sản phẩm:</span>
                                    <span>${product.name}</span>
                                </div>
                                <div class="summary-row">
                                    <span>Loại TK:</span>
                                    <span id="summaryType">${product.accountTypes ? product.accountTypes[0].label : 'Cấp'}</span>
                                </div>
                                <div class="summary-row">
                                    <span>Thời hạn:</span>
                                    <span id="summaryMonths">${getFirstMonth()} tháng</span>
                                </div>
                                <div class="summary-row" id="couponSummaryRow" style="display:none;color:#22c55e;">
                                    <span>Giảm giá:</span>
                                    <span id="couponDiscount">-0đ</span>
                                </div>
                                <div class="summary-row summary-total">
                                    <span>Thanh toán:</span>
                                    <span id="summaryPrice" style="font-size:20px;font-weight:800;color:var(--accent);">${getInitialPrice()}</span>
                                </div>
                            </div>
                            <input type="hidden" id="selectedAccountType" value="shared">
                            <input type="hidden" id="selectedMonths" value="${getFirstMonth()}">
                            <input type="hidden" id="appliedCouponDiscount" value="0">
                            ${outOfStock ? `
                            <button type="button" class="btn btn-lg btn-full" disabled style="background:#555;color:#999;cursor:not-allowed;">Sản phẩm đã hết hàng</button>
                            ` : `
                            <button type="submit" class="btn btn-primary btn-lg btn-full" style="font-size:16px;font-weight:700;">Đặt hàng</button>
                            `}
                        </form>
                        `}
                    </div>
                </div>
            </div>
        </div>
    `;
}


// --- Coupon Code ---
async function applyCoupon(productId) {
    const code = document.getElementById('couponCode')?.value?.trim().toUpperCase();
    const resultEl = document.getElementById('couponResult');
    if (!code) {
        if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444;">Vui lòng nhập mã giảm giá</span>';
        return;
    }
    try {
        // Lấy giá hiện tại để gửi kèm cho server kiểm tra min_order_value
        const product = _productsCache.find(p => p.id === productId);
        const currentType = document.getElementById('selectedAccountType')?.value || 'shared';
        const currentMonths = parseInt(document.getElementById('selectedMonths')?.value) || 1;
        const currentPrice = product ? getProductPrice(product, currentType, currentMonths) : 0;
        const data = await Api.post('/coupons/validate', { code, productId, basePrice: currentPrice });
        if (data.success) {
            const discount = data.discount || 0;
            document.getElementById('appliedCouponDiscount').value = discount;
            if (resultEl) resultEl.innerHTML = `<span style="color:#22c55e;">✓ Áp dụng thành công! Giảm ${data.discountPercent || discount}${data.discountPercent ? '%' : 'đ'}</span>`;
            const couponRow = document.getElementById('couponSummaryRow');
            const couponDiscountEl = document.getElementById('couponDiscount');
            if (couponRow) couponRow.style.display = 'flex';
            if (couponDiscountEl) couponDiscountEl.textContent = '-' + formatPrice(discount);
            const product = _productsCache.find(p => p.id === productId);
            if (product) {
                const type = document.getElementById('selectedAccountType')?.value || 'shared';
                const months = parseInt(document.getElementById('selectedMonths')?.value) || 1;
                const price = getProductPrice(product, type, months);
                const finalPrice = Math.max(0, price - discount);
                const summaryPriceEl = document.getElementById('summaryPrice');
                if (summaryPriceEl) summaryPriceEl.textContent = formatPrice(finalPrice);
            }
        } else {
            document.getElementById('appliedCouponDiscount').value = '0';
            if (resultEl) resultEl.innerHTML = `<span style="color:#ef4444;">✗ ${data.message || 'Mã không hợp lệ'}</span>`;
            const couponRow = document.getElementById('couponSummaryRow');
            if (couponRow) couponRow.style.display = 'none';
        }
    } catch (err) {
        if (resultEl) resultEl.innerHTML = '<span style="color:#ef4444;">Lỗi kiểm tra mã</span>';
    }
}

function switchTab(tabName, btn) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

// --- Purchase Helpers ---
function selectMonth(months, productId, btn) {
    document.querySelectorAll('.month-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('selectedMonths').value = months;
    document.getElementById('summaryMonths').textContent = months + ' tháng';
    updateProductPrice(productId);
}

function updateProductPrice(productId) {
    const products = _productsCache;
    const p = products.find(prod => prod.id === productId);
    if (!p || !p.accountTypes) return;

    const selectedType = document.querySelector('input[name="accountType"]:checked').value;
    const selectedMonths = parseInt(document.getElementById('selectedMonths').value);
    
    // Update active state in UI
    document.querySelectorAll('.account-type-option').forEach(opt => {
        const radio = opt.querySelector('input');
        if (radio.value === selectedType) opt.classList.add('active');
        else opt.classList.remove('active');
    });

    const at = p.accountTypes.find(t => t.type === selectedType);
    const basePrice = at?.prices?.[selectedMonths];

    // Check for flash sale discount
    const fsd = _flashSalesCache.find(fs => fs.product && fs.product.id === productId);
    const discountPct = fsd ? fsd.discountPercent : 0;
    const finalPrice = discountPct > 0 && basePrice ? Math.round(basePrice * (1 - discountPct / 100)) : basePrice;

    const priceEl = document.getElementById('purchasePanelPrice');
    if (discountPct > 0 && basePrice) {
        if (priceEl) priceEl.innerHTML = `<span style="background:#dc2626;color:#fff;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px;margin-right:6px;vertical-align:middle;">-${discountPct}%</span>${formatPrice(finalPrice)}<span style="font-size:14px;color:var(--text-tertiary);text-decoration:line-through;margin-left:8px;font-weight:400;">${formatPrice(basePrice)}</span>`;
    } else {
        if (priceEl) priceEl.textContent = basePrice ? formatPrice(basePrice) : 'Li\u00ean h\u1ec7';
    }
    const summaryPriceEl = document.getElementById('summaryPrice');
    if (summaryPriceEl) summaryPriceEl.textContent = finalPrice ? formatPrice(finalPrice) : 'Li\u00ean h\u1ec7';
    document.getElementById('summaryType').textContent = at.label;
    document.getElementById('selectedAccountType').value = selectedType;

    // Toggle email group visibility
    const emailGroup = document.getElementById('emailGroup');
    const emailInput = document.getElementById('purchaseEmail');
    const emailHint = document.getElementById('emailHint');
    if (selectedType === 'owned') {
        if (emailGroup) emailGroup.style.display = 'block';
        if (emailInput) emailInput.required = true;
        emailHint.innerHTML = '<span style="color:var(--accent); font-weight:600;"> Chính chủ:</span> Nhập email cần nâng cấp, admin sẽ xử lý và xác nhận.';
    } else {
        if (emailGroup) emailGroup.style.display = 'none';
        if (emailInput) { emailInput.required = false; emailInput.value = ''; }
        emailHint.innerHTML = '<span style="color:var(--text-tertiary);">Xử lý trong tối đa 1 giờ. Quá hạn hoàn tiền 100%.</span>';
    }
}

function getProductPrice(product, type, months) {
    if (!product.accountTypes) return product.price;
    const at = product.accountTypes.find(t => t.type === type);
    const basePrice = at ? at.prices[months] : product.price;
    // Apply flash sale discount if applicable
    const fsd = _flashSalesCache.find(fs => fs.product && fs.product.id === product.id);
    if (fsd && basePrice) {
        return Math.round(basePrice * (1 - fsd.discountPercent / 100));
    }
    return basePrice;
}

// --- Purchase ---
function purchaseProduct(e, productId) {
    e.preventDefault();
    if (!isLoggedIn()) { navigate('login'); return; }

    const products = _productsCache;
    const product = products.find(p => p.id === productId);
    if (!product) { showToast('Sản phẩm không tồn tại', 'error'); return; }
    if (product.inStock === false) { showToast('Sản phẩm đã hết hàng', 'error'); return; }

    const type = document.getElementById('selectedAccountType') ? document.getElementById('selectedAccountType').value : 'shared';
    const months = document.getElementById('selectedMonths') ? parseInt(document.getElementById('selectedMonths').value) : 1;
    const finalPrice = getProductPrice(product, type, months);

    const tier = product.accountTypes ? product.accountTypes.find(at => at.type === type) : null;
    const typeLabel = tier ? tier.label : type;

    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang xử lý...'; }

    // Get upgradeEmail for owned type
    const upgradeEmail = type === 'owned' ? (document.getElementById('purchaseEmail')?.value || '').trim() : '';

    // Get applied coupon code
    const couponCode = document.getElementById('couponCode')?.value?.trim().toUpperCase() || '';
    const couponDiscount = parseInt(document.getElementById('appliedCouponDiscount')?.value) || 0;

    Api.post('/orders', {
        productId,
        productName: product.name,
        accountType: type,
        accountTypeLabel: typeLabel,
        duration: months,
        price: couponDiscount > 0 ? Math.max(0, finalPrice - couponDiscount) : finalPrice,
        upgradeEmail: upgradeEmail || undefined,
        couponCode: couponDiscount > 0 ? couponCode : undefined
    })
        .then(data => {
            if (data.success) {
                currentUser = data.user;
                Storage.set('currentUser', data.user);
                updateAuthUI();
                showToast(data.message, 'success');
                navigate('orders');
            } else {
                showToast(data.message || 'Mua hàng thất bại', 'error');
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Đặt hàng'; } });
}

// --- Guest Checkout ---
function guestCheckout(e, productId) {
    e.preventDefault();

    const customerName = (document.getElementById('guestName')?.value || '').trim();
    const customerPhone = (document.getElementById('guestPhone')?.value || '').trim();

    if (!customerName) { showToast('Vui lòng nhập họ tên', 'error'); return; }
    if (!customerPhone) { showToast('Vui lòng nhập số Zalo/SĐT', 'error'); return; }

    const products = _productsCache;
    const product = products.find(p => p.id === productId);
    if (!product) { showToast('Sản phẩm không tồn tại', 'error'); return; }
    if (product.inStock === false) { showToast('Sản phẩm đã hết hàng', 'error'); return; }

    const type = document.getElementById('selectedAccountType') ? document.getElementById('selectedAccountType').value : 'shared';
    const months = document.getElementById('selectedMonths') ? parseInt(document.getElementById('selectedMonths').value) : 1;
    const finalPrice = getProductPrice(product, type, months);

    const tier = product.accountTypes ? product.accountTypes.find(at => at.type === type) : null;
    const typeLabel = tier ? tier.label : type;

    const note = document.getElementById('purchaseNote')?.value || '';
    const affiliateCode = getReferralCode() || '';

    // Get upgradeEmail for owned type (chính chủ / nâng cấp)
    const upgradeEmail = type === 'owned' ? (document.getElementById('purchaseEmail')?.value || '').trim() : '';

    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang xử lý...'; }

    // Get applied coupon code
    const couponCode = document.getElementById('couponCode')?.value?.trim().toUpperCase() || '';
    const couponDiscount = parseInt(document.getElementById('appliedCouponDiscount')?.value) || 0;

    fetch('/api/orders/guest-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            customerName,
            customerPhone,
            productId,
            productName: product.name,
            accountType: type,
            accountTypeLabel: typeLabel,
            duration: months,
            price: couponDiscount > 0 ? Math.max(0, finalPrice - couponDiscount) : finalPrice,
            note: note || undefined,
            affiliateCode: affiliateCode || undefined,
            couponCode: couponDiscount > 0 ? couponCode : undefined,
            upgradeEmail: upgradeEmail || undefined,
        }),
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                showGuestPaymentModal(data.order, data.payment);
            } else {
                showToast(data.message || 'Đặt hàng thất bại', 'error');
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { if (btn) { btn.disabled = false; btn.textContent = 'Đặt hàng'; } });
}

// --- Guest Payment QR Modal ---
let _guestPaymentPoll = null;

function showGuestPaymentModal(order, payment) {
    // Stop any existing poll
    if (_guestPaymentPoll) clearInterval(_guestPaymentPoll);

    const existing = document.getElementById('guestPaymentModal');
    if (existing) existing.remove();

    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-left:6px;opacity:0.6;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    const modal = document.createElement('div');
    modal.id = 'guestPaymentModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;padding:16px;';

    modal.innerHTML = `
        <div style="background:#0a0a0a;border-radius:16px;max-width:840px;width:100%;max-height:92vh;overflow-y:auto;display:flex;position:relative;border:1px solid rgba(255,255,255,0.08);">

            <!-- LEFT PANEL: Order Summary -->
            <div style="flex:1;padding:40px 36px;border-right:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;min-width:0;">

                <!-- Logo -->
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:32px;">
                    <img src="/assets/logo_brand.png" alt="AI4DEV" style="width:32px;height:32px;border-radius:8px;">
                    <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:-0.3px;">AI4DEV</span>
                </div>

                <!-- Title -->
                <p style="color:rgba(255,255,255,0.5);font-size:13px;margin:0 0 6px;font-weight:500;">Thanh toán đơn hàng</p>
                <div style="font-size:36px;font-weight:800;color:#fff;letter-spacing:-1px;margin-bottom:32px;line-height:1.1;">
                    ${payment.amount.toLocaleString('vi-VN')}<span style="font-size:16px;font-weight:500;color:rgba(255,255,255,0.4);margin-left:2px;">VND</span>
                </div>

                <!-- Order Details Card -->
                <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:20px;">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                        <div style="width:40px;height:40px;background:linear-gradient(135deg,#a855f7,#6366f1);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                        </div>
                        <div style="min-width:0;">
                            <div style="font-size:14px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${order.productName}</div>
                            <div style="font-size:12px;color:rgba(255,255,255,0.4);">${order.accountTypeLabel || order.accountType} / ${order.duration} tháng</div>
                        </div>
                        <div style="margin-left:auto;font-size:14px;font-weight:700;color:#fff;white-space:nowrap;">${payment.amount.toLocaleString('vi-VN')}đ</div>
                    </div>
                </div>

                <!-- Subtotal -->
                <div style="padding:0 4px;flex:1;">
                    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.5);font-size:13px;">Khách hàng</span>
                        <span style="color:#fff;font-size:13px;font-weight:500;">${order.customerName}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.5);font-size:13px;">Liên hệ</span>
                        <span style="color:#fff;font-size:13px;font-weight:500;">${order.customerPhone}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.5);font-size:13px;">Mã đơn</span>
                        <span style="color:var(--accent);font-size:13px;font-weight:700;">${order.orderCode}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid rgba(255,255,255,0.1);margin-top:4px;">
                        <span style="color:#fff;font-size:14px;font-weight:700;">Tổng thanh toán</span>
                        <span style="color:#fff;font-size:14px;font-weight:800;">${payment.amount.toLocaleString('vi-VN')}đ</span>
                    </div>
                </div>
            </div>

            <!-- RIGHT PANEL: QR + Bank Info -->
            <div style="flex:1;padding:40px 36px;display:flex;flex-direction:column;min-width:0;">

                <!-- Close button -->
                <button onclick="closeGuestPaymentModal()" style="position:absolute;top:16px;right:20px;background:rgba(255,255,255,0.06);border:none;color:rgba(255,255,255,0.5);cursor:pointer;width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.12)';this.style.color='#fff'" onmouseout="this.style.background='rgba(255,255,255,0.06)';this.style.color='rgba(255,255,255,0.5)'" title="Đóng">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>

                <p style="font-size:15px;font-weight:700;color:#fff;margin:0 0 20px;">Quét mã thanh toán</p>

                <!-- QR Code -->
                <div style="background:#fff;border-radius:12px;padding:12px;text-align:center;margin-bottom:20px;">
                    <img src="${payment.qrUrl}" alt="QR" style="width:100%;max-width:240px;border-radius:6px;display:block;margin:0 auto;" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22240%22><rect fill=%22%23f5f5f5%22 width=%22240%22 height=%22240%22/><text x=%22120%22 y=%22120%22 text-anchor=%22middle%22 fill=%22%23999%22 font-size=%2214%22>QR Error</text></svg>'">
                </div>

                <!-- Bank Info -->
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:12px;padding:16px;margin-bottom:20px;font-size:13px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;">
                        <span style="color:rgba(255,255,255,0.45);">Ngân hàng</span>
                        <span style="color:#fff;font-weight:600;">MB - MBBank</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.45);">Số TK</span>
                        <span style="color:#fff;font-weight:600;cursor:pointer;display:flex;align-items:center;" onclick="navigator.clipboard.writeText('${payment.bankAccount}');showToast('Đã copy số tài khoản','success');">${payment.bankAccount}${copyIcon}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.45);">Chủ TK</span>
                        <span style="color:#fff;font-weight:600;">${payment.bankName}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.45);">Số tiền</span>
                        <span style="color:#a855f7;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;" onclick="navigator.clipboard.writeText('${payment.amount}');showToast('Đã copy số tiền','success');">${payment.amount.toLocaleString('vi-VN')}đ${copyIcon}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,0.06);">
                        <span style="color:rgba(255,255,255,0.45);">Nội dung CK</span>
                        <span style="color:#22c55e;font-weight:700;cursor:pointer;display:flex;align-items:center;" onclick="navigator.clipboard.writeText('${payment.transferContent}');showToast('Đã copy nội dung CK','success');">${payment.transferContent}${copyIcon}</span>
                    </div>
                </div>

                <!-- Payment Status -->
                <div id="guestPaymentStatus" style="text-align:center;padding:14px 16px;border-radius:10px;background:rgba(234,179,8,0.08);border:1px solid rgba(234,179,8,0.15);">
                    <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                        <div style="width:8px;height:8px;background:#eab308;border-radius:50%;animation:pulse 2s infinite;"></div>
                        <span style="color:#eab308;font-weight:600;font-size:13px;">Đang chờ thanh toán...</span>
                    </div>
                    <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:6px;">Hệ thống sẽ tự động xác nhận khi nhận được chuyển khoản</p>
                </div>
            </div>
        </div>

        <!-- Mobile responsive: collapse to single column -->
        <style>
            @media (max-width: 700px) {
                #guestPaymentModal > div:first-child {
                    flex-direction: column !important;
                    max-width: 440px !important;
                }
                #guestPaymentModal > div:first-child > div:first-child {
                    border-right: none !important;
                    border-bottom: 1px solid rgba(255,255,255,0.08) !important;
                    padding: 28px 24px !important;
                }
                #guestPaymentModal > div:first-child > div:nth-child(2) {
                    padding: 24px 24px !important;
                }
            }
        </style>
    `;

    document.body.appendChild(modal);

    // Close on backdrop click
    modal.addEventListener('click', e => { if (e.target === modal) closeGuestPaymentModal(); });

    // Auto-poll payment status every 5 seconds
    _guestPaymentPoll = setInterval(async () => {
        try {
            const resp = await fetch('/api/orders/guest-check-payment/' + encodeURIComponent(order.orderCode));
            const data = await resp.json();
            if (data.success && data.paymentStatus === 'paid') {
                clearInterval(_guestPaymentPoll);
                _guestPaymentPoll = null;
                const statusEl = document.getElementById('guestPaymentStatus');
                if (statusEl) {
                    statusEl.style.background = 'rgba(34,197,94,0.08)';
                    statusEl.style.borderColor = 'rgba(34,197,94,0.2)';
                    statusEl.innerHTML = `
                        <div style="display:flex;align-items:center;justify-content:center;gap:8px;">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                            <span style="color:#22c55e;font-weight:700;font-size:14px;">Thanh toán thành công!</span>
                        </div>
                        <p style="color:rgba(255,255,255,0.35);font-size:11px;margin-top:6px;">Đơn hàng đã được ghi nhận. Admin sẽ xử lý trong thời gian sớm nhất.</p>
                    `;
                }
                showToast('Thanh toán thành công! Đơn hàng đã được ghi nhận.', 'success');
            }
        } catch (e) { /* ignore polling errors */ }
    }, 5000);
}

function closeGuestPaymentModal() {
    if (_guestPaymentPoll) { clearInterval(_guestPaymentPoll); _guestPaymentPoll = null; }
    const modal = document.getElementById('guestPaymentModal');
    if (modal) modal.remove();
}

// --- Reviews ---
async function submitReview(e, productId) {
    e.preventDefault();
    if (selectedRating === 0) {
        showToast('Vui lòng chọn số sao đánh giá', 'error');
        return;
    }
    const text = document.getElementById('reviewText').value;
    try {
        const data = await Api.post(`/products/${productId}/reviews`, { rating: selectedRating, text });
        if (data.success) {
            showToast('Cảm ơn bạn đã đánh giá!', 'success');
            await loadProducts(); // refresh cache
            navigate('product-detail', { id: productId });
        } else {
            showToast(data.message || 'Lỗi gửi đánh giá', 'error');
        }
    } catch (err) {
        showToast('Lỗi gửi đánh giá', 'error');
    }
}

// --- Comments ---
async function submitComment(e, productId) {
    e.preventDefault();
    const text = document.getElementById('commentText').value;
    try {
        const data = await Api.post(`/products/${productId}/comments`, { text });
        if (data.success) {
            showToast('Bình luận đã được gửi!', 'success');
            navigate('product-detail', { id: productId });
        } else {
            showToast(data.message || 'Lỗi gửi bình luận', 'error');
        }
    } catch (err) {
        showToast('Lỗi gửi bình luận', 'error');
    }
}

// --- Bug Reports ---
function submitBugReport(e, productId) {
    e.preventDefault();
    const type = document.getElementById('bugType').value;
    const description = document.getElementById('bugDescription').value;
    const email = document.getElementById('bugEmail').value;

    // Bug reports not yet stored on server — keep local for now
    const reports = Storage.get('bugReports', []);
    reports.push({
        id: Date.now().toString(),
        productId,
        userId: currentUser?.id,
        type,
        description,
        email,
        status: 'pending',
        date: new Date().toISOString().split('T')[0]
    });
    Storage.set('bugReports', reports);

    showToast('Báo cáo lỗi đã được gửi. Cảm ơn bạn!', 'success');
    navigate('product-detail', { id: productId });
}

// --- Login Page ---
function renderLoginPage() {
    return `
        <div class="auth-page">
            <div class="auth-card">
                <h2 class="auth-title">Đăng nhập</h2>
                <p class="auth-subtitle">Nhập thông tin tài khoản của bạn</p>
                <form onsubmit="login(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="loginEmail" placeholder="email@example.com" autocomplete="email">
                        <span class="form-error" id="loginEmailError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mật khẩu</label>
                        <input type="password" class="form-input" id="loginPassword" placeholder="Nhập mật khẩu" autocomplete="current-password">
                        <span class="form-error" id="loginPasswordError"></span>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Đăng nhập</button>
                </form>
                <div class="auth-footer">
                    <a href="javascript:void(0)" onclick="navigate('forgot-password')" style="color:var(--accent);">Quên mật khẩu?</a>
                </div>
                <!-- Đăng ký đã tạm dừng -->

            </div>
        </div>
    `;
}

// --- Register Page ---
function renderRegisterPage() {
    return `
        <div class="auth-page">
            <div class="auth-card">
                <h2 class="auth-title">Tạo tài khoản</h2>
                <p class="auth-subtitle">Đăng ký để mua tài khoản AI</p>
                <form onsubmit="register(event)">
                    <div class="form-group">
                        <label class="form-label">Họ và tên</label>
                        <input type="text" class="form-input" id="regName" placeholder="Nguyễn Văn A" autocomplete="name">
                        <span class="form-error" id="regNameError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="regEmail" placeholder="email@example.com" autocomplete="email">
                        <span class="form-error" id="regEmailError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mật khẩu</label>
                        <input type="password" class="form-input" id="regPassword" placeholder="Tạo mật khẩu" autocomplete="new-password">
                        <span class="form-error" id="regPasswordError"></span>
                        <p class="form-hint">Tối thiểu 6 ký tự, có 1 chữ hoa và 1 chữ số</p>
                    </div>
                    <!-- Hidden input: tự động điền referral_code từ Cookie -->
                    <input type="hidden" name="referred_by" id="regReferredBy">
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Đăng ký</button>
                </form>
                <div class="auth-footer">
                    Đã có tài khoản? <a href="javascript:void(0)" onclick="navigate('login')">Đăng nhập</a>
                </div>
            </div>
        </div>
    `;
}

// --- Complete Profile Page ---
function renderCompleteProfilePage() {
    const isCompleted = currentUser?.profile_completed;
    return `
        <div class="auth-page">
            <div class="auth-card" style="max-width:480px;">
                <div style="text-align:center; margin-bottom:24px;">
                    <div style="font-size:40px; margin-bottom:8px;">📋</div>
                    <h2 class="auth-title">Hoàn thiện hồ sơ</h2>
                    <p class="auth-subtitle">Thông tin này được dùng để hỗ trợ và hoàn tiền khi cần thiết</p>
                </div>

                <div class="commitment-list" style="margin-bottom:24px;">
                    <div class="commitment-item">
                        <span class="commitment-icon">📱</span>
                        <span>Số <strong>Zalo</strong> để đội ngũ hỗ trợ liên hệ khi có sự cố</span>
                    </div>
                    <div class="commitment-item">
                        <span class="commitment-icon">🏦</span>
                        <span>Số <strong>tài khoản ngân hàng</strong> để hoàn tiền tự động nếu sản phẩm gặp lỗi</span>
                    </div>
                </div>

                <form onsubmit="completeProfile(event)">
                    <div class="form-group">
                        <label class="form-label">Số Zalo (dùng để hỗ trợ)</label>
                        <input type="tel" class="form-input" id="cpZalo"
                               placeholder="0987654321"
                               value="${currentUser?.phone_zalo || ''}"
                               maxlength="11">
                        <span class="form-error" id="cpZaloError"></span>
                        <p class="form-hint">Số điện thoại Zalo của bạn (bắt đầu bằng 0)</p>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Số tài khoản ngân hàng</label>
                        <input type="text" class="form-input" id="cpBankAccount"
                               placeholder="123456789012"
                               value="${currentUser?.bank_account || ''}"
                               inputmode="numeric" maxlength="20">
                        <span class="form-error" id="cpBankAccountError"></span>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Tên ngân hàng</label>
                        <select class="form-select" id="cpBankName">
                            <option value="">Chọn ngân hàng...</option>
                            ${[
                                'Vietcombank', 'BIDV', 'Agribank', 'Vietinbank', 'Techcombank',
                                'MB Bank', 'ACB', 'Sacombank', 'VPBank', 'TPBank', 'OCB',
                                'HDBank', 'SHB', 'MSB', 'VIB', 'SeABank', 'Eximbank', 'Ngân hàng khác'
                            ].map(b => `<option value="${b}" ${currentUser?.bank_name === b ? 'selected' : ''}>${b}</option>`).join('')}
                        </select>
                        <span class="form-error" id="cpBankNameError"></span>
                    </div>

                    <button type="submit" class="btn btn-primary btn-full btn-lg">Lưu thông tin</button>
                    <button type="button" class="btn btn-outline btn-full" style="margin-top:10px;" onclick="navigate('home')">
                        Bỏ qua (có thể cập nhật sau)
                    </button>
                </form>
            </div>
        </div>
    `;
}

// --- Customers Page ---
function renderCustomersPage() {
    const defaultTestimonials = [
        
    ];
    const adminTestimonials = Storage.get('testimonials', []);
    const testimonials = [...adminTestimonials, ...defaultTestimonials];

    return `
        <div class="container">
            <section class="section">
                <div class="section-header" style="text-align:center; margin-bottom:40px;">
                    <h2 class="section-title" style="font-size:32px;">Khách hàng đã mua</h2>
                    <p class="section-subtitle">Phản hồi thực tế từ khách hàng kèm hình ảnh minh chứng</p>
                </div>
                <div class="grid-2">
                    ${testimonials.map(t => `
                        <div class="card" style="overflow:hidden;">
                            <div style="position:relative;">
                                <img src="${t.proofImg}" alt="Minh chứng ${t.product}" style="width:100%; aspect-ratio:3/4; max-height:280px; object-fit:cover; display:block;">
                                <span class="badge badge-trending" style="position:absolute; top:12px; right:12px;">Đã xác minh</span>
                            </div>
                            <div style="padding:20px;">
                                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                    <span style="font-weight:600; color:var(--white); font-size:15px;">${t.name}</span>
                                    <span style="font-size:12px; color:var(--text-tertiary);">${formatDate(t.date)}</span>
                                </div>
                                <div style="margin-bottom:8px;">
                                    <span class="badge badge-secondary">${t.product}</span>
                                    <span style="font-size:12px; color:var(--accent); margin-left:8px; font-weight:600;">${t.rating}/5</span>
                                </div>
                                <p style="font-size:13px; color:var(--text-secondary); line-height:1.5;">${t.text}</p>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </section>
        </div>
    `;
}

// --- Blog Page ---
function renderBlogPage() {
    const defaultPosts = [
        {
            id: 'b1',
            title: 'So sánh ChatGPT Plus vs Claude Pro: Đâu là AI tốt nhất cho lập trình?',
            excerpt: 'Phân tích chi tiết ưu nhược điểm của ChatGPT Plus và Claude Pro khi sử dụng cho lập trình. Đánh giá qua các tiêu chí: tốc độ, độ chính xác, context window...',
            date: '2026-02-22',
            category: 'So sánh',
            readTime: '8 phút'
        },
        {
            id: 'b2',
            title: 'Hướng dẫn sử dụng GitHub Copilot hiệu quả nhất 2026',
            excerpt: 'Tổng hợp 15 mẹo và thủ thuật giúp bạn tận dụng tối đa GitHub Copilot trong quá trình phát triển phần mềm. Từ cơ bản đến nâng cao...',
            date: '2026-02-19',
            category: 'Hướng dẫn',
            readTime: '12 phút'
        },
        {
            id: 'b3',
            title: 'Cursor AI: IDE tích hợp AI mạnh nhất hiện tại?',
            excerpt: 'Review chi tiết Cursor AI sau 3 tháng sử dụng. Tại sao nhiều developer đang chuyển từ VS Code sang Cursor và liệu nó có đáng giá...',
            date: '2026-02-16',
            category: 'Review',
            readTime: '10 phút'
        },
        {
            id: 'b4',
            title: 'Xu hướng AI 2026: Những công cụ developer không thể bỏ qua',
            excerpt: 'Tổng hợp các công cụ AI đang thay đổi cách developer làm việc trong năm 2026. Từ coding assistant đến design tool, từ testing đến deployment...',
            date: '2026-02-13',
            category: 'Xu hướng',
            readTime: '6 phút'
        },
        {
            id: 'b5',
            title: 'Midjourney vs DALL-E 3: Công cụ tạo ảnh AI nào tốt hơn?',
            excerpt: 'So sánh toàn diện Midjourney Pro và DALL-E 3 qua các tiêu chí: chất lượng ảnh, tốc độ, khả năng tùy chỉnh, giá cả và trải nghiệm sử dụng...',
            date: '2026-02-10',
            category: 'So sánh',
            readTime: '9 phút'
        },
        {
            id: 'b6',
            title: 'Cách bảo mật tài khoản AI Premium của bạn',
            excerpt: 'Hướng dẫn chi tiết cách bảo vệ tài khoản AI Premium: bật 2FA, sử dụng mật khẩu mạnh, nhận biết phishing và các biện pháp bảo mật khác...',
            date: '2026-02-07',
            category: 'Bảo mật',
            readTime: '5 phút'
        }
    ];
    const adminPosts = Storage.get('blogPosts', []);
    const posts = [...adminPosts, ...defaultPosts];

    const categoryColors = {
        'So sánh': 'badge-hot',
        'Hướng dẫn': 'badge-trending',
        'Review': 'badge-new',
        'Xu hướng': 'badge-secondary',
        'Bảo mật': 'badge-hot',
        'Mẹo vặt': 'badge-new'
    };

    return `
        <div class="container">
            <section class="section">
                <div class="section-header" style="text-align:center; margin-bottom:40px;">
                    <h2 class="section-title" style="font-size:32px;">Blog Công Nghệ</h2>
                    <p class="section-subtitle">Tin tức, hướng dẫn và xu hướng AI mới nhất cho developer</p>
                </div>
                <div class="blog-grid">
                    ${posts.map(post => {
                        const stats = Storage.get('blogStats', {});
                        const s = stats[post.id] || { views: 0, likes: 0 };
                        return `
                        <article class="card blog-card" style="cursor:pointer;" onclick="navigate('blog-detail', {id: '${post.id}'})">
                            <div class="card-image" style="height:160px; ${post.imageUrl ? `background-image:url('${post.imageUrl}');background-size:cover;background-position:center;` : 'background:linear-gradient(135deg, #1a1040 0%, #0f0a30 100%);'} font-size:20px; font-weight:700; padding:20px; align-items:flex-end; justify-content:flex-start; position:relative;">
                                <span class="badge ${categoryColors[post.category] || 'badge-secondary'}" style="position:absolute; top:12px; right:12px;">${post.category}</span>
                            </div>
                            <div style="padding:20px;">
                                <h3 style="font-size:16px; font-weight:600; color:var(--white); margin-bottom:8px; line-height:1.4; letter-spacing:-0.01em;">${post.title}</h3>
                                <p style="font-size:13px; color:var(--text-secondary); line-height:1.5; margin-bottom:12px; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${post.excerpt}</p>
                                <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--text-tertiary);">
                                    <span>${formatDate(post.date)} • ${post.readTime}</span>
                                    <span>👁 ${s.views} • ❤ ${s.likes}</span>
                                </div>
                            </div>
                        </article>
                    `}).join('')}
                </div>
            </section>
        </div>
    `;
}

function renderBlogDetailPage(postId) {
    const defaultPosts = [
        { id:'b1', title:'So sánh ChatGPT Plus vs Claude Pro: Đâu là AI tốt nhất cho lập trình?', excerpt:'Phân tích chi tiết ưu nhược điểm của ChatGPT Plus và Claude Pro khi sử dụng cho lập trình.', date:'2026-02-22', category:'So sánh', readTime:'8 phút', content:`<h2>1. Tổng quan</h2><p>ChatGPT Plus và Claude Pro là hai dịch vụ AI hàng đầu cho lập trình viên. Mỗi công cụ có ưu nhược điểm riêng.</p><h2>2. Tốc độ phản hồi</h2><p>ChatGPT Plus thường phản hồi nhanh hơn với các câu hỏi ngắn. Claude Pro nổi bật với context window lớn hơn đáng kể, lên tới 200K tokens.</p><h2>3. Độ chính xác code</h2><p>Cả hai đều cho kết quả tốt, tuy nhiên Claude Pro thường chính xác hơn với các dự án phức tạp nhờ khả năng xử lý context dài.</p><h2>4. Kết luận</h2><p>Nếu bạn cần tốc độ và tích hợp DALL-E: chọn ChatGPT Plus. Nếu cần xử lý code base lớn: chọn Claude Pro.</p>` },
        { id:'b2', title:'Hướng dẫn sử dụng GitHub Copilot hiệu quả nhất 2026', excerpt:'Tổng hợp 15 mẹo và thủ thuật giúp bạn tận dụng tối đa GitHub Copilot.', date:'2026-02-19', category:'Hướng dẫn', readTime:'12 phút', content:`<h2>1. Viết comment trước code</h2><p>Copilot hoạt động tốt nhất khi bạn mô tả ý định bằng comment trước.</p><h2>2. Sử dụng tên biến có nghĩa</h2><p>Tên biến rõ ràng giúp Copilot hiểu context tốt hơn.</p><h2>3. Tận dụng chat mode</h2><p>Copilot Chat cho phép bạn hỏi trực tiếp về code trong IDE.</p><h2>4. Keyboard shortcuts</h2><p>Tab để accept, Esc để dismiss, Alt+] để xem gợi ý tiếp theo.</p>` },
        { id:'b3', title:'Cursor AI: IDE tích hợp AI mạnh nhất hiện tại?', excerpt:'Review chi tiết Cursor AI sau 3 tháng sử dụng.', date:'2026-02-16', category:'Review', readTime:'10 phút', content:`<h2>1. Cursor là gì?</h2><p>Cursor là một IDE dựa trên VS Code, tích hợp AI sâu vào trải nghiệm coding.</p><h2>2. Tính năng nổi bật</h2><p>Composer mode cho phép mô tả thay đổi bằng ngôn ngữ tự nhiên. AI sẽ tự động sửa nhiều file cùng lúc.</p><h2>3. So với VS Code + Copilot</h2><p>Cursor vượt trội nhờ khả năng edit multi-file và hiểu context toàn bộ project.</p><h2>4. Đáng đầu tư?</h2><p>Nếu bạn là developer chuyên nghiệp, Cursor Pro rất đáng để đầu tư.</p>` },
        { id:'b4', title:'Xu hướng AI 2026: Những công cụ developer không thể bỏ qua', excerpt:'Tổng hợp các công cụ AI đang thay đổi cách developer làm việc.', date:'2026-02-13', category:'Xu hướng', readTime:'6 phút', content:`<h2>1. AI Coding Assistants</h2><p>GitHub Copilot, Cursor, Codeium — trở thành tiêu chuẩn trong ngành.</p><h2>2. AI Testing</h2><p>Testim AI và Mabl giảm 70% thời gian QA.</p><h2>3. AI Design to Code</h2><p>Figma + AI plugins chuyển design thành code trong vài phút.</p><h2>4. AI DevOps</h2><p>AI tự động hóa CI/CD, monitoring và incident response.</p>` },
        { id:'b5', title:'Midjourney vs DALL-E 3: Công cụ tạo ảnh AI nào tốt hơn?', excerpt:'So sánh toàn diện Midjourney Pro và DALL-E 3.', date:'2026-02-10', category:'So sánh', readTime:'9 phút', content:`<h2>1. Chất lượng ảnh</h2><p>Midjourney cho ảnh nghệ thuật hơn. DALL-E 3 chính xác hơn với mô tả chi tiết.</p><h2>2. Tốc độ</h2><p>DALL-E 3 nhanh hơn nhờ tích hợp trong ChatGPT.</p><h2>3. Giá cả</h2><p>Midjourney $10/tháng. DALL-E 3 đi kèm ChatGPT Plus $20/tháng.</p><h2>4. Kết luận</h2><p>Midjourney cho ảnh nghệ thuật. DALL-E 3 cho ảnh chính xác.</p>` },
        { id:'b6', title:'Cách bảo mật tài khoản AI Premium của bạn', excerpt:'Hướng dẫn bảo vệ tài khoản AI Premium.', date:'2026-02-07', category:'Bảo mật', readTime:'5 phút', content:`<h2>1. Bật 2FA</h2><p>Luôn bật 2FA. Dùng authenticator app thay vì SMS.</p><h2>2. Mật khẩu mạnh</h2><p>Tối thiểu 12 ký tự, kết hợp chữ hoa, thường, số, ký tự đặc biệt.</p><h2>3. Không chia sẻ session</h2><p>Không đăng nhập trên nhiều thiết bị cùng lúc.</p><h2>4. Kiểm tra hoạt động</h2><p>Thường xuyên kiểm tra lịch sử đăng nhập.</p>` }
    ];
    const adminPosts = Storage.get('blogPosts', []);
    const allPosts = [...adminPosts, ...defaultPosts];
    const post = allPosts.find(p => p.id === postId);

    if (!post) {
        return `<div class="container"><div class="empty-state mt-4"><div class="empty-state-title">Bài viết không tồn tại</div><button class="btn btn-primary" onclick="navigate('blog')">Quay lại Blog</button></div></div>`;
    }

    // Track view
    const stats = Storage.get('blogStats', {});
    if (!stats[postId]) stats[postId] = { views: 0, likes: 0, ratings: [], userLiked: false };
    stats[postId].views++;
    Storage.set('blogStats', stats);
    const s = stats[postId];
    const avgRating = s.ratings && s.ratings.length ? (s.ratings.reduce((a,b) => a+b, 0) / s.ratings.length).toFixed(1) : '0';
    const userLiked = s.userLiked;

    // Comments
    const comments = Storage.get('blogComments', {});
    const postComments = comments[postId] || [];

    const catColors = {'So sánh':'badge-hot','Hướng dẫn':'badge-trending','Review':'badge-new','Xu hướng':'badge-secondary','Bảo mật':'badge-hot'};

    return `
        <div class="container" style="max-width:780px;">
            <section class="section">
                <div style="margin-bottom:24px;">
                    <a href="javascript:void(0)" onclick="navigate('blog')" style="color:var(--accent);text-decoration:none;font-size:14px;">← Quay lại Blog</a>
                </div>

                <article>
                    <div style="margin-bottom:20px;display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                        <span class="badge ${catColors[post.category] || 'badge-secondary'}">${post.category}</span>
                        <span style="font-size:13px;color:var(--text-tertiary);">${formatDate(post.date)} • ${post.readTime} đọc</span>
                    </div>
                    <h1 style="font-size:28px;font-weight:800;line-height:1.3;margin-bottom:20px;letter-spacing:-0.02em;">${post.title}</h1>

                    <!-- Stats bar -->
                    <div style="display:flex;align-items:center;gap:16px;padding:12px 16px;background:var(--bg-secondary);border-radius:10px;margin-bottom:28px;font-size:13px;color:var(--text-secondary);flex-wrap:wrap;">
                        <span title="Lượt xem">👁 ${s.views} lượt xem</span>
                        <span title="Lượt thích">❤ ${s.likes} lượt thích</span>
                        <span title="Đánh giá">⭐ ${avgRating}/5 (${s.ratings ? s.ratings.length : 0} đánh giá)</span>
                        <span title="Bình luận">💬 ${postComments.length} bình luận</span>
                    </div>

                    <p style="font-size:15px;color:var(--text-secondary);line-height:1.6;margin-bottom:32px;font-style:italic;border-left:3px solid var(--accent);padding-left:16px;">${post.excerpt}</p>
                    <div class="blog-content" style="font-size:15px;line-height:1.8;color:var(--text-secondary);">
                        ${post.content || '<p>Nội dung bài viết đang được cập nhật...</p>'}
                    </div>
                </article>

                <!-- Like + Rate section -->
                <div style="border-top:1px solid var(--border);border-bottom:1px solid var(--border);padding:24px 0;margin:32px 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;">
                    <button class="btn ${userLiked ? 'btn-primary' : 'btn-outline'}" onclick="toggleBlogLike('${postId}')" id="likeBtn" style="border-radius:20px;">
                        ${userLiked ? '❤ Đã thích' : '🤍 Thích bài viết'} (${s.likes})
                    </button>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span style="font-size:13px;color:var(--text-secondary);">Đánh giá:</span>
                        <div id="blogRatingStars" style="display:flex;gap:2px;">
                            ${[1,2,3,4,5].map(i => `<span onclick="rateBlog('${postId}', ${i})" style="cursor:pointer;font-size:22px;transition:transform 0.15s;" onmouseover="this.style.transform='scale(1.3)'" onmouseout="this.style.transform='scale(1)'">${i <= Math.round(avgRating) ? '⭐' : '☆'}</span>`).join('')}
                        </div>
                    </div>
                </div>

                <!-- Comments section -->
                <div style="margin-top:8px;">
                    <h3 style="font-size:18px;font-weight:700;margin-bottom:20px;">💬 Bình luận (${postComments.length})</h3>

                    ${currentUser ? `
                    <form onsubmit="addBlogComment(event, '${postId}')" style="margin-bottom:24px;">
                        <div class="form-group" style="margin-bottom:12px;">
                            <textarea class="form-textarea" id="blogCommentText" placeholder="Viết bình luận của bạn..." style="min-height:80px;" required></textarea>
                        </div>
                        <button type="submit" class="btn btn-primary" style="border-radius:20px;">Gửi bình luận</button>
                    </form>` : `
                    <div style="padding:16px;background:var(--bg-secondary);border-radius:10px;margin-bottom:24px;text-align:center;">
                        <p style="color:var(--text-secondary);margin-bottom:8px;font-size:14px;">Đăng nhập để bình luận</p>
                        <button class="btn btn-primary btn-sm" onclick="navigate('login')" style="border-radius:20px;">Đăng nhập</button>
                    </div>`}

                    <div id="blogCommentsList">
                        ${postComments.length === 0 ? '<p style="color:var(--text-tertiary);font-size:14px;text-align:center;padding:20px;">Chưa có bình luận nào. Hãy là người đầu tiên!</p>' : postComments.map(c => `
                            <div style="padding:16px;background:var(--bg-secondary);border-radius:10px;margin-bottom:12px;">
                                <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                                    <span style="font-weight:600;font-size:14px;color:var(--accent);">${c.userName}</span>
                                    <span style="font-size:12px;color:var(--text-tertiary);">${formatDate(c.date)}</span>
                                </div>
                                <p style="font-size:14px;color:var(--text-secondary);line-height:1.5;">${c.text}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </section>
        </div>
    `;
}

function toggleBlogLike(postId) {
    const stats = Storage.get('blogStats', {});
    if (!stats[postId]) stats[postId] = { views: 0, likes: 0, ratings: [], userLiked: false };
    if (stats[postId].userLiked) {
        stats[postId].likes = Math.max(0, stats[postId].likes - 1);
        stats[postId].userLiked = false;
        showToast('Đã bỏ thích', 'info');
    } else {
        stats[postId].likes++;
        stats[postId].userLiked = true;
        showToast('Đã thích bài viết ❤', 'success');
    }
    Storage.set('blogStats', stats);
    navigate('blog-detail', { id: postId });
}

function rateBlog(postId, rating) {
    const stats = Storage.get('blogStats', {});
    if (!stats[postId]) stats[postId] = { views: 0, likes: 0, ratings: [], userLiked: false };
    stats[postId].ratings.push(rating);
    Storage.set('blogStats', stats);
    const avg = (stats[postId].ratings.reduce((a,b) => a+b, 0) / stats[postId].ratings.length).toFixed(1);
    showToast(`Cảm ơn! Bạn đã đánh giá ${rating}/5 ⭐ (TB: ${avg})`, 'success');
    navigate('blog-detail', { id: postId });
}

function addBlogComment(e, postId) {
    e.preventDefault();
    const text = document.getElementById('blogCommentText').value.trim();
    if (!text) return;
    if (!currentUser) { showToast('Vui lòng đăng nhập để bình luận', 'error'); return; }

    const comments = Storage.get('blogComments', {});
    if (!comments[postId]) comments[postId] = [];
    comments[postId].unshift({
        id: Date.now().toString(),
        userName: currentUser.name || 'Ẩn danh',
        userId: currentUser.id,
        text,
        date: new Date().toISOString().slice(0, 10)
    });
    Storage.set('blogComments', comments);
    showToast('Bình luận đã được gửi!', 'success');
    navigate('blog-detail', { id: postId });
}

// --- Contact Page ---
function renderContactPage() {
    return `
        <div class="container">
            <section class="section">
                <div class="section-header" style="text-align:center; margin-bottom:40px;">
                    <h2 class="section-title" style="font-size:32px;">Liên hệ Admin</h2>
                    <p class="section-subtitle">Liên hệ trực tiếp với chúng tôi qua các kênh bên dưới</p>
                </div>

                <div class="contact-layout">
                    <div class="contact-info">
                        <div class="card" style="padding:28px;">
                            <h3 style="font-size:18px; font-weight:700; color:var(--white); margin-bottom:20px;">Thông tin liên hệ</h3>

                            <div class="contact-item">
                                <div class="contact-item-label">Email</div>
                                <div class="contact-item-value">luccodedao.dev@gmail.com</div>
                            </div>

                            <div class="contact-item">
                                <div class="contact-item-label">Telegram</div>
                                <div class="contact-item-value">
                                    <a href="https://t.me/shopai4dev" target="_blank" style="color:var(--accent);">@shopai4dev</a>
                                </div>
                            </div>

                            <div class="contact-item">
                                <div class="contact-item-label">Zalo</div>
                                <div class="contact-item-value">0367 545 048</div>
                            </div>

                            <div class="contact-item">
                                <div class="contact-item-label">Giờ hỗ trợ</div>
                                <div class="contact-item-value">24/7 — Phản hồi trong 30 phút</div>
                            </div>

                            <div class="separator"></div>

                            <h3 style="font-size:16px; font-weight:600; color:var(--white); margin-bottom:12px;">Kênh thanh toán</h3>
                            <div class="contact-item">
                                <div class="contact-item-label">Ngân hàng</div>
                                <div class="contact-item-value">Techcombank — STK: 19075781452018 — Trần Phúc Lực</div>
                            </div>
    
                        </div>
                    </div>

                    <div class="contact-form-wrap">
                        <div class="card" style="padding:28px;">
                            <h3 style="font-size:18px; font-weight:700; color:var(--white); margin-bottom:20px;">Gửi tin nhắn</h3>
                            <form onsubmit="submitContactForm(event)">
                                <div class="form-group">
                                    <label class="form-label">Họ và tên</label>
                                    <input type="text" class="form-input" id="contactName" placeholder="Nhập họ tên..." required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Zalo</label>
                                    <input type="tel" class="form-input" id="contactZalo" placeholder="Số điện thoại Zalo..." required>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Chủ đề</label>
                                    <select class="form-select" id="contactSubject" required>
                                        <option value="">Chọn chủ đề...</option>
                                        <option value="buy">Mua tài khoản</option>
                                        <option value="support">Hỗ trợ kỹ thuật</option>
                                        <option value="refund">Hoàn tiền</option>
                                        <option value="partner">Hợp tác</option>
                                        <option value="other">Khác</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Nội dung</label>
                                    <textarea class="form-textarea" id="contactMessage" placeholder="Nhập nội dung tin nhắn..." required></textarea>
                                </div>
                                <button type="submit" class="btn btn-primary btn-lg btn-full">Gửi tin nhắn</button>
                            </form>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    `;
}

async function submitContactForm(e) {
    e.preventDefault();
    const name = document.getElementById('contactName').value;
    const zalo = document.getElementById('contactZalo').value;
    const subject = document.getElementById('contactSubject').value;
    const message = document.getElementById('contactMessage').value;

    try {
        const data = await Api.post('/contact', { name, zalo, subject, message });
        if (data.success) {
            showToast('Tin nhắn đã được gửi! Chúng tôi sẽ phản hồi trong vòng 30 phút.', 'success');
            navigate('contact');
        } else {
            showToast(data.message || 'Gửi thất bại', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối, vui lòng thử lại', 'error');
    }
}

// --- Warranty Policy Page ---
function renderWarrantyPage() {
    return `
        <div class="container" style="max-width:860px;margin:0 auto;padding-top:40px;padding-bottom:60px;">
            <div class="section-header" style="text-align:center;margin-bottom:40px;">
                <h1 class="section-title" style="font-size:32px;">Chính sách bảo hành</h1>
                <p class="section-subtitle">Cam kết bảo hành trọn đời gói — Quyền lợi khách hàng là ưu tiên số 1</p>
            </div>

            <div class="card" style="padding:32px;margin-bottom:24px;">
                <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
                    <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#22c55e,#16a34a);display:flex;align-items:center;justify-content:center;">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                    </div>
                    <div>
                        <h2 style="font-size:20px;font-weight:700;color:var(--white);margin:0;">Bảo hành TRỌN ĐỜI gói</h2>
                        <p style="font-size:13px;color:var(--text-secondary);margin:2px 0 0;">Từ ngày mua đến hết thời hạn gói đăng ký</p>
                    </div>
                </div>
                <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.2);border-radius:12px;padding:20px;margin-bottom:20px;">
                    <p style="font-size:15px;color:var(--white);line-height:1.8;margin:0;">
                        Tất cả sản phẩm tại <b style="color:var(--accent);">AI4DEV</b> đều được bảo hành <b style="color:#22c55e;">FULL trọn gói</b> — nghĩa là bạn được bảo hành kể từ ngày mua cho đến khi hết hạn gói đăng ký. Nếu tài khoản gặp bất kỳ sự cố nào trong thời gian bảo hành, chúng tôi sẽ <b>thay thế miễn phí</b> hoặc <b>hoàn tiền</b>.
                    </p>
                </div>
            </div>

            <div class="card" style="padding:32px;margin-bottom:24px;">
                <h3 style="font-size:18px;font-weight:700;color:var(--white);margin-bottom:20px;">Phạm vi bảo hành</h3>
                <div style="display:grid;gap:16px;">
                    ${[
                        { icon: '✅', title: 'Tài khoản bị khóa / không đăng nhập được', desc: 'Thay thế tài khoản mới trong vòng 30 phút hoặc hoàn tiền.' },
                        { icon: '✅', title: 'Tài khoản bị giảm cấp / hết Pro', desc: 'Nâng cấp lại miễn phí hoặc đổi tài khoản mới ngay lập tức.' },
                        { icon: '✅', title: 'Tài khoản bị lỗi tính năng', desc: 'Kiểm tra và xử lý, nếu không khắc phục được sẽ đổi mới hoặc hoàn tiền.' },
                        { icon: '✅', title: 'Sự cố do bên thứ 3 (server, API)', desc: 'Hỗ trợ xử lý hoặc gia hạn bù thời gian sử dụng.' },
                        { icon: '✅', title: 'Quên mật khẩu / mất 2FA', desc: 'Hỗ trợ khôi phục hoặc cấp lại thông tin đăng nhập.' },
                    ].map(item => `
                        <div style="display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:var(--bg-secondary);border-radius:10px;">
                            <span style="font-size:18px;flex-shrink:0;margin-top:2px;">${item.icon}</span>
                            <div>
                                <div style="font-size:14px;font-weight:600;color:var(--white);margin-bottom:3px;">${item.title}</div>
                                <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">${item.desc}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="card" style="padding:32px;margin-bottom:24px;">
                <h3 style="font-size:18px;font-weight:700;color:var(--white);margin-bottom:20px;">Không thuộc phạm vi bảo hành</h3>
                <div style="display:grid;gap:12px;">
                    ${[
                        'Tài khoản bị khóa do vi phạm điều khoản sử dụng của nhà cung cấp (chia sẻ cho người khác, spam, lạm dụng API...)',
                        'Tài khoản đã hết hạn gói đăng ký',
                        'Khách tự ý thay đổi mật khẩu, email, hoặc cài đặt bảo mật mà không thông báo',
                        'Yêu cầu bảo hành sau khi đã nhận hoàn tiền cho đơn hàng đó',
                    ].map(item => `
                        <div style="display:flex;gap:10px;align-items:flex-start;padding:10px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.12);border-radius:8px;">
                            <span style="color:#ef4444;font-weight:700;flex-shrink:0;">✗</span>
                            <span style="font-size:13px;color:var(--text-secondary);line-height:1.6;">${item}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <div class="card" style="padding:32px;margin-bottom:24px;">
                <h3 style="font-size:18px;font-weight:700;color:var(--white);margin-bottom:20px;">Chính sách hoàn tiền</h3>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;">
                    <div style="text-align:center;padding:24px 16px;background:var(--bg-secondary);border-radius:12px;">
                        <div style="font-size:28px;font-weight:800;color:#22c55e;margin-bottom:4px;">15 phút</div>
                        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">Hoàn tiền <b>100%</b> nếu tài khoản lỗi ngay sau khi mua và không thể thay thế</div>
                    </div>
                    <div style="text-align:center;padding:24px 16px;background:var(--bg-secondary);border-radius:12px;">
                        <div style="font-size:28px;font-weight:800;color:var(--accent);margin-bottom:4px;">30 phút</div>
                        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">Thay thế tài khoản mới <b>miễn phí</b> nếu tài khoản gặp sự cố</div>
                    </div>
                    <div style="text-align:center;padding:24px 16px;background:var(--bg-secondary);border-radius:12px;">
                        <div style="font-size:28px;font-weight:800;color:#3b82f6;margin-bottom:4px;">24/7</div>
                        <div style="font-size:13px;color:var(--text-secondary);line-height:1.5;">Hỗ trợ xử lý bảo hành <b>mọi lúc</b>, phản hồi trong 30 phút</div>
                    </div>
                </div>
            </div>

            <div class="card" style="padding:32px;">
                <h3 style="font-size:18px;font-weight:700;color:var(--white);margin-bottom:16px;">Cách yêu cầu bảo hành</h3>
                <div style="display:grid;gap:14px;">
                    ${[
                        { step: '1', title: 'Vào trang Đơn hàng', desc: 'Tìm đơn hàng cần bảo hành và nhấn nút "Báo lỗi"' },
                        { step: '2', title: 'Mô tả sự cố', desc: 'Nhập chi tiết lỗi bạn gặp phải (screenshot nếu có)' },
                        { step: '3', title: 'Chờ xử lý', desc: 'Admin sẽ kiểm tra và phản hồi trong vòng 30 phút' },
                        { step: '4', title: 'Nhận kết quả', desc: 'Tài khoản mới hoặc hoàn tiền sẽ được cập nhật vào tài khoản của bạn' },
                    ].map(item => `
                        <div style="display:flex;gap:14px;align-items:flex-start;">
                            <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0;">${item.step}</div>
                            <div>
                                <div style="font-size:14px;font-weight:600;color:var(--white);">${item.title}</div>
                                <div style="font-size:13px;color:var(--text-secondary);margin-top:2px;">${item.desc}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
                <div style="margin-top:24px;padding-top:20px;border-top:1px solid var(--border);display:flex;gap:12px;flex-wrap:wrap;">
                    <a href="/lien-he" onclick="event.preventDefault();navigate('contact')" class="btn btn-primary">Liên hệ hỗ trợ</a>
                    <a href="/don-hang" onclick="event.preventDefault();navigate('orders')" class="btn btn-ghost">Xem đơn hàng</a>
                </div>
            </div>
        </div>
    `;
}

// --- Admin Page ---
function renderAdminPage(activeTab = 'dashboard') {
    return `
        <div class="container">
            <div class="admin-layout">
                <div class="admin-sidebar">
                    <button class="admin-nav-item ${activeTab === 'dashboard' ? 'active' : ''}" onclick="navigate('admin', {tab:'dashboard'})">Tổng quan</button>
                    <button class="admin-nav-item ${activeTab === 'products' ? 'active' : ''}" onclick="navigate('admin', {tab:'products'})">Sản phẩm</button>
                    <button class="admin-nav-item ${activeTab === 'add-product' ? 'active' : ''}" onclick="navigate('admin', {tab:'add-product'})">Thêm sản phẩm</button>
                    <button class="admin-nav-item ${activeTab === 'orders' ? 'active' : ''}" onclick="navigate('admin', {tab:'orders'})">Đơn hàng</button>
                    <button class="admin-nav-item ${activeTab === 'customers-mgmt' ? 'active' : ''}" onclick="navigate('admin', {tab:'customers-mgmt'})">Khách hàng</button>
                    <button class="admin-nav-item ${activeTab === 'blog-mgmt' ? 'active' : ''}" onclick="navigate('admin', {tab:'blog-mgmt'})">Blog</button>
                    <button class="admin-nav-item ${activeTab === 'bugs' ? 'active' : ''}" onclick="navigate('admin', {tab:'bugs'})">Báo cáo lỗi</button>
                    <button class="admin-nav-item ${activeTab === 'banners' ? 'active' : ''}" onclick="navigate('admin', {tab:'banners'})">Banners</button>
                    <button class="admin-nav-item ${activeTab === 'flash-sale' ? 'active' : ''}" onclick="navigate('admin', {tab:'flash-sale'})">Flash Sale</button>
                    <button class="admin-nav-item ${activeTab === 'coupons' ? 'active' : ''}" onclick="navigate('admin', {tab:'coupons'})">Mã giảm giá</button>
                    <button class="admin-nav-item ${activeTab === 'ctv' ? 'active' : ''}" onclick="navigate('admin', {tab:'ctv'})">CTV</button>
                </div>
                <div class="admin-content">
                    ${activeTab === 'dashboard' ? renderAdminDashboard() : ''}
                    ${activeTab === 'products' ? renderAdminProducts() : ''}
                    ${activeTab === 'add-product' ? renderAdminAddProduct() : ''}
                    ${activeTab === 'orders' ? renderAdminOrders() : ''}
                    ${activeTab === 'customers-mgmt' ? renderAdminCustomers() : ''}
                    ${activeTab === 'blog-mgmt' ? renderAdminBlogMgmt() : ''}
                    ${activeTab === 'bugs' ? renderAdminBugs() : ''}
                    ${activeTab === 'banners' ? renderAdminBanners() : ''}
                    ${activeTab === 'flash-sale' ? renderAdminFlashSale() : ''}
                    ${activeTab === 'coupons' ? renderAdminCoupons() : ''}
                    ${activeTab === 'ctv' ? renderAdminCTV() : ''}
                </div>
            </div>
        </div>
    `;
}

function renderAdminDashboard() {
    const products = _productsCache;
    const bugs = Storage.get('bugReports', []);

    // Load stats from API after render
    setTimeout(async () => {
        try {
            const data = await Api.get('/admin/stats');
            if (data.success) {
                const s = data.stats;
                const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
                el('stat-products', s.totalProducts || products.length);
                el('stat-orders', s.totalOrders || 0);
                el('stat-revenue', formatPrice(s.totalRevenue || 0));
                el('stat-users', s.totalUsers || 0);
                el('stat-purchases', formatNumber(s.totalPurchases || getTotalPurchases()));
            }
        } catch (e) { console.error('Failed to load admin stats', e); }
    }, 100);

    return `
        <div class="admin-header">
            <h2 class="admin-title">Tổng quan</h2>
        </div>
        <div class="stat-cards">
            <div class="stat-card">
                <div class="stat-card-label">Sản phẩm</div>
                <div class="stat-card-value" id="stat-products">${products.length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-label">Đơn hàng</div>
                <div class="stat-card-value" id="stat-orders">…</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-label">Doanh thu</div>
                <div class="stat-card-value" id="stat-revenue">…</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-label">Người dùng</div>
                <div class="stat-card-value" id="stat-users">…</div>
            </div>
        </div>
        <div class="stat-cards" style="grid-template-columns: repeat(2, 1fr);">
            <div class="stat-card">
                <div class="stat-card-label">Báo cáo lỗi chưa xử lý</div>
                <div class="stat-card-value">${bugs.filter(b => b.status === 'pending').length}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-label">Tổng lượt mua</div>
                <div class="stat-card-value" id="stat-purchases">${formatNumber(getTotalPurchases())}</div>
            </div>
        </div>
        <div class="card" style="padding:24px; margin-top:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
                <h3 style="font-size:16px; font-weight:600; color:var(--white);">Biểu đồ doanh thu</h3>
                <div style="display:flex; gap:4px; background:var(--bg-elevated); padding:3px; border-radius:var(--radius); border:1px solid var(--border-light);">
                    <button class="chart-tab ${(window._chartPeriod || 'week') === 'day' ? 'active' : ''}" onclick="switchChartPeriod('day')">Ngày</button>
                    <button class="chart-tab ${(window._chartPeriod || 'week') === 'week' ? 'active' : ''}" onclick="switchChartPeriod('week')">Tuần</button>
                    <button class="chart-tab ${(window._chartPeriod || 'week') === 'month' ? 'active' : ''}" onclick="switchChartPeriod('month')">Tháng</button>
                </div>
            </div>
            <canvas id="revenueChart" width="800" height="320" style="width:100%; height:320px;"></canvas>
        </div>
    `;
}

function switchChartPeriod(period) {
    window._chartPeriod = period;
    navigate('admin', { tab: 'dashboard' });
}

function drawRevenueChart() {
    const canvas = document.getElementById('revenueChart');
    if (!canvas) return;
    const period = window._chartPeriod || 'week';

    // Fetch from API
    Api.get(`/admin/revenue-chart?period=${period}`).then(data => {
        if (!data.success || !data.dailyRevenue) {
            const ctx = canvas.getContext('2d');
            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);
            ctx.fillStyle = 'rgba(255,255,255,0.3)';
            ctx.font = '13px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Khong the tai du lieu doanh thu', rect.width / 2, rect.height / 2);
            return;
        }
        const entries = Object.entries(data.dailyRevenue).sort((a,b) => a[0].localeCompare(b[0]));
        const labels = entries.map(([dateStr]) => {
            const d = new Date(dateStr + 'T00:00:00');
            const weekday = ['CN','T2','T3','T4','T5','T6','T7'][d.getDay()];
            return weekday + ' ' + d.getDate() + '/' + (d.getMonth()+1);
        });
        const revenueByDay = entries.map(([, val]) => val);
        _drawChart(canvas, labels, revenueByDay, period);
    }).catch(e => {
        console.error('[REVENUE CHART ERROR]', e);
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '13px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loi tai bieu do: ' + (e.message || ''), rect.width / 2, rect.height / 2);
    });
}

function _drawChart(canvas, labels, revenueByDay, period) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const H = rect.height;

    const maxVal = Math.max(...revenueByDay, 100000) * 1.15;
    const padL = 80, padR = 30, padT = 30, padB = 50;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    // Theme detection
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const gridColor = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    const labelColor = isLight ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.35)';
    const valueColor = isLight ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.8)';
    const axisColor = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';
    const dotCenter = isLight ? '#fff' : '#fff';

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
        const y = padT + (chartH / 5) * i;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(W - padR, y);
        ctx.stroke();
        const val = maxVal - (maxVal / 5) * i;
        ctx.fillStyle = labelColor;
        ctx.font = '10px -apple-system, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(formatPrice(Math.round(val)), padL - 10, y + 4);
    }

    // Points array
    const points = revenueByDay.map((val, i) => ({
        x: padL + (chartW / (labels.length - 1 || 1)) * i,
        y: padT + chartH - (val / maxVal) * chartH,
        val
    }));

    // Gradient fill under line
    const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    gradient.addColorStop(0, 'rgba(10, 132, 255, 0.25)');
    gradient.addColorStop(1, 'rgba(10, 132, 255, 0.02)');
    ctx.beginPath();
    ctx.moveTo(points[0].x, padT + chartH);
    ctx.lineTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        const cp1x = (points[i - 1].x + points[i].x) / 2;
        ctx.bezierCurveTo(cp1x, points[i - 1].y, cp1x, points[i].y, points[i].x, points[i].y);
    }
    ctx.lineTo(points[points.length - 1].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
        const cp1x = (points[i - 1].x + points[i].x) / 2;
        ctx.bezierCurveTo(cp1x, points[i - 1].y, cp1x, points[i].y, points[i].x, points[i].y);
    }
    ctx.strokeStyle = '#0a84ff';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Data points & labels
    points.forEach((p, i) => {
        // Dot
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#0a84ff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();

        // Value above point (show selectively for month view)
        if (period === 'week' || period === 'day' && i % 3 === 0 || period === 'month' && p.val > 0 && i % 3 === 0) {
            if (p.val > 0) {
                ctx.fillStyle = valueColor;
                ctx.font = 'bold 10px -apple-system, sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(formatPrice(p.val), p.x, p.y - 10);
            }
        }

        // X label (show selectively for month view)
        if (period === 'week' || (period === 'day' && i % 3 === 0) || (period === 'month' && (i % 5 === 0 || i === labels.length - 1))) {
            ctx.fillStyle = axisColor;
            ctx.font = '10px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(labels[i], p.x, H - padB + 18);
        }
    });
}

function renderAdminProducts() {
    const products = _productsCache;

    return `
        <div class="admin-header">
            <h2 class="admin-title">Quản lý sản phẩm</h2>
            <button class="btn btn-primary" onclick="navigate('admin', {tab:'add-product'})">Thêm sản phẩm</button>
        </div>
        <div class="card" style="overflow-x:auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Tên</th>
                        <th>Loại</th>
                        <th>Giá</th>
                        <th>Lượt mua</th>
                        <th>Trạng thái</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${products.map(p => `
                        <tr>
                            <td style="font-weight:500;">${p.name}</td>
                            <td><span class="badge badge-secondary">${p.category}</span></td>
                            <td>${formatPrice(p.price)}</td>
                            <td>${p.purchases}</td>
                            <td>
                                ${p.isHot ? '<span class="badge badge-hot" style="margin-right:0.25rem;">HOT</span>' : ''}
                                ${p.isTrending ? '<span class="badge badge-trending" style="margin-right:0.25rem;">TREND</span>' : ''}
                                ${p.isNew ? '<span class="badge badge-new">MỚI</span>' : ''}
                            </td>
                            <td>
                                <div class="table-actions">
                                    <button class="btn btn-ghost btn-sm" onclick="editProduct('${p.id}')">Sửa</button>
                                    <button class="btn btn-ghost btn-sm" style="color:hsl(var(--destructive));" onclick="deleteProduct('${p.id}')">Xóa</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function toggleAdminPrices() {
    const radio = document.querySelector('input[name="prodAccType"]:checked');
    if (!radio) return;
    const val = radio.value;
    document.querySelectorAll('.col-shared').forEach(el => el.style.display = (val === 'shared' || val === 'both') ? 'block' : 'none');
    document.querySelectorAll('.col-owned').forEach(el => el.style.display = (val === 'owned' || val === 'both') ? 'block' : 'none');
}

function renderAdminAddProduct(editProduct = null) {
    const p = editProduct || { name: '', shortName: '', category: '', description: '', price: '', originalPrice: '', features: [], videoUrl: '', docs: '', isHot: false, isTrending: false, isNew: false, inStock: true };
    const isEdit = !!editProduct;

    let existingShared = p.accountTypes ? (p.accountTypes.find(at => at.type === 'shared')?.prices || {}) : {};
    let existingOwned  = p.accountTypes ? (p.accountTypes.find(at => at.type === 'owned')?.prices || {}) : {};
    let uniqueMonths = Array.from(new Set([...Object.keys(existingShared), ...Object.keys(existingOwned)])).map(Number).sort((a,b)=>a-b);
    let monthSlots = uniqueMonths.slice(0, 4);
    while(monthSlots.length < 4) monthSlots.push('');

    let hasShared = Object.keys(existingShared).length > 0;
    let hasOwned = Object.keys(existingOwned).length > 0;
    let defaultRadio = 'both';
    if (hasShared && !hasOwned) defaultRadio = 'shared';
    if (!hasShared && hasOwned) defaultRadio = 'owned';

    return `
        <div class="admin-header">
            <h2 class="admin-title">${isEdit ? 'Sửa sản phẩm' : 'Thêm sản phẩm mới'}</h2>
        </div>
        <div class="card" style="max-width:700px;">
            <div class="card-content">
                <form onsubmit="${isEdit ? `updateProduct(event, '${p.id}')` : 'addProduct(event)'}">
                    <div class="grid-2">
                        <div class="form-group">
                            <label class="form-label">Tên sản phẩm</label>
                            <input type="text" class="form-input" id="prodName" value="${p.name}" placeholder="VD: ChatGPT Plus" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Tên viết tắt</label>
                            <input type="text" class="form-input" id="prodShortName" value="${p.shortName}" placeholder="VD: GPT+" required>
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Ảnh đại diện (URL)</label>
                        <input type="text" class="form-input" id="prodImageUrl" value="${p.imageUrl || ''}" placeholder="https://example.com/product-image.png">
                        <p class="form-hint">Đường dẫn ảnh sản phẩm. Để trống sẽ hiển tên viết tắt thay thế.</p>
                        ${p.imageUrl ? `<div style="margin-top:8px;"><img src="${p.imageUrl}" style="max-height:80px;border-radius:8px;border:1px solid var(--border);" alt="Preview"></div>` : ''}
                    </div>
                    <div class="form-group">
                        <label class="form-label">Danh mục</label>
                        <select class="form-select" id="prodCategory" required>
                            <option value="">Chọn danh mục...</option>
                            <option value="AI Chat" ${p.category === 'AI Chat' ? 'selected' : ''}>AI Chat</option>
                            <option value="AI Coding" ${p.category === 'AI Coding' ? 'selected' : ''}>AI Coding</option>
                            <option value="AI Image" ${p.category === 'AI Image' ? 'selected' : ''}>AI Image</option>
                            <option value="AI Productivity" ${p.category === 'AI Productivity' ? 'selected' : ''}>AI Productivity</option>
                            <option value="AI Search" ${p.category === 'AI Search' ? 'selected' : ''}>AI Search</option>
                            <option value="AI Other" ${p.category === 'AI Other' ? 'selected' : ''}>Khác</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mô tả</label>
                        <textarea class="form-textarea" id="prodDescription" placeholder="Mô tả chi tiết về sản phẩm..." required>${p.description}</textarea>
                    </div>

                    <!-- Pricing Tiers Grid -->
                    <div style="margin-bottom: 24px;">
                        <label class="form-label" style="font-weight: 700; margin-bottom: 12px; display: block; color: var(--accent);">Thiết lập Giá & Thời gian</label>
                        <div style="display:flex; gap:15px; margin-bottom:15px;">
                            <label><input type="radio" name="prodAccType" value="shared" ${defaultRadio==='shared'?'checked':''} onchange="toggleAdminPrices()"> Cấp tài khoản</label>
                            <label><input type="radio" name="prodAccType" value="owned" ${defaultRadio==='owned'?'checked':''} onchange="toggleAdminPrices()"> Chính chủ</label>
                            <label><input type="radio" name="prodAccType" value="both" ${defaultRadio==='both'?'checked':''} onchange="toggleAdminPrices()"> Cả hai</label>
                        </div>

                        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:15px; font-size:13px; font-weight:bold; color:var(--text-secondary); margin-bottom:8px;">
                            <div>Số tháng</div>
                            <div class="col-shared" style="display:${defaultRadio==='shared'||defaultRadio==='both'?'block':'none'}">Giá Cấp tài khoản</div>
                            <div class="col-owned" style="display:${defaultRadio==='owned'||defaultRadio==='both'?'block':'none'}">Giá Chính chủ</div>
                        </div>
                        ${[0, 1, 2, 3].map(i => {
                            let m = monthSlots[i] || '';
                            let ps = existingShared[m] || '';
                            let po = existingOwned[m] || '';
                            return `
                            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:15px; margin-bottom:10px;">
                                <input type="number" class="form-input" id="slot_month_${i}" value="${m}" placeholder="VD: 1" min="1">
                                <input type="number" class="form-input col-shared" id="slot_shared_${i}" value="${ps}" placeholder="Giá (VNĐ)" style="display:${defaultRadio==='shared'||defaultRadio==='both'?'block':'none'}">
                                <input type="number" class="form-input col-owned" id="slot_owned_${i}" value="${po}" placeholder="Giá (VNĐ)" style="display:${defaultRadio==='owned'||defaultRadio==='both'?'block':'none'}">
                            </div>`;
                        }).join('')}
                    </div>


                    <!-- Legacy fields for backward compatibility/simplicity -->
                    <div class="grid-2" style="display: none;">
                        <div class="form-group">
                            <label class="form-label">Giá bán (VNĐ)</label>
                            <input type="number" class="form-input" id="prodPrice" value="${p.price}">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Giá gốc (VNĐ)</label>
                            <input type="number" class="form-input" id="prodOriginalPrice" value="${p.originalPrice}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tính năng (mỗi dòng 1 tính năng)</label>
                        <textarea class="form-textarea" id="prodFeatures" placeholder="Truy cập GPT-4&#10;DALL-E 3&#10;Ưu tiên truy cập">${Array.isArray(p.features) ? p.features.join('\n') : ''}</textarea>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Video URL (YouTube embed)</label>
                        <input type="text" class="form-input" id="prodVideoUrl" value="${p.videoUrl || ''}" placeholder="https://www.youtube.com/embed/...">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Tài liệu hướng dẫn (HTML)</label>
                        <textarea class="form-textarea" id="prodDocs" style="min-height:150px;" placeholder="<h2>Hướng dẫn sử dụng</h2><p>...</p>">${p.docs || ''}</textarea>
                    </div>
                    <div style="display:flex; gap:1.5rem; margin-bottom:1.25rem;">
                        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; cursor:pointer;">
                            <input type="checkbox" id="prodIsHot" ${p.isHot ? 'checked' : ''}> HOT
                        </label>
                        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; cursor:pointer;">
                            <input type="checkbox" id="prodIsTrending" ${p.isTrending ? 'checked' : ''}> TRENDING
                        </label>
                        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; cursor:pointer;">
                            <input type="checkbox" id="prodIsNew" ${p.isNew ? 'checked' : ''}> MỚI
                        </label>
                    </div>
                    <div style="margin-bottom:1.25rem;">
                        <label style="display:flex; align-items:center; gap:0.5rem; font-size:0.875rem; cursor:pointer; font-weight:600; color:var(--green);">
                            <input type="checkbox" id="prodInStock" ${p.inStock !== false ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--green);"> Còn hàng
                        </label>
                        <p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">Bỏ tick để đánh dấu sản phẩm hết hàng</p>
                    </div>
                    <div style="display:flex; gap:0.5rem;">
                        <button type="submit" class="btn btn-primary btn-lg">${isEdit ? 'Cập nhật' : 'Thêm sản phẩm'}</button>
                        <button type="button" class="btn btn-ghost btn-lg" onclick="navigate('admin', {tab:'products'})">Hủy</button>
                    </div>
                </form>
            </div>
        </div>
    `;
}

function renderAdminOrders() {
    return `
        <div class="admin-header">
            <h2 class="admin-title">Don hang</h2>
        </div>
        <div id="adminOrdersContainer">
            <div style="text-align:center;padding:40px;color:var(--text-tertiary);">Dang tai don hang...</div>
        </div>
    `;
}

// Load admin orders from API
async function loadAdminOrders() {
    const container = document.getElementById('adminOrdersContainer');
    if (!container) return;
    try {
        const data = await Api.get('/admin/orders');
        if (!data.success) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Khong the tai don hang</div><div style="color:var(--text-tertiary);font-size:13px;margin-top:8px;">' + (data.message || 'Vui long thu lai') + '</div><button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="loadAdminOrders()">Thu lai</button></div>';
            return;
        }

        const orders = data.orders || [];
        if (!orders.length) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Chua co don hang nao</div></div>';
            return;
        }

        const icons = {
            clock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
            loader: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
            checkCircle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
            xCircle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
            alertTriangle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
            user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        };

        const statusMap = {
            'pending': { label: 'Cho xu ly', color: 'var(--orange)' },
            'processing': { label: 'Dang xu ly', color: 'var(--blue)' },
            'completed': { label: 'Hoan thanh', color: 'var(--green)' },
            'cancelled': { label: 'Da huy', color: 'var(--red)' },
            'reported': { label: 'Da bao loi', color: 'var(--red)' },
        };

        container.innerHTML = orders.map(o => {
            const st = statusMap[o.status] || statusMap.pending;
            const shortId = (o.id || '').slice(-8).toUpperCase() || 'N/A';
            const date = o.createdAt ? new Date(o.createdAt) : null;
            const dateStr = (date && !isNaN(date.getTime())) ? date.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' }) : 'N/A';
            const timeStr = (date && !isNaN(date.getTime())) ? date.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' }) : '';
            const isOwned = o.accountType === 'owned';
            const displayName = o.userName || o.customerName || 'N/A';
            const displayContact = o.userEmail || (o.customerPhone ? `Zalo: ${o.customerPhone}` : 'N/A');
            const orderCode = o.orderCode ? `<span style="font-family:monospace;padding:2px 6px;border-radius:4px;background:var(--accent)15;color:var(--accent);margin-left:4px;">${o.orderCode}</span>` : '';
            const paymentBadge = o.paymentStatus === 'unpaid' ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:var(--orange)20;color:var(--orange);margin-left:6px;">Chua TT</span>' : (o.paymentStatus === 'paid' ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;background:var(--green)20;color:var(--green);margin-left:6px;">Da TT</span>' : '');
            let credSection = '';

            if (isOwned) {
                const upgradeEmail = o.credentials?.upgradeEmail || '';
                if (o.status === 'completed') {
                    credSection = `
                        <div style="margin-top:12px;padding:12px;background:var(--green)10;border:1px solid var(--green)30;border-radius:8px;">
                            <div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:4px;display:flex;align-items:center;gap:4px;">
                                ${icons.checkCircle} Da nâng cấp thành công
                            </div>
                            <div style="font-size:12px;color:var(--text-secondary);">
                                Email: <strong>${upgradeEmail}</strong>
                            </div>
                        </div>`;
                } else if (o.status === 'pending' || o.status === 'processing') {
                    credSection = `
                        <div style="margin-top:12px;padding:12px;background:var(--accent)10;border:1px solid var(--accent)30;border-radius:8px;">
                            <div style="font-size:12px;font-weight:600;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:4px;">
                                ${icons.user} Email cần nâng cấp: <strong>${upgradeEmail}</strong>
                            </div>
                            <button class="btn btn-primary btn-sm" id="adminConfirmBtn_${o.id}" onclick="confirmOwnedUpgrade('${o.id}')">Xác nhận đã nâng cấp xong</button>
                        </div>`;
                }
            } else {
                const hasCreds = o.credentials && o.credentials.email;
                credSection = hasCreds ? `
                    <div style="margin-top:12px;padding:12px;background:var(--green)10;border:1px solid var(--green)30;border-radius:8px;">
                        <div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:8px;display:flex;align-items:center;gap:4px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            Da gui tai khoan
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);display:grid;gap:4px;">
                            <span>Tai khoan: <strong>${o.credentials.email}</strong></span>
                            <span>Mat khau: <strong>${o.credentials.password}</strong></span>
                            <span>2FA: <strong>${o.credentials.code2fa || 'Khong co'}</strong></span>
                        </div>
                    </div>
                ` : `
                    <div style="margin-top:12px;padding:12px;background:var(--bg-tertiary);border:1px solid var(--border);border-radius:8px;">
                        <div style="font-size:12px;font-weight:600;color:var(--text-secondary);margin-bottom:10px;display:flex;align-items:center;gap:4px;">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            Gui thong tin tai khoan
                        </div>
                        <div style="display:grid;gap:8px;">
                            <input class="form-input" id="adminCredEmail_${o.id}" placeholder="Email/Tai khoan" style="font-size:13px;padding:8px 12px;">
                            <input class="form-input" id="adminCredPass_${o.id}" placeholder="Mat khau" style="font-size:13px;padding:8px 12px;">
                            <input class="form-input" id="adminCred2FA_${o.id}" placeholder="Ma 2FA (khong bat buoc)" style="font-size:13px;padding:8px 12px;">
                            <button class="btn btn-primary btn-sm" id="adminCredBtn_${o.id}" onclick="sendOrderCredentials('${o.id}')" style="justify-self:start;">Gui tai khoan</button>
                        </div>
                    </div>
                `;
            }

            return `
            <div class="card" style="margin-bottom:12px;">
                <div class="card-content" style="padding:16px 20px;">
                    <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:8px;">
                        <div>
                            <h3 style="font-size:15px;font-weight:600;margin-bottom:4px;">${o.productName || 'San pham'}</h3>
                            <p style="font-size:12px;color:var(--text-tertiary);">${o.accountTypeLabel || o.accountType || ''} &bull; ${o.duration || '?'} thang</p>
                        </div>
                        <div style="text-align:right;">
                            <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${st.color}20;color:${st.color};">${st.label}</span>
                            ${paymentBadge}
                        </div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);display:flex;gap:12px;flex-wrap:wrap;align-items:center;">
                        <span style="font-family:monospace;padding:2px 6px;border-radius:4px;background:var(--bg-tertiary);color:var(--text-tertiary);">ID: ${shortId}</span>
                        ${orderCode}
                        <span>Khach: <strong>${displayName}</strong></span>
                        <span>${o.userEmail ? 'Email' : 'Lien he'}: <strong>${displayContact}</strong></span>
                        <span>${formatPrice(o.price || 0)}</span>
                        <span>${dateStr} ${timeStr}</span>
                    </div>
                    ${credSection}
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error('[ADMIN ORDERS ERROR]', err);
        if (container) {
            container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Loi tai don hang</div><div style="color:var(--text-tertiary);font-size:13px;margin-top:8px;">' + (err.message || 'Loi ket noi server') + '</div><button class="btn btn-primary btn-sm" style="margin-top:12px;" onclick="loadAdminOrders()">Thu lai</button></div>';
        }
    }
}

function renderAdminBugs() {
    const bugs = Storage.get('bugReports', []);
    const products = _productsCache;

    return `
        <div class="admin-header">
            <h2 class="admin-title">Báo cáo lỗi (${bugs.length})</h2>
        </div>
        ${bugs.length ? `
        <div class="card" style="overflow-x:auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Sản phẩm</th>
                        <th>Loại lỗi</th>
                        <th>Mô tả</th>
                        <th>Email</th>
                        <th>Trạng thái</th>
                        <th>Ngày</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${bugs.map(b => {
                        const product = products.find(p => p.id === b.productId);
                        return `
                            <tr>
                                <td style="font-weight:500;">${product ? product.name : 'N/A'}</td>
                                <td><span class="badge badge-secondary">${b.type}</span></td>
                                <td style="max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${b.description}</td>
                                <td>${b.email}</td>
                                <td><span class="badge ${b.status === 'pending' ? 'badge-hot' : 'badge-new'}">${b.status === 'pending' ? 'Chờ xử lý' : 'Đã xử lý'}</span></td>
                                <td>${formatDate(b.date)}</td>
                                <td>
                                    ${b.status === 'pending' ? `<button class="btn btn-ghost btn-sm" onclick="resolveBug('${b.id}')">Xử lý</button>` : ''}
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
        ` : '<div class="empty-state"><div class="empty-state-title">Không có báo cáo lỗi nào</div></div>'}
    `;
}

// --- Admin Actions ---

// Customer Management
function renderAdminCustomers() {
    const customers = Storage.get('testimonials', []);
    return `
        <div class="admin-header">
            <h2 class="admin-title">Quản lý khách hàng (${customers.length})</h2>
        </div>
        <div class="card" style="padding:24px; margin-bottom:20px;">
            <h3 style="font-size:15px; font-weight:600; color:var(--white); margin-bottom:16px;">Thêm khách hàng mới</h3>
            <form onsubmit="addTestimonial(event)">
                <div class="grid-2">
                    <div class="form-group">
                        <label class="form-label">Tên khách hàng</label>
                        <input type="text" class="form-input" id="custName" placeholder="VD: Nguyễn Văn A" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Loại tài khoản</label>
                        <select class="form-select" id="custProduct" required>
                            <option value="">Chọn loại...</option>
                            <option value="ChatGPT Plus">ChatGPT Plus</option>
                            <option value="Claude Pro">Claude Pro</option>
                            <option value="GitHub Copilot Pro">GitHub Copilot Pro</option>
                            <option value="Cursor Pro">Cursor Pro</option>
                            <option value="Midjourney Pro">Midjourney Pro</option>
                            <option value="Gemini Advanced">Gemini Advanced</option>
                            <option value="Perplexity Pro">Perplexity Pro</option>
                            <option value="Notion AI">Notion AI</option>
                        </select>
                    </div>
                </div>
                <div class="grid-2">
                    <div class="form-group">
                        <label class="form-label">Ngày mua</label>
                        <input type="date" class="form-input" id="custDate" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Đánh giá (1-5)</label>
                        <select class="form-select" id="custRating" required>
                            <option value="5">5 - Xuất sắc</option>
                            <option value="4">4 - Tốt</option>
                            <option value="3">3 - Khá</option>
                            <option value="2">2 - Trung bình</option>
                            <option value="1">1 - Kém</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Link ảnh minh chứng</label>
                    <input type="text" class="form-input" id="custProofImg" placeholder="https://... hoặc đường dẫn ảnh" required>
                    <div class="form-hint">Dán URL ảnh chụp màn hình hoặc bằng chứng mua hàng</div>
                </div>
                <div class="form-group">
                    <label class="form-label">Nhận xét</label>
                    <textarea class="form-textarea" id="custText" placeholder="Nhận xét của khách hàng..." required></textarea>
                </div>
                <button type="submit" class="btn btn-primary btn-lg">Thêm khách hàng</button>
            </form>
        </div>
        ${customers.length ? `
        <div class="card" style="overflow-x:auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Tên</th>
                        <th>Loại TK</th>
                        <th>Ngày mua</th>
                        <th>Đánh giá</th>
                        <th>Ảnh</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${customers.map(c => `
                        <tr>
                            <td style="font-weight:500;">${c.name}</td>
                            <td><span class="badge badge-secondary">${c.product}</span></td>
                            <td>${formatDate(c.date)}</td>
                            <td><span style="color:var(--accent); font-weight:600;">${c.rating}/5</span></td>
                            <td><a href="${c.proofImg}" target="_blank" style="color:var(--accent);">Xem ảnh</a></td>
                            <td>
                                <button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteTestimonial('${c.id}')">Xóa</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : '<div class="empty-state"><div class="empty-state-title">Chưa có khách hàng nào</div></div>'}
    `;
}

function addTestimonial(e) {
    e.preventDefault();
    const testimonials = Storage.get('testimonials', []);
    testimonials.push({
        id: Date.now().toString(),
        name: document.getElementById('custName').value,
        product: document.getElementById('custProduct').value,
        date: document.getElementById('custDate').value,
        rating: parseInt(document.getElementById('custRating').value),
        proofImg: document.getElementById('custProofImg').value,
        text: document.getElementById('custText').value
    });
    Storage.set('testimonials', testimonials);
    showToast('Thêm khách hàng thành công!', 'success');
    navigate('admin', { tab: 'customers-mgmt' });
}

function deleteTestimonial(id) {
    if (!confirm('Xóa khách hàng này?')) return;
    let testimonials = Storage.get('testimonials', []);
    testimonials = testimonials.filter(t => t.id !== id);
    Storage.set('testimonials', testimonials);
    showToast('Đã xóa', 'info');
    navigate('admin', { tab: 'customers-mgmt' });
}

// Blog Management
function renderAdminBlogMgmt() {
    const posts = Storage.get('blogPosts', []);
    return `
        <div class="admin-header">
            <h2 class="admin-title">Quản lý Blog (${posts.length})</h2>
        </div>
        <div class="card" style="padding:24px; margin-bottom:20px;">
            <h3 style="font-size:15px; font-weight:600; color:var(--white); margin-bottom:16px;">Đăng bài viết mới</h3>
            <form onsubmit="addBlogPost(event)">
                <div class="form-group">
                    <label class="form-label">Tiêu đề bài viết (SEO Title)</label>
                    <input type="text" class="form-input" id="blogTitle" placeholder="VD: So sánh ChatGPT vs Claude Pro..." required>
                    <div class="form-hint">Tối ưu 50-60 ký tự cho SEO</div>
                </div>
                <div class="form-group">
                    <label class="form-label">Slug URL</label>
                    <input type="text" class="form-input" id="blogSlug" placeholder="so-sanh-chatgpt-vs-claude-pro">
                    <div class="form-hint">Tự động tạo từ tiêu đề nếu để trống</div>
                </div>
                <div class="form-group">
                    <label class="form-label">Meta Description (SEO)</label>
                    <textarea class="form-textarea" id="blogMeta" style="min-height:60px;" placeholder="Mô tả ngắn gọn cho SEO (150-160 ký tự)"></textarea>
                    <div class="form-hint">Mô tả hiển thị trên kết quả tìm kiếm Google</div>
                </div>
                <div class="form-group">
                    <label class="form-label">Ảnh đại diện (URL)</label>
                    <input type="text" class="form-input" id="blogImageUrl" placeholder="https://example.com/blog-cover.jpg">
                    <div class="form-hint">Link ảnh đại diện cho bài viết</div>
                </div>
                <div class="grid-2">
                    <div class="form-group">
                        <label class="form-label">Danh mục</label>
                        <select class="form-select" id="blogCategory" required>
                            <option value="">Chọn danh mục...</option>
                            <option value="So sánh">So sánh</option>
                            <option value="Hướng dẫn">Hướng dẫn</option>
                            <option value="Review">Review</option>
                            <option value="Xu hướng">Xu hướng</option>
                            <option value="Bảo mật">Bảo mật</option>
                            <option value="Mẹo vặt">Mẹo vặt</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Thời gian đọc</label>
                        <input type="text" class="form-input" id="blogReadTime" placeholder="VD: 8 phút" required>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Tóm tắt (Excerpt)</label>
                    <textarea class="form-textarea" id="blogExcerpt" placeholder="Tóm tắt bài viết hiển thị trong danh sách..." required></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Nội dung bài viết (HTML)</label>
                    <textarea class="form-textarea" id="blogContent" style="min-height:200px;" placeholder="<h2>Giới thiệu</h2><p>Nội dung...</p>"></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Từ khóa SEO (cách nhau bởi dấu phẩy)</label>
                    <input type="text" class="form-input" id="blogKeywords" placeholder="chatgpt, claude, ai, so sánh">
                </div>
                <button type="submit" class="btn btn-primary btn-lg">Đăng bài</button>
            </form>
        </div>
        ${posts.length ? `
        <div class="card" style="overflow-x:auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Tiêu đề</th>
                        <th>Danh mục</th>
                        <th>Ngày đăng</th>
                        <th>Slug</th>
                        <th>Thao tác</th>
                    </tr>
                </thead>
                <tbody>
                    ${posts.map(p => `
                        <tr>
                            <td style="font-weight:500; max-width:250px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${p.title}</td>
                            <td><span class="badge badge-secondary">${p.category}</span></td>
                            <td>${formatDate(p.date)}</td>
                            <td style="font-family:monospace; font-size:11px; color:var(--text-tertiary);">${p.slug || ''}</td>
                            <td>
                                <button class="btn btn-ghost btn-sm" style="color:var(--red);" onclick="deleteBlogPost('${p.id}')">Xóa</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        ` : '<div class="empty-state"><div class="empty-state-title">Chưa có bài viết nào</div></div>'}
    `;
}

function addBlogPost(e) {
    e.preventDefault();
    const posts = Storage.get('blogPosts', []);
    const title = document.getElementById('blogTitle').value;
    let slug = document.getElementById('blogSlug').value.trim();
    if (!slug) {
        slug = title.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }
    posts.push({
        id: Date.now().toString(),
        title,
        slug,
        imageUrl: document.getElementById('blogImageUrl').value.trim() || null,
        metaDescription: document.getElementById('blogMeta').value,
        category: document.getElementById('blogCategory').value,
        readTime: document.getElementById('blogReadTime').value,
        excerpt: document.getElementById('blogExcerpt').value,
        content: document.getElementById('blogContent').value,
        keywords: document.getElementById('blogKeywords').value.split(',').map(k => k.trim()).filter(Boolean),
        date: new Date().toISOString().split('T')[0]
    });
    Storage.set('blogPosts', posts);
    showToast('Đăng bài viết thành công!', 'success');
    navigate('admin', { tab: 'blog-mgmt' });
}

function deleteBlogPost(id) {
    if (!confirm('Xóa bài viết này?')) return;
    let posts = Storage.get('blogPosts', []);
    posts = posts.filter(p => p.id !== id);
    Storage.set('blogPosts', posts);
    showToast('Đã xóa bài viết', 'info');
    navigate('admin', { tab: 'blog-mgmt' });
}
async function addProduct(e) {
    e.preventDefault();

    const constructAccountTypes = () => {
        const accTypeRadio = document.querySelector('input[name="prodAccType"]:checked').value;
        let sharedPrices = {};
        let ownedPrices = {};
        for (let i = 0; i < 4; i++) {
            let m = document.getElementById('slot_month_' + i)?.value.trim();
            if (!m) continue;
            let monthNum = parseInt(m);
            if (accTypeRadio === 'shared' || accTypeRadio === 'both') {
               let s = document.getElementById('slot_shared_' + i).value.trim();
               if (s) sharedPrices[monthNum] = parseInt(s);
            }
            if (accTypeRadio === 'owned' || accTypeRadio === 'both') {
               let o = document.getElementById('slot_owned_' + i).value.trim();
               if (o) ownedPrices[monthNum] = parseInt(o);
            }
        }
        const accTypes = [];
        if (Object.keys(sharedPrices).length > 0 || accTypeRadio === 'shared') {
            accTypes.push({ type: 'shared', label: 'Tài khoản cấp', prices: sharedPrices });
        }
        if (Object.keys(ownedPrices).length > 0 || accTypeRadio === 'owned') {
            accTypes.push({ type: 'owned', label: 'Chính chủ (nâng cấp)', prices: ownedPrices });
        }
        return accTypes;
    };

    const accountTypes = constructAccountTypes();
    const firstPrice = accountTypes[0]?.prices ? Object.values(accountTypes[0].prices)[0] : 0;

    const newProduct = {
        name: document.getElementById('prodName').value,
        shortName: document.getElementById('prodShortName').value,
        imageUrl: document.getElementById('prodImageUrl').value.trim() || null,
        category: document.getElementById('prodCategory').value,
        description: document.getElementById('prodDescription').value,
        price: firstPrice,
        originalPrice: firstPrice,
        accountTypes,
        isHot: document.getElementById('prodIsHot').checked,
        isTrending: document.getElementById('prodIsTrending').checked,
        isNew: document.getElementById('prodIsNew').checked,
        inStock: document.getElementById('prodInStock').checked,
        features: document.getElementById('prodFeatures').value.split('\n').filter(f => f.trim()),
        videoUrl: document.getElementById('prodVideoUrl').value,
        docs: document.getElementById('prodDocs').value
    };

    try {
        const data = await Api.post('/admin/products', newProduct);
        if (data.success) {
            showToast('Thêm sản phẩm thành công!', 'success');
            await loadProducts();
            navigate('admin', { tab: 'products' });
        } else {
            showToast(data.message || 'Lỗi tạo sản phẩm', 'error');
        }
    } catch (err) {
        showToast('Lỗi tạo sản phẩm', 'error');
    }
}

function editProduct(productId) {
    const product = _productsCache.find(p => p.id === productId);

    if (!product) return;

    const adminContent = document.querySelector('.admin-content');
    adminContent.innerHTML = renderAdminAddProduct(product);

    // Update sidebar active state
    document.querySelectorAll('.admin-nav-item').forEach(item => item.classList.remove('active'));
}

async function updateProduct(e, productId) {
    e.preventDefault();

    const constructAccountTypes = () => {
        const accTypeRadio = document.querySelector('input[name="prodAccType"]:checked').value;
        let sharedPrices = {};
        let ownedPrices = {};
        for (let i = 0; i < 4; i++) {
            let m = document.getElementById('slot_month_' + i)?.value.trim();
            if (!m) continue;
            let monthNum = parseInt(m);
            if (accTypeRadio === 'shared' || accTypeRadio === 'both') {
               let s = document.getElementById('slot_shared_' + i).value.trim();
               if (s) sharedPrices[monthNum] = parseInt(s);
            }
            if (accTypeRadio === 'owned' || accTypeRadio === 'both') {
               let o = document.getElementById('slot_owned_' + i).value.trim();
               if (o) ownedPrices[monthNum] = parseInt(o);
            }
        }
        const accTypes = [];
        if (Object.keys(sharedPrices).length > 0 || accTypeRadio === 'shared') {
            accTypes.push({ type: 'shared', label: 'Tài khoản cấp', prices: sharedPrices });
        }
        if (Object.keys(ownedPrices).length > 0 || accTypeRadio === 'owned') {
            accTypes.push({ type: 'owned', label: 'Chính chủ (nâng cấp)', prices: ownedPrices });
        }
        return accTypes;
    };

    const accountTypes = constructAccountTypes();
    const firstPrice = accountTypes[0]?.prices ? Object.values(accountTypes[0].prices)[0] : 0;

    const updates = {
        name: document.getElementById('prodName').value,
        shortName: document.getElementById('prodShortName').value,
        imageUrl: document.getElementById('prodImageUrl').value.trim() || null,
        category: document.getElementById('prodCategory').value,
        description: document.getElementById('prodDescription').value,
        price: firstPrice,
        originalPrice: firstPrice,
        accountTypes,
        isHot: document.getElementById('prodIsHot').checked,
        isTrending: document.getElementById('prodIsTrending').checked,
        isNew: document.getElementById('prodIsNew').checked,
        inStock: document.getElementById('prodInStock').checked,
        features: document.getElementById('prodFeatures').value.split('\n').filter(f => f.trim()),
        videoUrl: document.getElementById('prodVideoUrl').value,
        docs: document.getElementById('prodDocs').value
    };

    try {
        const data = await Api.put(`/admin/products/${productId}`, updates);
        if (data.success) {
            showToast('Cập nhật sản phẩm thành công!', 'success');
            await loadProducts();
            navigate('admin', { tab: 'products' });
        } else {
            showToast(data.message || 'Lỗi cập nhật', 'error');
        }
    } catch (err) {
        showToast('Lỗi cập nhật sản phẩm', 'error');
    }
}

async function deleteProduct(productId) {
    if (!confirm('Bạn có chắc muốn xóa sản phẩm này?')) return;
    try {
        const data = await Api.call(`/admin/products/${productId}`, 'DELETE');
        if (data.success) {
            showToast('Đã xóa sản phẩm', 'info');
            await loadProducts();
            navigate('admin', { tab: 'products' });
        } else {
            showToast(data.message || 'Lỗi xóa sản phẩm', 'error');
        }
    } catch (err) {
        showToast('Lỗi xóa sản phẩm', 'error');
    }
}

function resolveBug(bugId) {
    const bugs = Storage.get('bugReports', []);
    const bug = bugs.find(b => b.id === bugId);
    if (bug) {
        bug.status = 'resolved';
        Storage.set('bugReports', bugs);
        showToast('Đã đánh dấu là đã xử lý', 'success');
        navigate('admin', { tab: 'bugs' });
    }
}

// --- Admin Banners ---
function renderAdminBanners() {
    setTimeout(loadAdminBanners, 50);
    return `
        <div class="admin-header" style="justify-content:space-between;">
            <h2 class="admin-title">Quản lý Banners</h2>
            <button class="btn btn-primary" onclick="showAddBannerModal()">+ Thêm Banner</button>
        </div>
        
        <div class="admin-card">
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Ảnh</th>
                            <th>Tiêu đề</th>
                            <th>Link URL</th>
                            <th>Thứ tự</th>
                            <th>Trạng thái</th>
                            <th>Thao tác</th>
                        </tr>
                    </thead>
                    <tbody id="adminBannersTbody">
                        <tr><td colspan="6" style="text-align:center;">Đang tải...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Add Banner Modal -->
        <div id="addBannerModal" class="modal" style="display:none;">
            <div class="modal-content" style="max-width:500px;">
                <div class="modal-header">
                    <h3 class="modal-title">Thêm Banner</h3>
                    <button class="modal-close" onclick="closeAddBannerModal()">&times;</button>
                </div>
                <div class="modal-body">
                    <form id="addBannerForm" onsubmit="submitAddBanner(event)">
                        <div class="form-group">
                            <label class="form-label">Tiêu đề (không bắt buộc)</label>
                            <input type="text" class="form-input" id="bannerTitleVal">
                        </div>
                        <div class="form-group">
                            <label class="form-label">URL Ảnh (bắt buộc)</label>
                            <input type="url" class="form-input" id="bannerImageUrlVal" required>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Link Đích</label>
                            <input type="text" class="form-input" id="bannerLinkVal">
                        </div>
                        <div class="form-group">
                            <label class="form-label">Thứ tự hiển thị (0 hiện trước)</label>
                            <input type="number" class="form-input" id="bannerSortVal" value="0">
                        </div>
                        <div class="form-group" style="display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" id="bannerActiveVal" checked>
                            <label for="bannerActiveVal">Hoạt động</label>
                        </div>
                        <button type="submit" class="btn btn-primary btn-full">Lưu banner</button>
                    </form>
                </div>
            </div>
        </div>
    `;
}

async function loadAdminBanners() {
    try {
        const data = await Api.get('/admin/banners');
        const tbody = document.getElementById('adminBannersTbody');
        if (!tbody) return;

        if (!data.success) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);">Lỗi tải banners</td></tr>';
            return;
        }

        if (!data.banners || data.banners.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Chưa có banner nào</td></tr>';
            return;
        }

        tbody.innerHTML = data.banners.map(b => `
            <tr style="vertical-align: middle;">
                <td><img src="${b.imageUrl}" style="height:40px; border-radius:4px; object-fit:cover;"></td>
                <td>${b.title || '-'}</td>
                <td><div style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${b.link || '-'}</div></td>
                <td>${b.sortOrder}</td>
                <td>
                    <span class="badge badge-${b.isActive ? 'primary' : 'danger'}">
                        ${b.isActive ? 'Bật' : 'Tắt'}
                    </span>
                </td>
                <td>
                    <button class="btn btn-sm btn-outline" style="color:var(--danger); border-color:var(--danger);" onclick="deleteBanner('${b.id}')">Xóa</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

function showAddBannerModal() {
    document.getElementById('addBannerModal').style.display = 'flex';
}

function closeAddBannerModal() {
    document.getElementById('addBannerModal').style.display = 'none';
    document.getElementById('addBannerForm').reset();
}

async function submitAddBanner(e) {
    e.preventDefault();
    const title = document.getElementById('bannerTitleVal').value;
    const imageUrl = document.getElementById('bannerImageUrlVal').value;
    const link = document.getElementById('bannerLinkVal').value;
    const sortOrder = document.getElementById('bannerSortVal').value;
    const isActive = document.getElementById('bannerActiveVal').checked;

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;

    try {
        const data = await Api.post('/admin/banners', { title, imageUrl, link, sortOrder, isActive });
        if (data.success) {
            showToast('Thêm banner thành công!', 'success');
            closeAddBannerModal();
            loadAdminBanners();
        } else {
            showToast(data.message || 'Lỗi thêm banner', 'error');
        }
    } catch (err) {
        showToast('Lỗi gửi request', 'error');
    } finally {
        btn.disabled = false;
    }
}

async function deleteBanner(id) {
    if (!confirm('Bạn có chắc muốn xóa banner này vĩnh viễn?')) return;
    try {
        const data = await Api.call('/admin/banners/' + id, 'DELETE');
        if (data.success) {
            showToast('Xóa banner thành công!', 'success');
            loadAdminBanners();
        } else {
            showToast(data.message || 'Không thể xóa banner', 'error');
        }
    } catch (err) {
        showToast('Lỗi xử lý', 'error');
    }
}


function renderProfilePage() {
    const u = currentUser || {};
    return `
        <div class="auth-page">
            <div class="auth-card" style="max-width:560px;">
                <h2 class="auth-title">Hồ sơ cá nhân</h2>
                <p class="auth-subtitle">Quản lý thông tin tài khoản của bạn</p>

                <div style="background:var(--card-bg);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:24px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span style="color:var(--text-secondary);">Email</span>
                        <span>${u.email || ''}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;margin-bottom:8px;">
                        <span style="color:var(--text-secondary);">Trạng thái email</span>
                        <span class="badge ${u.email_verified ? 'badge-hot' : 'badge-new'}">${u.email_verified ? 'Đã xác thực' : 'Chưa xác thực'}</span>
                    </div>
                    <div style="display:flex;justify-content:space-between;">
                        <span style="color:var(--text-secondary);">Vai trò</span>
                        <span class="badge badge-trending">${u.role === 'admin' ? 'Admin' : 'User'}</span>
                    </div>
                    ${!u.email_verified ? `
                    <div style="margin-top:12px;text-align:center;">
                        <button class="btn btn-primary" onclick="navigate('verify-email')">Xác thực email ngay</button>
                    </div>` : ''}
                </div>

                <form onsubmit="updateProfile(event)">
                    <h3 style="font-size:1rem;font-weight:600;margin-bottom:16px;color:var(--accent);">Thông tin cá nhân</h3>
                    <div class="form-group">
                        <label class="form-label">Họ tên</label>
                        <input type="text" class="form-input" id="profileName" value="${u.name || ''}" placeholder="Nguyễn Văn A">
                        <span class="form-error" id="profileNameError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Số Zalo</label>
                        <input type="text" class="form-input" id="profilePhone" value="${u.phone_zalo || ''}" placeholder="0987654321">
                        <span class="form-error" id="profilePhoneError"></span>
                    </div>
                    <div class="grid-2">
                        <div class="form-group">
                            <label class="form-label">Ngân hàng</label>
                            <select class="form-select" id="profileBankName">
                                <option value="">Chọn ngân hàng</option>
                                ${[
                                    'Vietcombank', 'BIDV', 'Agribank', 'Vietinbank', 'Techcombank',
                                    'MB Bank', 'ACB', 'Sacombank', 'VPBank', 'TPBank', 'OCB',
                                    'HDBank', 'SHB', 'MSB', 'VIB', 'SeABank', 'Eximbank', 'Ngân hàng khác'
                                ].map(b => `<option value="${b}" ${u.bank_name === b ? 'selected' : ''}>${b}</option>`).join('')}
                            </select>
                            <span class="form-error" id="profileBankNameError"></span>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Số tài khoản</label>
                            <input type="text" class="form-input" id="profileBankAccount" value="${u.bank_account || ''}" placeholder="123456789">
                            <span class="form-error" id="profileBankAccountError"></span>
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Lưu thông tin</button>
                </form>

                <hr style="border:none;border-top:1px solid var(--border);margin:28px 0;">

                <form onsubmit="changePassword(event)">
                    <h3 style="font-size:1rem;font-weight:600;margin-bottom:16px;color:var(--accent);">Đổi mật khẩu</h3>
                    <div class="form-group">
                        <label class="form-label">Mật khẩu hiện tại</label>
                        <input type="password" class="form-input" id="currentPassword" placeholder="Nhập mật khẩu hiện tại" autocomplete="current-password">
                        <span class="form-error" id="currentPasswordError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mật khẩu mới</label>
                        <input type="password" class="form-input" id="newPassword" placeholder="Tối thiểu 6 ký tự, 1 hoa, 1 số" autocomplete="new-password">
                        <span class="form-error" id="newPasswordError"></span>
                    </div>
                    <button type="submit" class="btn btn-outline btn-full btn-lg">Đổi mật khẩu</button>
                </form>

                <div class="auth-footer" style="margin-top:24px;">
                    <a href="javascript:void(0)" onclick="navigate('home')">← Quay lại trang chủ</a>
                </div>
            </div>
        </div>
    `;
}

function updateProfile(e) {
    e.preventDefault();
    clearFormErrors(['profileName', 'profilePhone', 'profileBankName', 'profileBankAccount']);

    const name = document.getElementById('profileName').value.trim();
    const phone_zalo = document.getElementById('profilePhone').value.trim();
    const bank_name = document.getElementById('profileBankName').value;
    const bank_account = document.getElementById('profileBankAccount').value.trim();

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';

    Api.put('/profile', { name, phone_zalo, bank_account, bank_name })
        .then(data => {
            if (data.success) {
                currentUser = data.user;
                Storage.set('currentUser', data.user);
                updateAuthUI();
                showToast(data.message, 'success');
            } else {
                const mapped = {};
                if (data.errors) {
                    if (data.errors.name) mapped.profileName = data.errors.name;
                    if (data.errors.phone_zalo) mapped.profilePhone = data.errors.phone_zalo;
                    if (data.errors.bank_name) mapped.profileBankName = data.errors.bank_name;
                    if (data.errors.bank_account) mapped.profileBankAccount = data.errors.bank_account;
                }
                showFieldErrors(mapped);
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Lưu thông tin'; });
}

function changePassword(e) {
    e.preventDefault();
    clearFormErrors(['currentPassword', 'newPassword']);

    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;

    if (!currentPassword) { showFieldErrors({ currentPassword: 'Vui lòng nhập mật khẩu hiện tại' }); return; }
    if (!newPassword || newPassword.length < 6) { showFieldErrors({ newPassword: 'Mật khẩu mới tối thiểu 6 ký tự' }); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    Api.put('/profile/password', { currentPassword, newPassword })
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                document.getElementById('currentPassword').value = '';
                document.getElementById('newPassword').value = '';
            } else {
                const mapped = {};
                if (data.errors) {
                    if (data.errors.currentPassword) mapped.currentPassword = data.errors.currentPassword;
                    if (data.errors.newPassword) mapped.newPassword = data.errors.newPassword;
                }
                showFieldErrors(mapped);
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Đổi mật khẩu'; });
}

// ═══════════════════════════════════════════════════════════
// ─── AFFILIATE / CTV PAGE ────────────────────────────────
// ═══════════════════════════════════════════════════════════

function renderAffiliatePage() {
    return `
        <div style="min-height:80vh;padding:48px 16px;">
            <div style="width:100%;max-width:860px;margin:0 auto;">
                <h1 style="color:var(--text-primary);font-size:24px;font-weight:600;margin:0 0 4px;">Cộng tác viên</h1>
                <p style="color:var(--text-tertiary);font-size:14px;margin:0 0 32px;">Giới thiệu khách hàng và nhận hoa hồng cho mỗi đơn hàng thành công.</p>
                <div id="affiliateContent">
                    <div style="text-align:center;padding:48px 0;color:#666;">Đang tải...</div>
                </div>
            </div>
        </div>
    `;
}

// --- Giao diện đăng ký CTV ---
function renderAffiliateRegisterCard() {
    return `
        <div style="border:1px solid var(--border);border-radius:8px;padding:32px;max-width:480px;margin:0 auto;">
            <h3 style="color:var(--text-primary);font-size:18px;font-weight:600;margin:0 0 16px;">Tham gia chương trình CTV</h3>
            <ul style="list-style:none;padding:0;margin:0 0 24px;">
                <li style="color:var(--text-secondary);font-size:14px;padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;">
                    <span style="color:var(--text-primary);font-weight:500;">→</span> Nhận hoa hồng cho mỗi đơn hàng thành công
                </li>
                <li style="color:var(--text-secondary);font-size:14px;padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;">
                    <span style="color:var(--text-primary);font-weight:500;">→</span> Link giới thiệu cá nhân, theo dõi realtime
                </li>
                <li style="color:var(--text-secondary);font-size:14px;padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;">
                    <span style="color:var(--text-primary);font-weight:500;">→</span> Hoa hồng tích lũy vào ví, dùng mua hàng hoặc rút tiền
                </li>
                <li style="color:var(--text-secondary);font-size:14px;padding:8px 0;display:flex;gap:10px;">
                    <span style="color:var(--text-primary);font-weight:500;">→</span> Hoàn toàn miễn phí, không giới hạn thu nhập
                </li>
            </ul>
            <button class="btn btn-primary btn-full" onclick="registerAffiliate()" id="btnRegisterAffiliate"
                style="padding:10px 0;font-size:14px;font-weight:500;">
                Đăng ký CTV
            </button>
        </div>
    `;
}

// --- Admin CTV Management ---
function renderAdminCTV() {
    setTimeout(loadAdminCTVList, 50);
    return `
        <div class="admin-header" style="justify-content:space-between;">
            <h2 class="admin-title">Quản lý Cộng tác viên</h2>
        </div>
        <div class="admin-card">
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Tên</th>
                            <th>Email</th>
                            <th>Referral Code</th>
                            <th>Số dư ví</th>
                            <th>Hoa hồng (%)</th>
                            <th>Thao tác</th>
                        </tr>
                    </thead>
                    <tbody id="adminCTVTbody">
                        <tr><td colspan="6" style="text-align:center;">Đang tải...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

async function loadAdminCTVList() {
    try {
        const data = await Api.get('/admin/users');
        const tbody = document.getElementById('adminCTVTbody');
        if (!tbody) return;

        if (!data.success) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--danger);">Lỗi tải danh sách</td></tr>';
            return;
        }

        // Lọc chỉ những user là CTV (is_affiliate = true)
        const ctvUsers = (data.users || []).filter(u => u.is_affiliate);

        if (ctvUsers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Chưa có CTV nào</td></tr>';
            return;
        }

        tbody.innerHTML = ctvUsers.map(u => `
            <tr style="vertical-align:middle;">
                <td>${u.name || '—'}</td>
                <td style="font-size:13px;color:var(--text-secondary);">${u.email}</td>
                <td><code style="font-size:12px;">${u.referral_code || '—'}</code></td>
                <td>${(u.wallet_balance || 0).toLocaleString('vi-VN')}đ</td>
                <td>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <input type="number" id="ctvRate_${u.id}" value="${u.commission_rate || 10}" min="0" max="100" step="1"
                            style="width:60px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text-primary);font-size:13px;text-align:center;" />
                        <span style="color:var(--text-muted);font-size:12px;">%</span>
                    </div>
                </td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="saveCommissionRate('${u.id}')" style="font-size:12px;padding:4px 12px;">Lưu</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error(err);
    }
}

async function saveCommissionRate(userId) {
    const input = document.getElementById('ctvRate_' + userId);
    if (!input) return;
    const rate = parseInt(input.value);
    if (isNaN(rate) || rate < 0 || rate > 100) {
        showToast('Tỉ lệ hoa hồng phải từ 0 đến 100%', 'error');
        return;
    }
    try {
        const data = await Api.put('/admin/users/' + userId, { commission_rate: rate });
        if (data.success) {
            showToast(`Đã cập nhật tỉ lệ hoa hồng: ${rate}%`, 'success');
        } else {
            showToast(data.message || 'Lỗi cập nhật', 'error');
        }
    } catch (err) {
        showToast('Lỗi kết nối server', 'error');
    }
}

// --- Dashboard CTV (Vercel-style) ---
function renderAffiliateDashboard(data) {
    const d = data.dashboard;
    return `
        <!-- Referral Link Card -->
        <div style="border:1px solid var(--border);border-radius:8px;padding:16px 20px;margin-bottom:24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <span style="color:var(--text-tertiary);font-size:12px;font-weight:500;text-transform:uppercase;letter-spacing:.5px;">Link gi\u1edbi thi\u1ec7u</span>
                <span style="color:var(--text-muted);font-size:12px;font-family:monospace;">${d.referralCode}</span>
            </div>
            <div style="display:flex;gap:8px;">
                <input type="text" value="${d.referralLink}" readonly id="refLinkInput"
                    style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text-primary);font-size:13px;font-family:monospace;" />
                <button onclick="copyRefLink()" id="btnCopyRef"
                    style="background:var(--white);color:var(--bg);border:none;border-radius:6px;padding:8px 16px;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;">
                    Copy
                </button>
            </div>
        </div>

        <!-- Stats Grid -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#333;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:24px;">
            <div style="background:var(--bg);padding:20px;text-align:center;">
                <div style="color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">S\u1ed1 d\u01b0 v\u00ed</div>
                <div style="color:var(--text-primary);font-size:22px;font-weight:600;">${formatPrice(d.walletBalance)}</div>
            </div>
            <div style="background:var(--bg);padding:20px;text-align:center;">
                <div style="color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">Ng\u01b0\u1eddi gi\u1edbi thi\u1ec7u</div>
                <div style="color:var(--text-primary);font-size:22px;font-weight:600;">${d.totalReferrals}</div>
            </div>
            <div style="background:var(--bg);padding:20px;text-align:center;">
                <div style="color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">T\u1ed5ng hoa h\u1ed3ng</div>
                <div style="color:var(--text-primary);font-size:22px;font-weight:600;">${formatPrice(d.totalCommission)}</div>
            </div>
            <div style="background:var(--bg);padding:20px;text-align:center;">
                <div style="color:var(--text-tertiary);font-size:11px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">T\u1ef7 l\u1ec7</div>
                <div style="color:var(--text-primary);font-size:22px;font-weight:600;">${d.commissionRate}%</div>
            </div>
        </div>

        <!-- Bảng thu nhập mẫu -->
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:24px;">
            <div style="padding:14px 20px;border-bottom:1px solid var(--border-light);">
                <span style="color:var(--text-primary);font-size:14px;font-weight:600;">B\u1ea3ng thu nh\u1eadp d\u1ef1 ki\u1ebfn</span>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                <thead>
                    <tr>
                        <th style="padding:10px 20px;text-align:left;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Kh\u00e1ch gi\u1edbi thi\u1ec7u</th>
                        <th style="padding:10px 20px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">\u0110\u01a1n h\u00e0ng TB</th>
                        <th style="padding:10px 20px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Hoa h\u1ed3ng / \u0111\u01a1n</th>
                        <th style="padding:10px 20px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Thu nh\u1eadp / th\u00e1ng</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-secondary);font-size:13px;">5 ng\u01b0\u1eddi</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">200,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">20,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-primary);font-size:13px;font-weight:500;text-align:right;">100,000d</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-secondary);font-size:13px;">20 ng\u01b0\u1eddi</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">200,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">20,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-primary);font-size:13px;font-weight:500;text-align:right;">400,000d</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-secondary);font-size:13px;">50 ng\u01b0\u1eddi</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">200,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">20,000d</td>
                        <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-primary);font-size:13px;font-weight:500;text-align:right;">1,000,000d</td>
                    </tr>
                    <tr>
                        <td style="padding:10px 20px;color:var(--text-secondary);font-size:13px;">100 ng\u01b0\u1eddi</td>
                        <td style="padding:10px 20px;color:var(--text-tertiary);font-size:13px;text-align:right;">200,000d</td>
                        <td style="padding:10px 20px;color:var(--text-tertiary);font-size:13px;text-align:right;">20,000d</td>
                        <td style="padding:10px 20px;color:var(--text-primary);font-size:13px;font-weight:600;text-align:right;">2,000,000d</td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- L\u1ecbch s\u1eed hoa h\u1ed3ng -->
        <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;">
            <div style="padding:14px 20px;border-bottom:1px solid var(--border-light);">
                <span style="color:var(--text-primary);font-size:14px;font-weight:600;">L\u1ecbch s\u1eed hoa h\u1ed3ng</span>
            </div>
            <div id="commissionHistory">
                <div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">\u0110ang t\u1ea3i...</div>
            </div>
        </div>
    `;
}

// Copy link
function copyRefLink() {
    const input = document.getElementById('refLinkInput');
    if (input) {
        navigator.clipboard.writeText(input.value).then(() => {
            const btn = document.getElementById('btnCopyRef');
            if (btn) { btn.textContent = '\u0110\u00e3 copy'; setTimeout(() => btn.textContent = 'Copy', 2000); }
            showToast('\u0110\u00e3 copy link gi\u1edbi thi\u1ec7u!', 'success');
        });
    }
}

// \u0110\u0103ng k\u00fd CTV
function registerAffiliate() {
    const btn = document.getElementById('btnRegisterAffiliate');
    if (btn) { btn.disabled = true; btn.textContent = '\u0110ang x\u1eed l\u00fd...'; }

    Api.post('/affiliate/register', {})
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                loadAffiliateDashboard();
            } else {
                showToast(data.message || 'L\u1ed7i \u0111\u0103ng k\u00fd CTV', 'error');
            }
        })
        .catch(() => showToast('L\u1ed7i k\u1ebft n\u1ed1i server', 'error'))
        .finally(() => { if (btn) { btn.disabled = false; btn.textContent = '\u0110\u0103ng k\u00fd CTV'; } });
}

// Load dashboard CTV
function loadAffiliateDashboard() {
    const container = document.getElementById('affiliateContent');
    if (!container) return;

    Api.get('/affiliate/dashboard')
        .then(data => {
            if (data.success) {
                container.innerHTML = renderAffiliateDashboard(data);
                loadCommissionHistory();
            } else {
                container.innerHTML = renderAffiliateRegisterCard();
            }
        })
        .catch(() => {
            container.innerHTML = renderAffiliateRegisterCard();
        });
}

// Load lich su hoa hong
function loadCommissionHistory() {
    const historyEl = document.getElementById('commissionHistory');
    if (!historyEl) return;

    Api.get('/affiliate/commissions')
        .then(data => {
            if (!data.success || !data.commissions || data.commissions.length === 0) {
                historyEl.innerHTML = '<div style="text-align:center;padding:32px;color:var(--text-muted);font-size:13px;">Ch\u01b0a c\u00f3 hoa h\u1ed3ng n\u00e0o</div>';
                return;
            }

            const rows = data.commissions.map(c => `
                <tr>
                    <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;">${new Date(c.createdAt).toLocaleDateString('vi')}</td>
                    <td style="padding:10px 20px;border-bottom:1px solid var(--border-light);color:var(--text-secondary);font-size:13px;">${c.productName || '—'}</td>
                    <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;">${c.buyerName || '—'}</td>
                    <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;color:var(--text-tertiary);font-size:13px;text-align:right;">${formatPrice(c.orderAmount)}</td>
                    <td style="padding:10px 20px;border-bottom:1px solid #1a1a1a;text-align:right;">
                        <span style="color:#30d158;font-weight:500;">+${formatPrice(c.commissionAmount)}</span>
                    </td>
                </tr>
            `).join('');

            historyEl.innerHTML = `
                <div style="overflow-x:auto;">
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr>
                                <th style="padding:10px 20px;text-align:left;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Ng\u00e0y</th>
                                <th style="padding:10px 20px;text-align:left;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">S\u1ea3n ph\u1ea9m</th>
                                <th style="padding:10px 20px;text-align:left;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Kh\u00e1ch h\u00e0ng</th>
                                <th style="padding:10px 20px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">\u0110\u01a1n h\u00e0ng</th>
                                <th style="padding:10px 20px;text-align:right;color:var(--text-muted);font-size:12px;font-weight:500;border-bottom:1px solid var(--border-light);">Hoa h\u1ed3ng</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
            `;
        })
        .catch(() => {
            historyEl.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-muted);font-size:13px;">L\u1ed7i t\u1ea3i d\u1eef li\u1ec7u</div>';
        });
}


// ===== VERIFY EMAIL PAGE =====
function renderVerifyEmailPage() {
    return `
        <div class="auth-page">
            <div class="auth-card">
                <h2 class="auth-title">Xác thực Email</h2>
                <p class="auth-subtitle">Chúng tôi đã gửi mã xác thực 6 số đến email <strong>${currentUser?.email || ''}</strong></p>
                <form onsubmit="verifyEmail(event)">
                    <div class="form-group">
                        <label class="form-label">Mã xác thực</label>
                        <input type="text" class="form-input" id="otpCode" placeholder="Nhập mã 6 số" maxlength="6" style="text-align:center;font-size:1.5rem;letter-spacing:8px;font-weight:700;" autocomplete="one-time-code">
                        <span class="form-error" id="otpCodeError"></span>
                        <p class="form-hint">Kiểm tra hộp thư (hoặc console nếu chưa cấu hình email)</p>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Xác thực</button>
                </form>
                <div style="text-align:center;margin-top:16px;">
                    <button class="btn btn-ghost" onclick="resendOtp()" id="resendBtn">Gửi lại mã</button>
                </div>
                <div class="auth-footer">
                    <a href="javascript:void(0)" onclick="navigate('home')">Bỏ qua (xác thực sau)</a>
                </div>
            </div>
        </div>
    `;
}

function verifyEmail(e) {
    e.preventDefault();
    clearFormErrors(['otpCode']);
    const code = document.getElementById('otpCode').value.trim();
    if (!code) { showFieldErrors({ otpCode: 'Vui lòng nhập mã' }); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang xác thực...';

    Api.post('/verify-email', { code })
        .then(data => {
            if (data.success) {
                if (data.user) {
                    currentUser = data.user;
                    Storage.set('currentUser', data.user);
                }
                showToast(data.message, 'success');
                navigate(data.redirect || 'complete-profile');
            } else {
                showFieldErrors({ otpCode: data.message });
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Xác thực'; });
}

function resendOtp() {
    const btn = document.getElementById('resendBtn');
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';

    Api.post('/resend-otp', {})
        .then(data => {
            showToast(data.message, data.success ? 'success' : 'error');
        })
        .catch(() => showToast('Lỗi kết nối', 'error'))
        .finally(() => {
            btn.textContent = 'Đã gửi';
            setTimeout(() => { btn.disabled = false; btn.textContent = 'Gửi lại mã'; }, 30000);
        });
}

// ===== FORGOT PASSWORD PAGE =====
function renderForgotPasswordPage() {
    return `
        <div class="auth-page">
            <div class="auth-card">
                <h2 class="auth-title">Quên mật khẩu</h2>
                <p class="auth-subtitle">Nhập email để nhận mã đặt lại mật khẩu</p>
                <form onsubmit="forgotPassword(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="forgotEmail" placeholder="email@example.com" autocomplete="email">
                        <span class="form-error" id="forgotEmailError"></span>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Gửi mã đặt lại</button>
                </form>
                <div class="auth-footer">
                    <a href="javascript:void(0)" onclick="navigate('login')">← Quay lại đăng nhập</a>
                </div>
            </div>
        </div>
    `;
}

function forgotPassword(e) {
    e.preventDefault();
    clearFormErrors(['forgotEmail']);
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) { showFieldErrors({ forgotEmail: 'Vui lòng nhập email' }); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang gửi...';

    Api.post('/forgot-password', { email })
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                navigate('reset-password', { email });
            } else {
                showFieldErrors({ forgotEmail: data.message });
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Gửi mã đặt lại'; });
}

// ===== RESET PASSWORD PAGE =====
function renderResetPasswordPage(email = '') {
    return `
        <div class="auth-page">
            <div class="auth-card">
                <h2 class="auth-title">Đặt lại mật khẩu</h2>
                <p class="auth-subtitle">Nhập mã xác thực và mật khẩu mới</p>
                <form onsubmit="resetPassword(event)">
                    <div class="form-group">
                        <label class="form-label">Email</label>
                        <input type="email" class="form-input" id="resetEmail" value="${email || ''}" placeholder="email@example.com" autocomplete="email">
                        <span class="form-error" id="resetEmailError"></span>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mã xác thực</label>
                        <input type="text" class="form-input" id="resetCode" placeholder="Nhập mã 6 số" maxlength="6" style="text-align:center;font-size:1.5rem;letter-spacing:8px;font-weight:700;" autocomplete="one-time-code">
                        <span class="form-error" id="resetCodeError"></span>
                        <p class="form-hint">Kiểm tra hộp thư (hoặc console nếu chưa cấu hình email)</p>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Mật khẩu mới</label>
                        <input type="password" class="form-input" id="resetNewPassword" placeholder="Tối thiểu 6 ký tự, 1 hoa, 1 số" autocomplete="new-password">
                        <span class="form-error" id="resetNewPasswordError"></span>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full btn-lg">Đặt lại mật khẩu</button>
                </form>
                <div class="auth-footer">
                    <a href="javascript:void(0)" onclick="navigate('login')">← Quay lại đăng nhập</a>
                </div>
            </div>
        </div>
    `;
}

function resetPassword(e) {
    e.preventDefault();
    clearFormErrors(['resetEmail', 'resetCode', 'resetNewPassword']);

    const email = document.getElementById('resetEmail').value.trim();
    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;

    const errors = {};
    if (!email) errors.resetEmail = 'Vui lòng nhập email';
    if (!code) errors.resetCode = 'Vui lòng nhập mã xác thực';
    if (!newPassword) errors.resetNewPassword = 'Vui lòng nhập mật khẩu mới';
    if (Object.keys(errors).length) { showFieldErrors(errors); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Đang xử lý...';

    Api.post('/reset-password', { email, code, newPassword })
        .then(data => {
            if (data.success) {
                showToast(data.message, 'success');
                navigate('login');
            } else {
                const mapped = {};
                if (data.errors) {
                    if (data.errors.email) mapped.resetEmail = data.errors.email;
                    if (data.errors.code) mapped.resetCode = data.errors.code;
                    if (data.errors.newPassword) mapped.resetNewPassword = data.errors.newPassword;
                }
                if (data.message) showToast(data.message, 'error');
                showFieldErrors(mapped);
            }
        })
        .catch(() => showToast('Lỗi kết nối server', 'error'))
        .finally(() => { btn.disabled = false; btn.textContent = 'Đặt lại mật khẩu'; });
}

// ─── BANNER SLIDER LOGIC ─────────────────────────────────
let activeBanners = [];
let currentBannerIdx = 0;
let bannerInterval = null;

async function loadBanners() {
    try {
        const res = await Api.get('/banners');
        if (res.success) {
            activeBanners = res.banners || [];
            if (currentPage === 'products') renderBanners();
        }
    } catch (e) {
        console.warn('Lỗi tải banner', e);
    }
}

function renderBanners() {
    const container = document.getElementById('bannerSliderContainer');
    if (!container) return;

    if (!activeBanners || activeBanners.length === 0) {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    const wrapper = document.getElementById('bannerWrapper');
    const dotsContainer = document.getElementById('bannerDots');
    
    wrapper.innerHTML = activeBanners.map(b => `
        <div class="banner-slide">
            ${b.link ? `<a href="${b.link}" target="_blank">` : ''}
            <img src="${b.imageUrl}" alt="${b.title || 'Banner'}" class="banner-img">
            ${b.link ? `</a>` : ''}
        </div>
    `).join('');

    dotsContainer.innerHTML = activeBanners.map((_, i) => `
        <span class="banner-dot" onclick="showBanner(${i})"></span>
    `).join('');

    // Bind events
    document.getElementById('bannerPrevBtn').onclick = () => { prevBanner(); resetBannerInterval(); };
    document.getElementById('bannerNextBtn').onclick = () => { nextBanner(); resetBannerInterval(); };

    showBanner(0);
    resetBannerInterval();
}

function showBanner(index) {
    if (activeBanners.length === 0) return;
    currentBannerIdx = (index + activeBanners.length) % activeBanners.length;
    
    const wrapper = document.getElementById('bannerWrapper');
    if (wrapper) wrapper.style.transform = `translateX(-${currentBannerIdx * 100}%)`;
    
    document.querySelectorAll('.banner-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === currentBannerIdx);
    });
}

function nextBanner() {
    showBanner(currentBannerIdx + 1);
}

function prevBanner() {
    showBanner(currentBannerIdx - 1);
}

function resetBannerInterval() {
    if (bannerInterval) clearInterval(bannerInterval);
    if (activeBanners.length > 1) {
        bannerInterval = setInterval(nextBanner, 4000); // 4 seconds
    }
}

// ═══════════════════════════════════════════════════════════
// ─── FLASH SALE ───────────────────────────────────────────
// ═══════════════════════════════════════════════════════════

async function loadFlashSales() {
    try {
        const res = await Api.get('/flash-sales');
        if (res.success) {
            _flashSalesCache = res.flashSales || [];
            if (currentPage === 'products') renderFlashSaleSection();
        }
    } catch (e) {
        console.warn('Flash sale load error', e);
    }
}

function renderFlashSaleSection() {
    const container = document.getElementById('flashSaleContainer');
    if (!container) return;

    if (!_flashSalesCache || _flashSalesCache.length === 0) {
        container.style.display = 'none';
        return;
    }

    // Use the title from the first flash sale item (they share the same campaign)
    const title = _flashSalesCache[0].title || 'FLASH SALE';
    const endDate = new Date(_flashSalesCache[0].endDate);

    container.style.display = 'block';
    container.innerHTML = `
        <div class="flash-sale-banner">
            <div class="flash-sale-header">
                <div class="flash-sale-title-area">
                    <span class="flash-sale-icon"><svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg></span>
                    <div>
                        <div class="flash-sale-title">FLASH SALE</div>
                        <div class="flash-sale-subtitle">${title}</div>
                    </div>
                </div>
                <div class="flash-sale-countdown-area">
                    <span class="flash-sale-countdown-label">Kết thúc sau</span>
                    <div class="flash-sale-countdown" id="flashSaleCountdown">
                        <div class="countdown-box"><span id="fsCountDays">00</span><small>NGÀY</small></div>
                        <div class="countdown-box"><span id="fsCountHours">00</span><small>GIỜ</small></div>
                        <div class="countdown-box"><span id="fsCountMins">00</span><small>PHÚT</small></div>
                        <div class="countdown-box"><span id="fsCountSecs">00</span><small>GIÂY</small></div>
                    </div>
                </div>
            </div>
            <div class="flash-sale-products">
                <button class="flash-sale-nav prev" onclick="scrollFlashSale(-1)">&#10094;</button>
                <div class="flash-sale-scroll" id="flashSaleScroll">
                    ${_flashSalesCache.map(fs => {
                        const p = fs.product;
                        return `
                            <div class="flash-sale-card" onclick="navigate('product-detail', {id:'${p.id}', slug:'${slugify(p.name)}'})">
                                <div class="flash-sale-card-img">
                                    <div class="flash-sale-badge">-${fs.discountPercent}%</div>
                                    ${p.imageUrl ? `<img src="${p.imageUrl}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">` : `<div class="flash-sale-product-icon">${p.shortName || p.name.substring(0, 3)}</div>`}
                                </div>
                                <div class="flash-sale-card-info">
                                    <div class="flash-sale-card-name">${p.name}</div>
                                    <div class="flash-sale-card-prices">
                                        <span class="flash-sale-price">${formatPrice(p.salePrice)}</span>
                                        <span class="flash-sale-original">${formatPrice(p.price)}</span>
                                    </div>
                                    <div class="flash-sale-card-orders"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline;vertical-align:-1px;margin-right:3px;"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>${p.purchases} đã bán</div>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
                <button class="flash-sale-nav next" onclick="scrollFlashSale(1)">&#10095;</button>
            </div>
        </div>
    `;

    // Start countdown
    startFlashSaleCountdown(endDate);
}

function startFlashSaleCountdown(endDate) {
    if (_flashSaleTimer) clearInterval(_flashSaleTimer);

    function update() {
        const now = new Date();
        let diff = endDate - now;
        if (diff <= 0) {
            diff = 0;
            clearInterval(_flashSaleTimer);
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);

        const dEl = document.getElementById('fsCountDays');
        const hEl = document.getElementById('fsCountHours');
        const mEl = document.getElementById('fsCountMins');
        const sEl = document.getElementById('fsCountSecs');
        if (dEl) dEl.textContent = String(days).padStart(2, '0');
        if (hEl) hEl.textContent = String(hours).padStart(2, '0');
        if (mEl) mEl.textContent = String(mins).padStart(2, '0');
        if (sEl) sEl.textContent = String(secs).padStart(2, '0');
    }

    update();
    _flashSaleTimer = setInterval(update, 1000);
}

function scrollFlashSale(dir) {
    const el = document.getElementById('flashSaleScroll');
    if (el) el.scrollBy({ left: dir * 220, behavior: 'smooth' });
}

// ─── Admin Flash Sale ─────────────────────────────────────

function renderAdminFlashSale() {
    setTimeout(loadAdminFlashSales, 50);

    const products = _productsCache;
    return `
        <div class="admin-header">
            <h2 class="admin-title">Quản lý Flash Sale</h2>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px;">
            <h3 style="margin-bottom:16px;font-size:15px;font-weight:600;color:var(--text-primary);">Thêm Flash Sale</h3>
            <form id="addFlashSaleForm" onsubmit="submitAddFlashSale(event)" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <label class="form-label">Sản phẩm</label>
                    <select class="form-select" id="fsProductId" required>
                        <option value="">Chọn sản phẩm...</option>
                        ${products.map(p => `<option value="${p.id}">${p.name} (${formatPrice(p.price)})</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label class="form-label">% Giảm giá</label>
                    <input type="number" class="form-input" id="fsDiscountPercent" min="1" max="99" value="20" required>
                </div>
                <div>
                    <label class="form-label">Tiêu đề chương trình</label>
                    <input type="text" class="form-input" id="fsTitleVal" placeholder="VD: SALE TẾT" value="FLASH SALE">
                </div>
                <div>
                    <label class="form-label">Ngày kết thúc</label>
                    <input type="datetime-local" class="form-input" id="fsEndDate" required>
                </div>
                <div style="grid-column:1/-1;">
                    <button type="submit" class="btn btn-primary">Thêm Flash Sale</button>
                </div>
            </form>
        </div>

        <div class="card" style="padding:24px;">
            <h3 style="margin-bottom:16px;font-size:15px;font-weight:600;color:var(--text-primary);">Flash Sales hiện tại</h3>
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Sản phẩm</th>
                        <th>Giá gốc</th>
                        <th>Giảm</th>
                        <th>Giá sale</th>
                        <th>Tiêu đề</th>
                        <th>Kết thúc</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody id="adminFlashSalesTbody">
                    <tr><td colspan="7" style="text-align:center;">Đang tải...</td></tr>
                </tbody>
            </table>
        </div>
    `;
}

async function loadAdminFlashSales() {
    try {
        const data = await Api.get('/admin/flash-sales');
        const tbody = document.getElementById('adminFlashSalesTbody');
        if (!tbody) return;

        if (!data.success) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--danger);">Lỗi tải</td></tr>';
            return;
        }

        if (!data.flashSales || data.flashSales.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Chưa có flash sale</td></tr>';
            return;
        }

        tbody.innerHTML = data.flashSales.map(fs => {
            const salePrice = Math.round(fs.productPrice * (1 - fs.discountPercent / 100));
            const endStr = new Date(fs.endDate).toLocaleString('vi-VN');
            const isExpired = new Date(fs.endDate) < new Date();
            return `
                <tr>
                    <td style="padding:10px 12px;font-weight:500;">${fs.productName}</td>
                    <td style="padding:10px 12px;">${formatPrice(fs.productPrice)}</td>
                    <td style="padding:10px 12px;color:var(--danger);font-weight:600;">-${fs.discountPercent}%</td>
                    <td style="padding:10px 12px;color:var(--green);font-weight:600;">${formatPrice(salePrice)}</td>
                    <td style="padding:10px 12px;">${fs.title}</td>
                    <td style="padding:10px 12px;${isExpired ? 'color:var(--danger);' : ''}">${endStr}${isExpired ? ' (hết hạn)' : ''}</td>
                    <td style="padding:10px 12px;">
                        <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger);" onclick="deleteFlashSale('${fs.id}')">Xóa</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('Admin flash sales error', e);
    }
}

async function submitAddFlashSale(e) {
    e.preventDefault();
    const productId = document.getElementById('fsProductId').value;
    const discountPercent = document.getElementById('fsDiscountPercent').value;
    const title = document.getElementById('fsTitleVal').value;
    const endDate = document.getElementById('fsEndDate').value;

    if (!productId || !discountPercent || !endDate) {
        showToast('Vui lòng điền đầy đủ thông tin', 'error');
        return;
    }

    try {
        const data = await Api.post('/admin/flash-sales', {
            productId,
            discountPercent: parseInt(discountPercent),
            title: title || 'FLASH SALE',
            endDate: new Date(endDate).toISOString()
        });
        if (data.success) {
            showToast('Thêm flash sale thành công!', 'success');
            document.getElementById('addFlashSaleForm').reset();
            loadAdminFlashSales();
            loadFlashSales(); // refresh cache
        } else {
            showToast(data.message || 'Lỗi', 'error');
        }
    } catch (e) {
        showToast('Lỗi thêm flash sale', 'error');
    }
}

async function deleteFlashSale(id) {
    if (!confirm('Xóa flash sale này?')) return;
    try {
        const data = await Api.delete('/admin/flash-sales/' + id);
        if (data.success) {
            showToast('Đã xóa flash sale', 'success');
            loadAdminFlashSales();
            loadFlashSales();
        } else {
            showToast(data.message || 'Lỗi xóa', 'error');
        }
    } catch (e) {
        showToast('Lỗi xóa flash sale', 'error');
    }
}

// ─── Admin Mã giảm giá (Coupons) ─────────────────────────────────────

function renderAdminCoupons() {
    setTimeout(loadAdminCoupons, 50);

    const products = _productsCache;
    return `
        <div class="admin-header">
            <h2 class="admin-title">Quản lý Mã giảm giá</h2>
        </div>

        <div class="card" style="padding:24px;margin-bottom:24px;">
            <h3 style="margin-bottom:16px;font-size:15px;font-weight:600;color:var(--text-primary);">Tạo mã giảm giá mới</h3>
            <form id="addCouponForm" onsubmit="submitAddCoupon(event)" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <label class="form-label">Mã giảm giá</label>
                    <input type="text" class="form-input" id="cpCode" placeholder="VD: SALE50, WELCOME..." required style="text-transform:uppercase;">
                </div>
                <div>
                    <label class="form-label">Loại giảm</label>
                    <select class="form-select" id="cpType" required>
                        <option value="percent">Giảm theo %</option>
                        <option value="fixed">Giảm số tiền cố định (đ)</option>
                    </select>
                </div>
                <div>
                    <label class="form-label">Giá trị giảm</label>
                    <input type="number" class="form-input" id="cpValue" min="1" placeholder="VD: 10 (%), 50000 (đ)" required>
                </div>
                <div>
                    <label class="form-label">Giới hạn lượt dùng (tùy chọn)</label>
                    <input type="number" class="form-input" id="cpMaxUses" min="1" placeholder="Để trống = không giới hạn">
                </div>
                <div>
                    <label class="form-label">Đơn hàng tối thiểu (tùy chọn)</label>
                    <input type="number" class="form-input" id="cpMinOrderValue" min="0" placeholder="VD: 200000 (để trống = không giới hạn)">
                    <p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">Đơn hàng phải từ số tiền này trở lên mới được áp dụng mã.</p>
                </div>
                <div>
                    <label class="form-label">Ngày hết hạn (tùy chọn)</label>
                    <input type="datetime-local" class="form-input" id="cpExpiry">
                </div>
                <div>
                    <label class="form-label">Áp dụng cho sản phẩm (tùy chọn)</label>
                    <select class="form-select" id="cpProductIds" multiple style="min-height:80px;">
                        ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <p style="font-size:11px;color:var(--text-tertiary);margin-top:4px;">Giữ Ctrl để chọn nhiều. Để trống = áp dụng tất cả.</p>
                </div>
                <div style="grid-column:1/-1;">
                    <button type="submit" class="btn btn-primary">Tạo mã giảm giá</button>
                </div>
            </form>
        </div>

        <div class="card" style="padding:24px;">
            <h3 style="margin-bottom:16px;font-size:15px;font-weight:600;color:var(--text-primary);">Danh sách mã giảm giá</h3>
            <div style="overflow-x:auto;">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Mã</th>
                            <th>Loại</th>
                            <th>Giá trị</th>
                            <th>Đơn tối thiểu</th>
                            <th>Đã dùng</th>
                            <th>Giới hạn</th>
                            <th>Hết hạn</th>
                            <th>Sản phẩm</th>
                            <th>Trạng thái</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody id="adminCouponsTbody">
                        <tr><td colspan="10" style="text-align:center;">Đang tải...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

async function loadAdminCoupons() {
    try {
        const data = await Api.get('/admin/coupons');
        const tbody = document.getElementById('adminCouponsTbody');
        if (!tbody) return;

        if (!data.success) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--danger);">Lỗi tải dữ liệu</td></tr>';
            return;
        }

        if (!data.coupons || data.coupons.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Chưa có mã giảm giá nào</td></tr>';
            return;
        }

        tbody.innerHTML = data.coupons.map(c => {
            const isExpired = c.expiry && new Date(c.expiry) < new Date();
            const isMaxed = c.max_uses && c.uses >= c.max_uses;
            const isActive = c.active && !isExpired && !isMaxed;
            const expiryStr = c.expiry ? new Date(c.expiry).toLocaleString('vi-VN') : 'Không';
            const typeLabel = c.type === 'percent' ? 'Giảm %' : 'Giảm tiền';
            const valueLabel = c.type === 'percent' ? c.value + '%' : formatPrice(c.value);
            const minOrderLabel = c.min_order_value && c.min_order_value > 0 ? formatPrice(c.min_order_value) : 'Không';
            const maxLabel = c.max_uses ? c.max_uses : 'Không giới hạn';

            // Product names
            let productLabel = 'Tất cả';
            if (c.product_ids && c.product_ids.length > 0) {
                const names = c.product_ids.map(pid => {
                    const p = _productsCache.find(pr => pr.id === pid);
                    return p ? p.name : pid.slice(0, 8);
                });
                productLabel = names.length > 2 ? names.slice(0, 2).join(', ') + '...' : names.join(', ');
            }

            const statusBadge = isActive
                ? '<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:var(--green)20;color:var(--green);">Hoạt động</span>'
                : `<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:var(--red)20;color:var(--red);">${isExpired ? 'Hết hạn' : isMaxed ? 'Hết lượt' : 'Tắt'}</span>`;

            return `
                <tr>
                    <td style="padding:10px 12px;font-weight:600;font-family:monospace;letter-spacing:1px;">${c.code}</td>
                    <td style="padding:10px 12px;">${typeLabel}</td>
                    <td style="padding:10px 12px;color:var(--green);font-weight:600;">${valueLabel}</td>
                    <td style="padding:10px 12px;font-size:12px;">${minOrderLabel}</td>
                    <td style="padding:10px 12px;">${c.uses || 0}</td>
                    <td style="padding:10px 12px;">${maxLabel}</td>
                    <td style="padding:10px 12px;${isExpired ? 'color:var(--danger);' : ''}">${expiryStr}${isExpired ? ' (hết hạn)' : ''}</td>
                    <td style="padding:10px 12px;font-size:12px;max-width:150px;overflow:hidden;text-overflow:ellipsis;" title="${productLabel}">${productLabel}</td>
                    <td style="padding:10px 12px;">${statusBadge}</td>
                    <td style="padding:10px 12px;">
                        <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger);" onclick="deleteAdminCoupon('${c.id}')">Xóa</button>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (e) {
        console.error('Admin coupons error', e);
    }
}

async function submitAddCoupon(e) {
    e.preventDefault();
    const code = document.getElementById('cpCode').value.trim();
    const type = document.getElementById('cpType').value;
    const value = document.getElementById('cpValue').value;
    const minOrderValue = document.getElementById('cpMinOrderValue').value;
    const maxUses = document.getElementById('cpMaxUses').value;
    const expiry = document.getElementById('cpExpiry').value;
    const productSelect = document.getElementById('cpProductIds');
    const productIds = Array.from(productSelect.selectedOptions).map(o => o.value);

    if (!code || !type || !value) {
        showToast('Vui lòng điền đầy đủ thông tin', 'error');
        return;
    }

    if (type === 'percent' && (parseInt(value) < 1 || parseInt(value) > 99)) {
        showToast('Giá trị % phải từ 1 đến 99', 'error');
        return;
    }

    try {
        const data = await Api.post('/admin/coupons', {
            code,
            type,
            value: parseInt(value),
            minOrderValue: minOrderValue ? parseInt(minOrderValue) : 0,
            maxUses: maxUses ? parseInt(maxUses) : null,
            expiry: expiry ? new Date(expiry).toISOString() : null,
            productIds: productIds.length > 0 ? productIds : []
        });
        if (data.success) {
            showToast('Tạo mã giảm giá thành công!', 'success');
            document.getElementById('addCouponForm').reset();
            loadAdminCoupons();
        } else {
            showToast(data.message || 'Lỗi tạo mã', 'error');
        }
    } catch (e) {
        if (e.message !== 'SESSION_EXPIRED') showToast('Lỗi tạo mã giảm giá', 'error');
    }
}

async function deleteAdminCoupon(id) {
    if (!confirm('Xóa mã giảm giá này?')) return;
    try {
        const data = await Api.delete('/admin/coupons/' + id);
        if (data.success) {
            showToast('Đã xóa mã giảm giá', 'success');
            loadAdminCoupons();
        } else {
            showToast(data.message || 'Lỗi xóa', 'error');
        }
    } catch (e) {
        showToast('Lỗi xóa mã giảm giá', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 PREORDER PAGE — Antigravity Ultra
// ═══════════════════════════════════════════════════════════════

function renderPreorderPage() {
    return `
        <div class="container">
            <!-- Compact Hero + Progress -->
            <section class="preorder-top">
                <div class="preorder-top-left">
                    <div class="preorder-hero-inline">
                        <img src="https://pbs.twimg.com/profile_images/1990585614279049216/-Zz6T2nk_400x400.png" alt="Antigravity Ultra" class="preorder-logo">
                        <div>
                            <div class="preorder-hero-badge">SẮP RA MẮT</div>
                            <h1 class="preorder-hero-title">
                                <span class="preorder-gradient-text">Antigravity</span> Ultra
                            </h1>
                            <div class="preorder-hero-price">450K/1 tháng</div>
                            <p class="preorder-hero-desc">
                                Sản phẩm AI thế hệ mới — đăng ký đặt trước để nhận ưu đãi độc quyền.
                            </p>
                        </div>
                    </div>
                </div>
                <div class="preorder-top-right">
                    <div class="preorder-progress-card">
                        <div class="preorder-progress-header">
                            <span class="preorder-progress-label">Nhóm <span id="preorderGroupNum">#1</span></span>
                            <span class="preorder-progress-count" id="preorderSlotText">0/5 slot</span>
                        </div>
                        <div class="preorder-progress-bar">
                            <div class="preorder-progress-fill" id="preorderProgressFill" style="width:0%"></div>
                        </div>
                        <p class="preorder-progress-hint" id="preorderProgressHint">Đang mở đăng ký...</p>
                    </div>
                </div>
            </section>

            <!-- 2-Column: Form + Table -->
            <section class="preorder-main-grid">
                <!-- LEFT: Form -->
                <div class="preorder-form-section" id="preorderFormSection">
                    <div class="preorder-form-card">
                        <h2 class="preorder-form-title">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                            Đăng ký đặt trước
                        </h2>
                        <form onsubmit="event.preventDefault(); submitPreorder();" autocomplete="off">
                            <div class="preorder-form-row">
                                <div class="preorder-form-group">
                                    <label class="preorder-form-label">Họ và tên <span class="required">*</span></label>
                                    <input type="text" class="form-input" id="preorderName" placeholder="Nguyễn Văn A" required>
                                </div>
                                <div class="preorder-form-group">
                                    <label class="preorder-form-label">Email <span class="required">*</span></label>
                                    <input type="email" class="form-input" id="preorderEmail" placeholder="email@example.com" required>
                                </div>
                            </div>
                            <div class="preorder-form-row">
                                <div class="preorder-form-group">
                                    <label class="preorder-form-label">SĐT / Zalo <span class="required">*</span></label>
                                    <input type="tel" class="form-input" id="preorderPhone" placeholder="0367xxxxxx" required>
                                </div>
                                <div class="preorder-form-group">
                                    <label class="preorder-form-label">Ghi chú <span style="color:var(--text-tertiary);font-weight:400;">(tùy chọn)</span></label>
                                    <input type="text" class="form-input" id="preorderNote" placeholder="Nhắn gì thêm...">
                                </div>
                            </div>
                            <button type="submit" class="btn btn-accent btn-lg btn-full preorder-submit-btn" id="preorderSubmitBtn">
                                Đăng ký đặt trước
                            </button>
                        </form>
                    </div>
                </div>

                <!-- RIGHT: Public Table -->
                <div class="preorder-table-section">
                    <div class="preorder-table-header-row">
                        <h2 class="preorder-table-title">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                            Danh sách đăng ký
                        </h2>
                        <span class="preorder-table-live-dot"></span>
                    </div>
                    <div id="preorderTableContainer">
                        <div style="text-align:center;padding:30px;color:var(--text-tertiary);">Đang tải...</div>
                    </div>
                </div>
            </section>
        </div>
    `;
}

function maskEmail(email) {
    if (!email) return '';
    const [name, domain] = email.split('@');
    if (!domain) return email;
    const masked = name.length <= 2 ? name[0] + '***' : name.slice(0, 2) + '***';
    return masked + '@' + domain;
}

function maskPhone(phone) {
    if (!phone) return '';
    if (phone.length <= 4) return phone;
    return phone.slice(0, -4).replace(/./g, '*') + phone.slice(-4);
}

async function loadPreorders() {
    try {
        const data = await Api.get('/preorders');
        if (!data.success) {
            showToast('Không thể tải danh sách đặt trước', 'error');
            return;
        }

        const { groups, currentGroup, currentGroupCount } = data;
        const groupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);

        // Update progress bar
        const groupNumEl = document.getElementById('preorderGroupNum');
        const slotTextEl = document.getElementById('preorderSlotText');
        const fillEl = document.getElementById('preorderProgressFill');
        const hintEl = document.getElementById('preorderProgressHint');

        if (groupNumEl) groupNumEl.textContent = '#' + currentGroup;
        if (slotTextEl) slotTextEl.textContent = currentGroupCount + '/5 slot';
        if (fillEl) fillEl.style.width = (currentGroupCount / 5 * 100) + '%';

        if (currentGroupCount === 0) {
            if (hintEl) hintEl.innerHTML = 'Nhóm #' + currentGroup + ' vừa mở — Hãy là người đầu tiên!';
        } else if (currentGroupCount < 5) {
            if (hintEl) hintEl.innerHTML = 'Còn ' + (5 - currentGroupCount) + ' slot — Đăng ký ngay!';
        }

        // Render table
        const container = document.getElementById('preorderTableContainer');
        if (!container) return;

        if (groupNums.length === 0) {
            container.innerHTML = `
                <div class="preorder-empty">
                    <div class="preorder-empty-icon">--</div>
                    <p>Chưa có ai đăng ký. Hãy là người đầu tiên!</p>
                </div>`;
            return;
        }

        // Render groups in reverse order (newest first)
        let html = '';
        for (let i = groupNums.length - 1; i >= 0; i--) {
            const gNum = groupNums[i];
            const entries = groups[gNum];
            const isFull = entries.length >= 5;
            const isActive = gNum === currentGroup && !isFull;

            html += `
            <div class="preorder-group-card ${isActive ? 'preorder-group-active' : ''} ${isFull ? 'preorder-group-full' : ''}">
                <div class="preorder-group-header">
                    <span class="preorder-group-badge ${isFull ? 'full' : 'open'}">
                        ${isFull ? 'ĐÃ ĐẦY' : 'ĐANG MỞ'}
                    </span>
                    <span class="preorder-group-title">Nhóm #${gNum}</span>
                    <span class="preorder-group-count">${entries.length}/5</span>
                </div>
                <div class="preorder-group-table-wrap">
                    <table class="preorder-table">
                        <thead>
                            <tr>
                                <th>#</th>
                                <th>Họ tên</th>
                                <th>Email</th>
                                <th>SĐT/Zalo</th>
                                <th>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${entries.map((e, idx) => {
                                const d = new Date(e.createdAt);
                                const dateStr = d.toLocaleDateString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric' });
                                const timeStr = d.toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' });
                                return `<tr>
                                    <td class="preorder-td-num">${idx + 1}</td>
                                    <td class="preorder-td-name">${e.fullName}</td>
                                    <td class="preorder-td-email">${maskEmail(e.email)}</td>
                                    <td class="preorder-td-phone">${maskPhone(e.phone)}</td>
                                    <td class="preorder-td-date">${dateStr} ${timeStr}</td>
                                </tr>`;
                            }).join('')}
                            ${entries.length < 5 ? Array(5 - entries.length).fill('').map((_, idx) => `
                                <tr class="preorder-row-empty">
                                    <td class="preorder-td-num">${entries.length + idx + 1}</td>
                                    <td colspan="4" class="preorder-td-waiting">Đang chờ đăng ký...</td>
                                </tr>
                            `).join('') : ''}
                        </tbody>
                    </table>
                </div>
            </div>`;
        }

        container.innerHTML = html;

    } catch (err) {
        console.error('[PREORDER LOAD ERROR]', err);
    }
}

async function submitPreorder() {
    const fullName = document.getElementById('preorderName')?.value?.trim();
    const email = document.getElementById('preorderEmail')?.value?.trim();
    const phone = document.getElementById('preorderPhone')?.value?.trim();
    const note = document.getElementById('preorderNote')?.value?.trim();

    if (!fullName) { showToast('Vui lòng nhập họ tên', 'error'); return; }
    if (!email) { showToast('Vui lòng nhập email', 'error'); return; }
    if (!phone) { showToast('Vui lòng nhập số điện thoại', 'error'); return; }

    const btn = document.getElementById('preorderSubmitBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Đang gửi...'; }

    try {
        const data = await Api.post('/preorders', { fullName, email, phone, note });
        if (data.success) {
            showToast(data.message, 'success');
            document.getElementById('preorderName').value = '';
            document.getElementById('preorderEmail').value = '';
            document.getElementById('preorderPhone').value = '';
            document.getElementById('preorderNote').value = '';
            loadPreorders();
        } else {
            showToast(data.message || 'Lỗi đăng ký', 'error');
        }
    } catch (err) {
        if (err.message !== 'SESSION_EXPIRED') showToast('Lỗi kết nối server', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Đăng ký đặt trước'; }
    }
}
