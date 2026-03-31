const fs = require('fs');
let content = fs.readFileSync('server.js', 'utf8');

// The destructuring bug: features: accountTypes: videoUrl, docsố isHot
content = content.replace(/features: accountTypes: videoUrl, docsố /g, 'features, accountTypes, videoUrl, docs, ');

// Line 898: res.json({ success: true, ) { totalUsersố 
content = content.replace(/res\.json\(\{ success: true, \) \{ totalUsersố totalOrdersố/g, 'res.json({ success: true, data: { totalUsers, totalOrders, ');
content = content.replace(/totalProductsố totalRevenue, orderRevenue, depositRevenue \} \}\);/g, 'totalProducts, totalRevenue, orderRevenue, depositRevenue } });');

// Line 885-886-887
content = content.replace(/const \{ data: usersố \} =/g, "const { data: users } =");
content = content.replace(/const \{ data: ordersố \} = await supabase.from\('orders'\).select\('id, price, status: created_at'\);/g, "const { data: orders } = await supabase.from('orders').select('id, price, status, created_at');");
content = content.replace(/const \{ data: productsố \} =/g, "const { data: products } =");
content = content.replace(/let depositsố =/g, "let deposits =");
content = content.replace(/depositsố = d/g, "deposits = d");

// Line 891-893
content = content.replace(/const totalUsersố/g, "const totalUsers");
content = content.replace(/\(usersố \|\|/g, "(users ||");
content = content.replace(/\(ordersố \|\|/g, "(orders ||");
content = content.replace(/\(productsố \|\|/g, "(products ||");
content = content.replace(/const totalOrdersố/g, "const totalOrders");
content = content.replace(/const totalProductsố/g, "const totalProducts");

// Line 894-895: reduce functions
content = content.replace(/\(số o\) => số \+/g, "(s, o) => s +");
content = content.replace(/\(số d\) => số \+/g, "(s, d) => s +");
content = content.replace(/o\.status: !==/g, "o.status !==");

// Line 849-852
content = content.replace(/L\ i tải danh sách usersố/g, "Lỗi tải danh sách users'");
content = content.replace(/const usersố =/g, "const users =");
content = content.replace(/usersố \}\);/g, "users });");

// Line 858
content = content.replace(/const updatest =/g, "const updates =");

// Line 1168-1169
content = content.replace(/features: features: \|\|/g, "features: features ||");
content = content.replace(/account_types accountTypes: \|\|/g, "account_types: accountTypes ||");
content = content.replace(/docsố docsố \|\|/g, "docs: docs ||");

// Line 1182 to 1193
content = content.replace(/if \(features: !== undefined\) updates\.features: = features;/g, "if (features !== undefined) updates.features = features;");
content = content.replace(/if \(accountTypes: !== undefined\) updates\.account_types = accountTypes;/g, "if (accountTypes !== undefined) updates.account_types = accountTypes;");
content = content.replace(/if \(docsố !== undefined\) updates\.docsố = docs;/g, "if (docs !== undefined) updates.docs = docs;");

fs.writeFileSync('server.js', content, 'utf8');
console.log('Fixed precision syntax errors.');
