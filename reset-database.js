'use strict';

const fs = require('node:fs');
const path = require('node:path');

const databaseDir = path.join(__dirname, 'database');
const files = [
  'casa-dos-materiais.db',
  'casa-dos-materiais.db-shm',
  'casa-dos-materiais.db-wal'
];

for (const file of files) {
  const fullPath = path.join(databaseDir, file);
  if (fs.existsSync(fullPath)) fs.rmSync(fullPath, { force: true });
}

require('./database');
console.log('Banco de dados recriado com o catálogo e o administrador padrão.');
