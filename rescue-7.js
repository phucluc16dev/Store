const fs = require('fs');
let c = fs.readFileSync('server.js', 'utf8');

c = c.replace(/  = new Map\(\);/g, 'const failedLogins = new Map();');
c = c.replace(/  = 'ABCDEF/g, "const chars = 'ABCDEF");
c = c.replace(/  = \(data \|\| \[\]\)\.map\(c => \(\{/g, 'const commissions = (data || []).map(c => ({');
c = c.replace(/  = \(data \|\| \[\]\)\.map\(b => \(\{/g, 'const banners = (data || []).map(b => ({');
c = c.replace(/  = \(data \|\| \[\]\)\.map\(fs => \{/g, 'const flashSales = (data || []).map(fs => {');
c = c.replace(/  = \(data \|\| \[\]\)\.map\(fs => \(\{/g, 'const flashSales = (data || []).map(fs => ({');

// Fix unclosed strings
c = c.replace(/'L.* t.*?i banners, \}\);/g, "'Lỗi tải banners' });");
c = c.replace(/'Error loading flas, sales: \}\);/g, "'Error loading flash sales' });");

// Fix items, } and banners, }
c = c.replace(/banners, \}\);/g, "banners });");
c = c.replace(/flashSales, items, \}\);/g, "flashSales });");

fs.writeFileSync('server.js', c, 'utf8');
console.log('Restored empty vars.');
