#!/usr/bin/env node
// Imprime trechos do HTML original (fontes/<id>.htm) para investigar a conversão.
// Caracteres fora do ASCII aparecem como \uXXXX para revelar invisíveis.
// Uso: node scripts/diagnostico.mjs   (lê os alvos de scripts/diagnostico.json)
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodificarBytes } from './parser.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const alvos = JSON.parse(await readFile(path.join(RAIZ, 'scripts/diagnostico.json'), 'utf8'));
const mostrar = (s) => s.replace(/[^\x20-\x7e\n]/g, (c) => (/[À-ÿºª§“”–—]/.test(c) ? c : `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));

for (const { lei, padroes = [], contexto = 500, estatisticas } of alvos) {
  const f = path.join(RAIZ, 'fontes', `${lei}.htm`);
  if (!(await access(f).then(() => true, () => false))) { console.log(`### ${lei}: sem fonte`); continue; }
  const html = decodificarBytes(await readFile(f));
  console.log(`\n########## ${lei} (${html.length} caracteres)`);
  if (estatisticas) {
    const conta = (re) => (html.match(re) || []).length;
    console.log(`strike=${conta(/<strike\b/gi)} s=${conta(/<s[\s>]/gi)} del=${conta(/<del\b/gi)} line-through=${conta(/line-through/gi)}`);
    const classes = {};
    for (const m of html.matchAll(/class=["']?([\w -]+)/gi)) classes[m[1]] = (classes[m[1]] || 0) + 1;
    console.log('classes:', JSON.stringify(Object.entries(classes).sort((a, b) => b[1] - a[1]).slice(0, 15)));
    const estilos = {};
    for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) console.log('STYLE:', mostrar(m[1].slice(0, 800)));
    for (const m of html.matchAll(/style=["']([^"']+)/gi)) estilos[m[1]] = (estilos[m[1]] || 0) + 1;
    console.log('estilos:', JSON.stringify(Object.entries(estilos).sort((a, b) => b[1] - a[1]).slice(0, 12)));
  }
  for (const p of padroes) {
    const re = new RegExp(p, 'g');
    let n = 0;
    for (const m of html.matchAll(re)) {
      if (n++ >= 2) break;
      const ini = Math.max(0, m.index - contexto);
      console.log(`\n--- ${lei} /${p}/ @${m.index}\n${mostrar(html.slice(ini, m.index + contexto))}`);
    }
    if (!n) console.log(`\n--- ${lei} /${p}/ sem ocorrências`);
  }
}
