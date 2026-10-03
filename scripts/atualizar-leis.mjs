#!/usr/bin/env node
// Baixa as leis listadas em leis.json do site do Planalto e gera data/<id>.json.
//
// Uso:
//   node scripts/atualizar-leis.mjs            # todas as leis
//   node scripts/atualizar-leis.mjs clt cc     # só as leis indicadas
//   node scripts/atualizar-leis.mjs --local    # usa fontes/<id>.htm salvos manualmente
//
// Se uma lei falhar, o arquivo anterior em data/ é mantido.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanalto, decodificarBytes } from './parser.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(RAIZ, 'data');
const FONTES = path.join(RAIZ, 'fontes');

const args = process.argv.slice(2);
const usarLocal = args.includes('--local');
const filtro = new Set(args.filter((a) => !a.startsWith('--')));

const existe = (p) => access(p).then(() => true, () => false);
const lerJson = async (p, padrao) => (await existe(p) ? JSON.parse(await readFile(p, 'utf8')) : padrao);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  let ultimoErro;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ConsultaLegislacao/1.0; leitura de legislacao para uso profissional)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'pt-BR,pt;q=0.9',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(90_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      return decodificarBytes(bytes, resp.headers.get('content-type') || '');
    } catch (e) {
      ultimoErro = e;
      if (tentativa < 3) await espera(2000 * tentativa);
    }
  }
  throw ultimoErro;
}

async function obterHtml(lei) {
  const local = path.join(FONTES, `${lei.id}.htm`);
  if (usarLocal) {
    if (!(await existe(local))) throw new Error(`arquivo ${path.relative(RAIZ, local)} não encontrado`);
    return decodificarBytes(await readFile(local));
  }
  return baixar(lei.url);
}

async function main() {
  const catalogo = JSON.parse(await readFile(path.join(RAIZ, 'leis.json'), 'utf8'));
  await mkdir(DATA, { recursive: true });
  const statusPath = path.join(DATA, 'status.json');
  const status = await lerJson(statusPath, { leis: {} });
  const agora = new Date().toISOString();
  let ok = 0, falhas = 0;

  for (const lei of catalogo.leis) {
    if (filtro.size && !filtro.has(lei.id)) continue;
    const destino = path.join(DATA, `${lei.id}.json`);
    const anterior = await lerJson(destino, null);
    const st = status.leis[lei.id] || {};
    try {
      const html = await obterHtml(lei);
      const { titulo, blocos } = parsePlanalto(html);
      const artigos = blocos.filter((b) => b.k === 'a').length;
      if (artigos < 1 || blocos.length < 5) throw new Error(`conteúdo inesperado (${blocos.length} blocos, ${artigos} artigos)`);
      if (anterior && anterior.artigos > 20 && artigos < anterior.artigos * 0.5) {
        throw new Error(`número de artigos caiu de ${anterior.artigos} para ${artigos}; mantendo versão anterior`);
      }
      const hash = createHash('sha256').update(JSON.stringify(blocos)).digest('hex').slice(0, 16);
      const mudou = !anterior || anterior.hash !== hash;
      const saida = {
        id: lei.id,
        fonte: lei.url,
        tituloPagina: titulo,
        hash,
        alteradoEm: mudou ? agora : anterior.alteradoEm,
        verificadoEm: agora,
        artigos,
        blocos,
      };
      await writeFile(destino, JSON.stringify(saida));
      status.leis[lei.id] = { ok: true, verificadoEm: agora, alteradoEm: saida.alteradoEm, artigos };
      console.log(`✔ ${lei.id.padEnd(18)} ${String(artigos).padStart(5)} artigos ${mudou ? '(atualizada)' : '(sem mudanças)'}`);
      ok++;
    } catch (e) {
      status.leis[lei.id] = { ...st, ok: false, erro: String(e.message || e), tentativaEm: agora };
      console.error(`✘ ${lei.id.padEnd(18)} ${e.message || e}${anterior ? ' — mantida versão anterior' : ''}`);
      falhas++;
    }
    if (!usarLocal) await espera(1500); // gentileza com o servidor do Planalto
  }

  status.geradoEm = agora;
  await writeFile(statusPath, JSON.stringify(status, null, 2) + '\n');
  console.log(`\n${ok} ok, ${falhas} com falha.`);
  if (ok === 0 && falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
