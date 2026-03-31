const fs = require('fs');
let lines = fs.readFileSync('server.js','utf8').split(/\r?\n/);
lines[848] = "    if (error) return res.status(500).json({ success: false, message: 'Lỗi tải danh sách users' });";
fs.writeFileSync('server.js', lines.join('\n'), 'utf8');
console.log('Fixed line 849');
