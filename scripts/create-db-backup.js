const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'db', 'database.sqlite');
const backupDir = path.join(process.cwd(), 'backups');

if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
}

fs.mkdirSync(backupDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDir, `database-${timestamp}.sqlite`);
fs.copyFileSync(dbPath, destination);

const files = fs.readdirSync(backupDir)
    .filter((file) => file.endsWith('.sqlite'))
    .sort()
    .reverse();

files.slice(5).forEach((file) => {
    fs.unlinkSync(path.join(backupDir, file));
});

console.log(`Backup created: ${destination}`);
