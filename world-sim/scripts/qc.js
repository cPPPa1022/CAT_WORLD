'use strict';
const fs = require('fs');
const raw = fs.readFileSync('src/import.js', 'utf8');
const ls = raw.split(/\r?\n/);
for (let i = 138; i <= 147; i++) {
  if (!ls[i]) continue;
  const sq = (ls[i].match(/'/g) || []).length;
  const dq = (ls[i].match(/"/g) || []).length;
  console.log((i + 1) + ' len=' + ls[i].length + ' sq=' + sq + ' dq=' + dq + ' 末40=' + JSON.stringify(ls[i].slice(-40)));
}
