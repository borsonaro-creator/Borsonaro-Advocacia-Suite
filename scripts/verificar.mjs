#!/usr/bin/env node
// Relatório de conferência da conversão: lê fontes/<id>.htm (HTML original do
// Planalto, salvo com --salvar-fontes) e data/<id>.json e aponta problemas
// prováveis: artigos faltando na numeração, "Art." não reconhecido, títulos
// suspeitos e amostras de artigos conhecidos para comparação visual.

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanalto, decodificarBytes } from './parser.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const existe = (p) => access(p).then(() => true, () => false);

// Artigos conhecidos para conferir o texto de cada lei.
const AMOSTRAS = {
  cf: ['5', '7', '201'], cc: ['186', '927', '1.000'], cpc: ['300', '1.015'], clt: ['2', '477', '477-A', '818'],
  cdc: ['6'], lindb: ['6'], beneficios: ['42', '57'], custeio: ['22'], rps: ['188-A'], loas: ['20'],
  ec103: ['26'], fgts: ['18'], domesticos: ['18'], temporario: ['4-A'], jec: ['3'], jef: ['3'],
};

const corta = (t, n = 160) => (t.length > n ? t.slice(0, n) + '…' : t);
const numBase = (a) => Number(a.split('-')[0]);

async function main() {
  const catalogo = JSON.parse(await readFile(path.join(RAIZ, 'leis.json'), 'utf8'));
  const status = JSON.parse(await readFile(path.join(RAIZ, 'data/status.json'), 'utf8'));
  const linhas = ['# Conferência da conversão das leis', ''];
  const resumo = ['| Lei | Situação | Artigos | Maior nº | Faltando na numeração | Vigentes repetidos | Tachados | Citados | "Art." não reconhecido |', '|---|---|---|---|---|---|---|---|---|'];
  const detalhes = [];

  for (const lei of catalogo.leis) {
    const st = status.leis[lei.id] || {};
    const fonte = path.join(RAIZ, 'fontes', `${lei.id}.htm`);
    if (!st.ok || !(await existe(fonte))) {
      resumo.push(`| ${lei.sigla} | ❌ ${st.erro || 'sem fonte'} | | | | | |`);
      continue;
    }
    const { blocos } = parsePlanalto(decodificarBytes(await readFile(fonte)));
    const arts = blocos.filter((b) => b.k === 'a');
    const nums = new Set(arts.map((b) => numBase(b.a)));
    for (const b of arts) if (b.ate) for (let n = numBase(b.a); n <= b.ate; n++) nums.add(n);
    // Mesmo número vigente (não tachado) mais de uma vez fora do preâmbulo.
    const vistos = new Map();
    let titulo = false;
    for (const b of blocos) {
      if (b.k === 'h') titulo = true;
      if (b.k === 'a' && !b.s && titulo) vistos.set(b.a, (vistos.get(b.a) || 0) + 1);
    }
    const repetidos = [...vistos].filter(([, n]) => n > 1).map(([a]) => a);
    const citados = blocos.filter((b) => b.c).length;
    const maior = Math.max(...nums);
    const faltando = [];
    for (let i = 1; i <= maior; i++) if (!nums.has(i)) faltando.push(i);
    const tachados = blocos.filter((b) => b.s).length;
    const naoReconhecidos = blocos.filter((b) => b.k !== 'a' && !b.c && /^\W{0,3}Art(igo)?s?\b\.?\s*\d/i.test(b.t));
    resumo.push(`| ${lei.sigla} | ✅ | ${arts.length} | ${maior} | ${faltando.length}${faltando.length ? ` (${corta(faltando.join(', '), 60)})` : ''} | ${repetidos.length}${repetidos.length ? ` (${corta(repetidos.join(', '), 50)})` : ''} | ${tachados} | ${citados} | ${naoReconhecidos.length} |`);

    const d = [`## ${lei.sigla} — ${lei.id}`, ''];
    if (faltando.length) d.push(`**Faltando:** ${corta(faltando.join(', '), 600)}`, '');
    for (const a of repetidos.slice(0, 5)) {
      d.push(`**Vigente repetido: art. ${a}**`, '');
      blocos.filter((b) => b.a === a && !b.s).forEach((b) => d.push(`- ${JSON.stringify(corta(b.t, 150))}`));
      d.push('');
    }
    if (naoReconhecidos.length) {
      d.push('**Blocos com "Art." não reconhecidos como artigo:**', '');
      naoReconhecidos.slice(0, 15).forEach((b) => d.push(`- \`${b.k}\` ${JSON.stringify(corta(b.t, 140))}`));
      d.push('');
    }
    const titulos = blocos.filter((b) => b.k === 'h');
    const titulosEstranhos = titulos.filter((b) => b.t.length > 110 || /[.;]$/.test(b.t));
    d.push(`**Títulos:** ${titulos.length}. Primeiros: ${titulos.slice(0, 6).map((b) => JSON.stringify(corta(b.t, 50))).join(' · ')}`, '');
    if (titulosEstranhos.length) {
      d.push('**Títulos suspeitos (longos ou terminando em pontuação):**', '');
      titulosEstranhos.slice(0, 10).forEach((b) => d.push(`- ${JSON.stringify(corta(b.t, 140))}`));
      d.push('');
    }
    // Primeiros blocos (ementa/cabeçalho) e último artigo.
    d.push('**Início do documento:**', '');
    blocos.slice(0, 8).forEach((b) => d.push(`- \`${b.k}${b.s ? ' tachado' : ''}\` ${JSON.stringify(corta(b.t, 120))}`));
    d.push('');
    for (const alvo of AMOSTRAS[lei.id] || []) {
      const a = alvo.replace(/\./g, '');
      const idx = blocos.map((b, i) => (b.a === a ? i : -1)).filter((i) => i >= 0);
      d.push(`**Art. ${alvo}** — ${idx.length} ocorrência(s)`, '');
      for (const i of idx.slice(0, 3)) {
        let j = i;
        do {
          const b = blocos[j];
          const marca = b.c ? ' (citação)' : b.s ? ' ~~tachado~~' : b.g ? ` (parcial: ${b.g.filter((g) => g[1]).map((g) => JSON.stringify(corta(g[0], 40))).join(', ')})` : '';
          d.push(`- \`${b.k}\`${marca} ${JSON.stringify(corta(b.t, 180))}`);
          j++;
        } while (j < blocos.length && j < i + 6 && blocos[j].k === 'p');
        d.push('');
      }
    }
    detalhes.push(d.join('\n'));
  }
  linhas.push(...resumo, '', ...detalhes);
  console.log(linhas.join('\n'));
}

main().catch((e) => { console.error(e); process.exit(1); });
